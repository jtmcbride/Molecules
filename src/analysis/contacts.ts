import type {
  AnalysisParameters,
  MolecularInteraction,
} from "../domain/analysis";
import type { ResidueRecord, StructureSnapshot } from "../domain/types";
import type { InteractionCollector } from "./collector";
import type { Connectivity } from "./connectivity";
import { clashRadius, covalentRadius } from "./geometry";
import { SpatialGrid } from "./spatial";

export interface ContactContext {
  snapshot: StructureSnapshot;
  ligand: number[];
  receptor: number[];
  connectivity: Connectivity;
  residueOf: (atom: number) => ResidueRecord;
  parameters: AnalysisParameters;
}

/** All eligible ligand–receptor heavy-atom pairs within the proximity cutoff. Returns the bonded-pair exclusion count. */
export function proximityContacts(
  ctx: ContactContext,
  collector: InteractionCollector,
): number {
  const cutoff = ctx.parameters.proximityCutoff;
  const grid = new SpatialGrid(
    ctx.snapshot.atomBuffer.positions,
    ctx.receptor,
    cutoff,
  );
  let excludedBondedPairs = 0;
  for (const a of ctx.ligand)
    for (const near of grid.neighbors(a, cutoff)) {
      const b = near.index;
      if (ctx.connectivity.ligandReceptorBonded(a, b)) {
        excludedBondedPairs++;
        continue;
      }
      collector.record({
        type: "proximity_contact",
        ligand: {
          residueId: ctx.residueOf(a).id,
          atomIndices: [a],
          role: "ligand",
        },
        receptor: {
          residueId: ctx.residueOf(b).id,
          atomIndices: [b],
          role: "receptor",
        },
        distanceAngstrom: near.distance,
        closestAtomPair: [a, b],
        classification: "measured_proximity",
        notes: [],
      });
    }
  return excludedBondedPairs;
}

const CLASH_NOTE =
  "Heavy-atom van der Waals overlap using the Mol* radii table (doi:10.1021/jp8111556). Metals and unknown radii are excluded; this is not an energetic clash score.";

/**
 * Nonmetal heavy-atom van der Waals overlaps at or above the configured minimum,
 * searched independently of the proximity cutoff. Returns how many atoms had a radius.
 */
export function stericClashes(
  ctx: ContactContext,
  collector: InteractionCollector,
): { supportedLigand: number; supportedReceptor: number } {
  const positions = ctx.snapshot.atomBuffer.positions,
    minimum = ctx.parameters.clashOverlapMin;
  const radius = (atom: number) =>
    clashRadius(ctx.snapshot.atoms[atom].element);
  const ligandRadii = ctx.ligand.map(radius),
    receptorRadii = ctx.receptor.map(radius);
  const supportedLigand = ctx.ligand.filter(
      (_, i) => ligandRadii[i] !== undefined,
    ),
    supportedReceptor = ctx.receptor.filter(
      (_, i) => receptorRadii[i] !== undefined,
    );
  const largest = (radii: (number | undefined)[]) =>
    radii.reduce<number>((maximum, r) => Math.max(maximum, r ?? 0), 0);
  const searchCutoff = largest(ligandRadii) + largest(receptorRadii) - minimum;
  if (supportedLigand.length && supportedReceptor.length && searchCutoff > 0) {
    const grid = new SpatialGrid(positions, supportedReceptor, searchCutoff);
    for (const a of supportedLigand)
      for (const { index: b, distance } of grid.neighbors(a, searchCutoff)) {
        if (ctx.connectivity.ligandReceptorBonded(a, b)) continue;
        const radii: [number, number] = [radius(a)!, radius(b)!],
          overlap = radii[0] + radii[1] - distance;
        if (overlap + 1e-6 < minimum) continue;
        collector.record({
          type: "steric_clash",
          ligand: {
            residueId: ctx.residueOf(a).id,
            atomIndices: [a],
            role: "ligand",
          },
          receptor: {
            residueId: ctx.residueOf(b).id,
            atomIndices: [b],
            role: "receptor",
          },
          distanceAngstrom: distance,
          closestAtomPair: [a, b],
          geometry: { overlapAngstrom: overlap, vdwRadiiAngstrom: radii },
          classification: "candidate",
          notes: [CLASH_NOTE],
        });
      }
  }
  return {
    supportedLigand: supportedLigand.length,
    supportedReceptor: supportedReceptor.length,
  };
}

/**
 * Removes steric-overlap candidates between a typed hydrogen-bond donor and acceptor: a
 * short donor–acceptor distance is a strong hydrogen bond, not a clash. Matching H-bond
 * interactions get a note. Returns the number of exempted pairs.
 */
export function exemptPolarClashes(
  interactions: MolecularInteraction[],
  donors: Set<number>,
  acceptors: Set<number>,
): number {
  const polar = (a: number, b: number) =>
    (donors.has(a) && acceptors.has(b)) || (acceptors.has(a) && donors.has(b));
  const exempted = new Set<string>();
  for (let i = interactions.length - 1; i >= 0; i--) {
    const x = interactions[i];
    if (x.type !== "steric_clash" || !polar(...x.closestAtomPair)) continue;
    exempted.add(x.closestAtomPair.join(":"));
    interactions.splice(i, 1);
  }
  for (const x of interactions)
    if (x.type === "hydrogen_bond" && exempted.has(x.closestAtomPair.join(":")))
      x.notes.push(SHORT_HBOND_NOTE);
  return exempted.size;
}
export const SHORT_HBOND_NOTE =
  "Short donor–acceptor distance with van der Waals overlap; treated as a strong hydrogen bond, not a steric clash.";

/**
 * Ligand–receptor heavy-atom pairs closer than the sum of covalent radii plus 0.4 Å with no
 * recorded bond. Reported as a quality flag only; no bond is inferred.
 */
export function unrecordedCovalentContacts(
  interactions: MolecularInteraction[],
  snapshot: StructureSnapshot,
): [number, number][] {
  const found: [number, number][] = [];
  for (const x of interactions) {
    if (x.type !== "proximity_contact") continue;
    const [a, b] = x.closestAtomPair;
    const ra = covalentRadius(snapshot.atoms[a].element),
      rb = covalentRadius(snapshot.atoms[b].element);
    if (
      ra !== undefined &&
      rb !== undefined &&
      x.distanceAngstrom < ra + rb + 0.4
    )
      found.push([a, b]);
  }
  return found;
}
