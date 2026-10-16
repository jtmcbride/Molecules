import type { StructureSnapshot } from "../domain/types";
import type { SuperpositionResult } from "../domain/comparison";
import { isHydrogenElement, normalizeElement } from "../domain/elements";
import {
  LIGAND_POSE_VERSION,
  POSE_ALGORITHM_VERSION,
  POSE_MAX_HEAVY_ATOMS,
  poseUnavailable,
  type PoseAttachmentContext,
  type PoseChemistry,
  type PoseLigandPreparation,
  type PreparedPoseLigand,
  type LigandPoseInput,
  type PoseUnavailable,
} from "../domain/ligandPose";
import { isProperPoseTransform } from "./poseTransform";
import { hashBytes } from "../data/provider";

/** Pure eligibility checks on a selected, explicitly sourced chemical definition.
 * It prepares input only; graph isomorphisms and stereo permutation checks belong to M4-B.
 */
export function preparePoseLigand(
  snapshot: StructureSnapshot,
  residueIds: string[],
  chemistry: PoseChemistry,
  attachment: PoseAttachmentContext,
  {
    conformerId = null,
    minimumOccupancy = 0,
  }: { conformerId?: string | null; minimumOccupancy?: number } = {},
): PoseLigandPreparation {
  if (!residueIds.length)
    return poseUnavailable("missing_ligand", "No ligand is selected.");
  if (residueIds.length !== 1)
    return poseUnavailable(
      "ligand_group",
      "Pose comparison requires exactly one nonpolymer ligand residue.",
    );
  const residue = snapshot.residues.find((r) => r.id === residueIds[0]);
  if (!residue)
    return poseUnavailable(
      "missing_ligand",
      "The selected ligand is absent from these coordinates.",
    );
  if (residue.kind !== "ligand")
    return poseUnavailable(
      "unsupported_ligand",
      "Only single nonpolymer ligands are supported; ions and branched ligands are excluded.",
    );
  if (snapshot.ligandGroups?.some((g) => g.residueIds.includes(residue.id)))
    return poseUnavailable(
      "ligand_group",
      "This residue belongs to a multi-residue ligand group.",
    );
  if (
    chemistry.componentId !== residue.componentId ||
    chemistry.graph.componentId !== residue.componentId
  )
    return poseUnavailable(
      "chemistry_conflict",
      "The chemical definition belongs to a different component.",
    );
  if (chemistry.graph.containsMetal)
    return poseUnavailable(
      "metal_containing",
      "Metal-containing ligands, including HEM, are outside the initial pose scope.",
    );
  if (
    attachment.snapshotId !== snapshot.id ||
    attachment.sourceHash !== snapshot.provenance.contentHash ||
    attachment.residueId !== residue.id
  )
    return poseUnavailable(
      "source_mismatch",
      "Attachment context belongs to different coordinates or a different ligand.",
    );
  if (attachment.status === "covalent")
    return poseUnavailable(
      "covalent_attachment",
      "A deposited covalent attachment connects this ligand to another residue or symmetry instance.",
    );
  if (attachment.status !== "no_recorded_link")
    return poseUnavailable(
      "attachment_unknown",
      "Deposited connection identifiers cannot rule out a covalent attachment.",
    );
  if (
    !Number.isFinite(minimumOccupancy) ||
    minimumOccupancy < 0 ||
    minimumOccupancy > 1
  )
    return poseUnavailable(
      "invalid_occupancy_policy",
      "Minimum occupancy must be finite and between 0 and 1.",
    );
  const graph = chemistry.graph;
  if (
    !graph.atoms.length ||
    !graph.bonds.length ||
    graph.atoms.some(
      (a) => a.charge === null || a.aromatic === null || a.stereo === null,
    ) ||
    graph.bonds.some(
      (b) => b.sourceOrder === null || b.aromatic === null || b.stereo === null,
    )
  )
    return poseUnavailable(
      "missing_chemistry",
      "Complete atom charges, aromatic flags and stereochemical labels are required.",
    );
  const expected = graph.atoms.filter((a) => !isHydrogenElement(a.element));
  if (expected.length > POSE_MAX_HEAVY_ATOMS)
    return poseUnavailable(
      "atom_limit",
      `The pose policy supports at most ${POSE_MAX_HEAVY_ATOMS} heavy atoms.`,
    );
  const heavy = residue.atomIndices.filter(
    (i) => !isHydrogenElement(snapshot.atoms[i].element),
  );
  const alternates = new Set(
    residue.atomIndices.flatMap((i) => snapshot.atoms[i].altId ?? []),
  );
  if (alternates.size && conformerId === null)
    return poseUnavailable(
      "conformer_required",
      "Select one coherent alternate conformer explicitly (shared atoms plus that label).",
    );
  if (conformerId !== null && !alternates.has(conformerId))
    return poseUnavailable(
      "invalid_conformer",
      "The selected alternate conformer is not present in this ligand.",
    );
  const selected = heavy.filter(
    (i) =>
      snapshot.atoms[i].altId === null ||
      snapshot.atoms[i].altId === conformerId,
  );
  const byName = new Map<string, number>();
  const definitions = new Map(expected.map((a) => [a.name, a]));
  for (const i of selected) {
    const atom = snapshot.atoms[i],
      definition = definitions.get(atom.name);
    if (
      !definition ||
      normalizeElement(atom.element) !== definition.element ||
      (atom.formalCharge !== null && atom.formalCharge !== definition.charge)
    )
      return poseUnavailable(
        "atom_mismatch",
        `Deposited atom ${atom.name} disagrees with the chemical definition (name, element or specified charge).`,
      );
    const occupancy = snapshot.atomBuffer.occupancies[i];
    if (
      !Number.isFinite(occupancy) ||
      occupancy <= minimumOccupancy ||
      occupancy <= 0
    )
      continue;
    if (byName.has(atom.name))
      return poseUnavailable(
        "duplicate_atom",
        `Conformer selection contains more than one eligible atom named ${atom.name}.`,
      );
    if (
      ![0, 1, 2].every((axis) =>
        Number.isFinite(snapshot.atomBuffer.positions[3 * i + axis]),
      )
    )
      return poseUnavailable(
        "nonfinite_coordinates",
        `Atom ${atom.name} has non-finite coordinates.`,
      );
    byName.set(atom.name, i);
  }
  const missing = expected
    .filter((a) => !byName.has(a.name))
    .map((a) => a.name);
  if (missing.length || !expected.length)
    return poseUnavailable(
      "incomplete_ligand",
      `Missing eligible heavy atoms: ${missing.join(", ") || "all"}. Occupancy and conformer selection are applied before completeness.`,
    );
  const indices = expected.map((a) => byName.get(a.name)!);
  return {
    status: "prepared",
    ligand: {
      sourceHash: snapshot.provenance.contentHash,
      snapshotId: snapshot.id,
      parser: snapshot.provenance.parser,
      modelIndex: snapshot.modelIndex,
      modelNumber: snapshot.modelNumber,
      assemblyId: snapshot.assemblyId,
      residueId: residue.id,
      componentId: residue.componentId,
      conformerId,
      minimumOccupancy,
      chemistryId: chemistry.id,
      chemistryHash: chemistry.contentHash,
      graphHash: chemistry.graphHash,
      graph: structuredClone(graph),
      attachment: structuredClone(attachment),
      atomIds: indices.map((i) => snapshot.atoms[i].id),
      atomNames: expected.map((a) => a.name),
      sourceRows: indices.map((i) => snapshot.atoms[i].sourceRow),
      positions: new Float64Array(
        indices.flatMap((i) =>
          Array.from(snapshot.atomBuffer.positions.slice(3 * i, 3 * i + 3)),
        ),
      ),
    },
  };
}

/** Package two eligible ligands in the fixed protein frame; this does not fit or score them. */
export async function preparePoseInput(
  reference: PreparedPoseLigand,
  comparison: PreparedPoseLigand,
  fit: SuperpositionResult | null,
  fitInputKey: string,
): Promise<PoseUnavailable | { status: "prepared"; input: LigandPoseInput }> {
  if (reference.componentId !== comparison.componentId)
    return poseUnavailable(
      "different_component",
      "The first pose policy requires the same chemical component ID on both sides.",
    );
  if (reference.graphHash !== comparison.graphHash)
    return poseUnavailable(
      "chemistry_conflict",
      "The pinned, name-addressed chemical graphs differ; cross-definition equivalence is not inferred.",
    );
  if (!fit || !fitInputKey || !["global", "binding_site"].includes(fit.scope))
    return poseUnavailable(
      "missing_fit",
      "Select a valid protein superposition before preparing a pose comparison.",
    );
  if (!isProperPoseTransform(fit.transform))
    return poseUnavailable(
      "invalid_transform",
      "Pose inputs require a finite, proper rigid protein transform (no scale, shear or reflection).",
    );
  if (![...reference.positions, ...comparison.positions].every(Number.isFinite))
    return poseUnavailable(
      "nonfinite_coordinates",
      "Pose coordinates must be finite.",
    );
  const input = structuredClone({
    version: LIGAND_POSE_VERSION,
    algorithmVersion: POSE_ALGORITHM_VERSION,
    reference,
    comparison,
    fit,
    fitInputKey,
  });
  const inputKey = await hashBytes(
    new TextEncoder().encode(
      JSON.stringify(input, (_key, value) =>
        value instanceof Float64Array ? Array.from(value) : value,
      ),
    ),
  );
  return { status: "prepared", input: { ...input, inputKey } };
}
