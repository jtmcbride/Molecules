import { comparisonFitKey } from "./fitContext";
import type { PoseOptions } from "../domain/ligandPose";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import type { ComparisonSlot } from "../state/comparison";
export interface PoseReference {
  interpretation?: { id: string } | null;
  source: StructureSource | null;
  snapshot: StructureSnapshot | null;
  targetLigandId: string | null;
  ligandGroupId: string | null;
  analysisParameters: { minimumOccupancy: number };
}
export function poseResidues(
  snapshot: StructureSnapshot | null,
  target: string | null,
  group: string | null,
) {
  return (
    snapshot?.ligandGroups?.find((g) => g.id === group)?.residueIds ??
    (target ? [target] : [])
  );
}
/** Cheap identity for immediate invalidation. Exact chemistry and coordinate hashes enter
 * the final preparePoseInput key. Analysis runs, filters and visibility are irrelevant. */
export function poseContextKey(
  reference: PoseReference,
  slot: ComparisonSlot,
  options: PoseOptions,
) {
  return JSON.stringify([
    reference.source?.contentHash,
    reference.snapshot?.id,
    poseResidues(
      reference.snapshot,
      reference.targetLigandId,
      reference.ligandGroupId,
    ),
    slot.phase,
    slot.source?.contentHash,
    slot.snapshot?.id,
    poseResidues(slot.snapshot, slot.targetLigandId, slot.ligandGroupId),
    reference.analysisParameters.minimumOccupancy,
    options,
    slot.superpositionScope,
    slot.superposition,
    slot.superpositionKey,
    comparisonFitKey(reference, slot),
    slot.transform,
  ]);
}
export function poseAlternates(
  snapshot: StructureSnapshot | null,
  residueIds: string[],
) {
  const selected = new Set(residueIds);
  return [
    ...new Set(
      snapshot?.residues
        .filter((r) => selected.has(r.id))
        .flatMap((r) =>
          r.atomIndices.flatMap((i) => snapshot.atoms[i].altId ?? []),
        ),
    ),
  ].sort();
}

/** Retain a chosen label only while the selected ligand still provides it. Never choose
 * another alternate automatically: null requires an explicit new choice when alternates exist. */
export function currentPoseOptions(
  reference: PoseReference,
  slot: ComparisonSlot,
  options: PoseOptions,
): PoseOptions {
  return {
    referenceConformerId: poseAlternates(
      reference.snapshot,
      poseResidues(
        reference.snapshot,
        reference.targetLigandId,
        reference.ligandGroupId,
      ),
    ).includes(options.referenceConformerId ?? "")
      ? options.referenceConformerId
      : null,
    comparisonConformerId: poseAlternates(
      slot.snapshot,
      poseResidues(slot.snapshot, slot.targetLigandId, slot.ligandGroupId),
    ).includes(options.comparisonConformerId ?? "")
      ? options.comparisonConformerId
      : null,
  };
}
