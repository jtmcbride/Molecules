import type { Structure } from "molstar/lib/mol-model/structure";
import type { Interactions } from "molstar/lib/mol-model-props/computed/interactions/interactions";
import { FeatureTypes } from "molstar/lib/mol-model-props/computed/interactions/common";
import type { Participant } from "../domain/analysis";
import type { AtomLocations } from "./connectivity";

/** A Mol* chemical feature (donor, ring, charged group, metal…) as sorted domain atom indices. */
export interface FeatureGroup {
  atoms: number[];
  type: number;
}

export function featureReader(
  computed: Interactions,
  selected: Structure,
  locations: AtomLocations,
) {
  return (unitId: number, featureIndex: number): FeatureGroup => {
    const f = computed.unitsFeatures.get(unitId)!,
      unit = selected.unitMap.get(unitId)!;
    const atoms: number[] = [];
    for (
      let j = f.offsets[featureIndex];
      j < f.offsets[featureIndex + 1];
      j++
    ) {
      const atom = locations.get(`${unitId}:${unit.elements[f.members[j]]}`);
      if (atom !== undefined) atoms.push(atom);
    }
    return { atoms: atoms.sort((a, b) => a - b), type: f.types[featureIndex] };
  };
}
export type FeatureReader = ReturnType<typeof featureReader>;

/** Orders two features as [ligand, receptor], or null unless one lies wholly in each set. */
export function orient(
  a: FeatureGroup,
  b: FeatureGroup,
  ligand: Set<number>,
  receptor: Set<number>,
): [FeatureGroup, FeatureGroup] | null {
  const within = (g: FeatureGroup, set: Set<number>) =>
    g.atoms.every((i) => set.has(i));
  if (within(a, ligand) && within(b, receptor)) return [a, b];
  if (within(b, ligand) && within(a, receptor)) return [b, a];
  return null;
}

export function participantRole(
  type: number,
  fallback: Participant["role"],
): Participant["role"] {
  switch (type) {
    case FeatureTypes.AromaticRing:
      return "aromatic_ring";
    case FeatureTypes.TransitionMetal:
    case FeatureTypes.IonicTypeMetal:
      return "metal";
    case FeatureTypes.DativeBondPartner:
    case FeatureTypes.IonicTypePartner:
      return "coordinator";
    case FeatureTypes.HydrogenDonor:
      return "donor";
    case FeatureTypes.HydrogenAcceptor:
      return "acceptor";
    case FeatureTypes.PositiveCharge:
      return "positive_group";
    case FeatureTypes.NegativeCharge:
      return "negative_group";
    default:
      return fallback;
  }
}
