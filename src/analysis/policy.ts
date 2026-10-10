import { SpatialGrid } from "./spatial";
import type {
  AnalysisRequest,
  MolecularInteraction,
  ResidueInteractionSummary,
} from "../domain/analysis";
import type { StructureSnapshot } from "../domain/types";
import { isHydrogenElement } from "../domain/elements";
export const STANDARD_COMPONENTS = new Set([
  "ALA",
  "ARG",
  "ASN",
  "ASP",
  "CYS",
  "GLN",
  "GLU",
  "GLY",
  "HIS",
  "ILE",
  "LEU",
  "LYS",
  "MET",
  "PHE",
  "PRO",
  "SER",
  "THR",
  "TRP",
  "TYR",
  "VAL",
  "A",
  "C",
  "G",
  "U",
  "DA",
  "DC",
  "DG",
  "DT",
]);
export function validateRequest(
  snapshot: StructureSnapshot,
  request: AnalysisRequest,
) {
  if (!snapshot.ligands.some((l) => l.residueId === request.ligandResidueId))
    throw new Error("Select a ligand instance from this structure.");
  if (
    !request.receptorChainIds.length ||
    request.receptorChainIds.some(
      (id) => !snapshot.chains.some((c) => c.id === id && c.type === "polymer"),
    )
  )
    throw new Error("Choose at least one polymer chain as the receptor.");
  const p = request.parameters;
  for (const cutoff of [
    p.proximityCutoff,
    p.hydrogenBondCutoff,
    p.hydrophobicCutoff,
    p.saltBridgeCutoff,
    p.piStackingCutoff,
    p.cationPiCutoff,
    p.halogenBondCutoff,
    p.metalCutoff,
    p.waterLegMin,
    p.waterLegMax,
  ])
    if (!Number.isFinite(cutoff) || cutoff < 1 || cutoff > 8)
      throw new Error("Distance cutoffs must be between 1 and 8 Å.");
  for (const [value, min, max] of [
    [p.piOffsetMax, 0, 4],
    [p.piAngleDeviation, 0, 45],
    [p.halogenAngleDeviation, 0, 60],
    [p.waterAngleMin, 0, 180],
    [p.waterAngleMax, 0, 180],
    [p.clashOverlapMin, 0.1, 2],
  ])
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error("Geometry settings are outside their supported ranges.");
  if (p.waterLegMin > p.waterLegMax || p.waterAngleMin > p.waterAngleMax)
    throw new Error("Water bridge minimums must not exceed their maximums.");
  if (!["element_specific", "uniform"].includes(p.metalDistancePolicy))
    throw new Error("Unknown metal distance policy.");
  if (
    !Number.isFinite(p.metalTolerance) ||
    p.metalTolerance < 0.1 ||
    p.metalTolerance > 1
  )
    throw new Error("Metal distance tolerance must be between 0.1 and 1 Å.");
  if (
    !Number.isFinite(p.minimumOccupancy) ||
    p.minimumOccupancy < 0 ||
    p.minimumOccupancy > 1
  )
    throw new Error("Minimum occupancy must be between 0 and 1.");
  if (
    !["ensemble", "exclude_disordered", "preferred_residue"].includes(
      p.conformerPolicy,
    )
  )
    throw new Error("Unknown alternate-conformer policy.");
}
/**
 * Atoms eligible as endpoints or context. `selection` (ensemble mode) supplies one
 * conformer's atoms; otherwise each residue's recorded preferred conformer is used.
 */
export function eligibleAtoms(
  snapshot: StructureSnapshot,
  request: AnalysisRequest,
  selection?: Set<number>,
) {
  validateRequest(snapshot, request);
  const preferred =
    selection ?? new Set(snapshot.atomBuffer.preferredAtomIndices);
  const receptorChains = new Set(request.receptorChainIds);
  const context: number[] = [],
    ligand: number[] = [],
    receptor: number[] = [],
    waters: number[] = [];
  let excludedDisorderedResidues = 0,
    excludedOccupancyAtoms = 0;
  for (const residue of snapshot.residues) {
    const isTarget = residue.id === request.ligandResidueId;
    const isReceptor =
      residue.kind === "polymer" && receptorChains.has(residue.chainId);
    const isWater =
      residue.kind === "water" &&
      request.parameters.includeWaters &&
      request.parameters.classifyChemistry;
    if (!isTarget && !isReceptor && !isWater) continue;
    const disordered = residue.atomIndices.some(
      (i) => snapshot.atoms[i].altId !== null,
    );
    if (
      disordered &&
      request.parameters.conformerPolicy === "exclude_disordered"
    ) {
      if (isTarget)
        throw new Error(
          "This ligand has alternate conformers. Choose the per-conformer ensemble or “Preferred per residue”.",
        );
      excludedDisorderedResidues++;
      continue;
    }
    for (const index of residue.atomIndices) {
      if (!preferred.has(index)) continue;
      const occupancy = snapshot.atomBuffer.occupancies[index];
      if (
        !Number.isFinite(occupancy) ||
        occupancy <= 0 ||
        occupancy < request.parameters.minimumOccupancy
      ) {
        excludedOccupancyAtoms++;
        continue;
      }
      context.push(index);
      if (isHydrogenElement(snapshot.atoms[index].element)) continue;
      (isTarget ? ligand : isWater ? waters : receptor).push(index);
    }
  }
  if (!ligand.length)
    throw new Error(
      "The chosen ligand has no eligible heavy atoms under these settings.",
    );
  if (!receptor.length)
    throw new Error(
      "The receptor has no eligible heavy atoms under these settings.",
    );
  const waterGrid = new SpatialGrid(
    snapshot.atomBuffer.positions,
    waters,
    request.parameters.waterLegMax,
  );
  const nearWaters = new Set(
    ligand.flatMap((i) =>
      waterGrid
        .neighbors(i, request.parameters.waterLegMax)
        .map((n) => snapshot.atomBuffer.residueIndices[n.index]),
    ),
  );
  return {
    context: context.filter(
      (i) =>
        snapshot.residues[snapshot.atomBuffer.residueIndices[i]].kind !==
          "water" || nearWaters.has(snapshot.atomBuffer.residueIndices[i]),
    ),
    ligand,
    receptor,
    waters: waters.filter((i) =>
      nearWaters.has(snapshot.atomBuffer.residueIndices[i]),
    ),
    excludedDisorderedResidues,
    excludedOccupancyAtoms,
  };
}
export function summarizeInteractions(interactions: MolecularInteraction[]) {
  const grouped = new Map<string, ResidueInteractionSummary>();
  const graph: Record<string, string[]> = {};
  for (const interaction of interactions) {
    const id = interaction.receptor.residueId;
    const summary = grouped.get(id) ?? {
      residueId: id,
      proximityPairCount: 0,
      chemicalInteractionCount: 0,
      clashCount: 0,
      minimumDistance: Infinity,
      types: [],
      interactionIds: [],
    };
    if (interaction.type === "proximity_contact") summary.proximityPairCount++;
    else if (interaction.type === "steric_clash") summary.clashCount++;
    else summary.chemicalInteractionCount++;
    summary.minimumDistance = Math.min(
      summary.minimumDistance,
      interaction.distanceAngstrom,
    );
    if (!summary.types.includes(interaction.type))
      summary.types.push(interaction.type);
    summary.interactionIds.push(interaction.id);
    grouped.set(id, summary);
    for (const residueId of [
      interaction.ligand.residueId,
      interaction.receptor.residueId,
      ...(interaction.mediator ? [interaction.mediator.residueId] : []),
    ])
      (graph[residueId] ??= []).push(interaction.id);
  }
  return {
    residues: [...grouped.values()].sort(
      (a, b) =>
        a.minimumDistance - b.minimumDistance ||
        a.residueId.localeCompare(b.residueId),
    ),
    graph,
  };
}
