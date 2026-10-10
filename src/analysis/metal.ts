import type { Interactions } from "molstar/lib/mol-model-props/computed/interactions/interactions";
import { FeatureTypes } from "molstar/lib/mol-model-props/computed/interactions/common";
import type { MolecularInteraction } from "../domain/analysis";
import type { FeatureReader } from "./features";
import { angleDegrees, SpatialGrid } from "./spatial";

export interface FeatureRef {
  unit: number;
  feature: number;
}
const METALS = new Set<number>([
  FeatureTypes.TransitionMetal,
  FeatureTypes.IonicTypeMetal,
]);
const PARTNERS = new Set<number>([
  FeatureTypes.DativeBondPartner,
  FeatureTypes.IonicTypePartner,
]);
const compatible = (a: number, b: number) =>
  (a === FeatureTypes.TransitionMetal &&
    b === FeatureTypes.DativeBondPartner) ||
  (a === FeatureTypes.IonicTypeMetal && b === FeatureTypes.IonicTypePartner);

/**
 * Ligand/receptor single-atom metal–partner feature pairs within the cutoff.
 * Generic noncovalent checks reject connected atoms, including deposited
 * metal-coordinate bonds, so these pairs are tested directly from Mol* features.
 */
export function metalFeaturePairs(
  computed: Interactions,
  read: FeatureReader,
  ligand: Set<number>,
  receptor: Set<number>,
  positions: Float32Array,
  cutoff: number,
): [FeatureRef, FeatureRef][] {
  const ligandFeatures: (FeatureRef & { atom: number; type: number })[] = [];
  const receptorFeatures = new Map<number, (FeatureRef & { type: number })[]>();
  for (const unit of computed.unitsFeatures.keys()) {
    const f = computed.unitsFeatures.get(unit)!;
    for (let feature = 0; feature < f.count; feature++) {
      const type = f.types[feature];
      if (!METALS.has(type) && !PARTNERS.has(type)) continue;
      const atoms = read(unit, feature).atoms;
      if (atoms.length !== 1) continue;
      const atom = atoms[0];
      if (ligand.has(atom)) ligandFeatures.push({ unit, feature, atom, type });
      if (receptor.has(atom)) {
        if (!receptorFeatures.has(atom)) receptorFeatures.set(atom, []);
        receptorFeatures.get(atom)!.push({ unit, feature, type });
      }
    }
  }
  const grid = new SpatialGrid(positions, [...receptorFeatures.keys()], cutoff);
  const pairs: [FeatureRef, FeatureRef][] = [];
  for (const a of ligandFeatures)
    for (const near of grid.neighbors(a.atom, cutoff))
      for (const b of receptorFeatures.get(near.index)!)
        if (compatible(a.type, b.type) || compatible(b.type, a.type))
          pairs.push([
            { unit: a.unit, feature: a.feature },
            { unit: b.unit, feature: b.feature },
          ]);
  return pairs;
}

/** Above this many partners the quadratic angle list is omitted; interactions remain. */
export const MAX_ANGLE_PARTNERS = 64;

/** Adds each metal's selected-partner count and partner–metal–partner angles to its interactions. */
export function annotateMetalGroups(
  interactions: MolecularInteraction[],
  positions: Float32Array,
) {
  const groups = new Map<
    number,
    { partners: Set<number>; interactions: MolecularInteraction[] }
  >();
  for (const interaction of interactions)
    if (interaction.type === "metal_coordination") {
      const metal =
        interaction.ligand.role === "metal"
          ? interaction.closestAtomPair[0]
          : interaction.closestAtomPair[1];
      const group = groups.get(metal) ?? {
        partners: new Set<number>(),
        interactions: [],
      };
      group.partners.add(interaction.closestAtomPair.find((a) => a !== metal)!);
      group.interactions.push(interaction);
      groups.set(metal, group);
    }
  for (const [metal, group] of groups) {
    const partners = [...group.partners],
      angles: number[] = [];
    const enumerate = partners.length <= MAX_ANGLE_PARTNERS;
    if (enumerate)
      for (let i = 0; i < partners.length; i++)
        for (let j = i + 1; j < partners.length; j++) {
          const angle = angleDegrees(
            positions,
            partners[i],
            metal,
            partners[j],
          );
          if (angle !== undefined) angles.push(angle);
        }
    for (const interaction of group.interactions) {
      interaction.geometry = {
        ...interaction.geometry,
        selectedReceptorPartnerCount: partners.length,
        selectedReceptorAnglesDegrees: enumerate ? angles : undefined,
      };
      if (!enumerate)
        interaction.notes.push(
          `Partner angles were not enumerated because this metal has more than ${MAX_ANGLE_PARTNERS} selected partners. All partner interactions and coordinates remain available.`,
        );
    }
  }
}
