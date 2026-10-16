import type { StructureSnapshot, StructureSource } from "../domain/types";
import {
  LIGAND_POSE_VERSION,
  POSE_CHEMISTRY_VERSION,
  poseUnavailable,
  type PoseChemistry,
  type PoseGraphRead,
  type PoseLigandPreparation,
} from "../domain/ligandPose";
import {
  chemicalGraph,
  chemicalGraphConflict,
  poseAttachment,
  poseCifFrame,
  poseGraphIdentity,
} from "../structure/chemicalGraph";
import { preparePoseLigand } from "../comparison/ligandPoseInput";
import { hashBytes } from "./provider";
import { database } from "./repository";

const MAX_CCD_BYTES = 2 * 1024 * 1024;
async function fetchCcd(componentId: string, signal: AbortSignal) {
  const url = `https://files.rcsb.org/ligands/download/${componentId}.cif`;
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok)
    throw Error(
      `Chemical definition request failed (HTTP ${response.status}).`,
    );
  if (
    !response.body ||
    Number(response.headers.get("content-length")) > MAX_CCD_BYTES
  )
    throw Error("Chemical definition is empty or exceeds 2 MB.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_CCD_BYTES)
        throw Error("Chemical definition exceeds 2 MB.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    bytes,
    binary: false,
    origin: "ccd" as const,
    url,
    retrievedAt: new Date().toISOString(),
  };
}
const chemistryId = (
  componentId: string,
  contentHash: string,
  origin: PoseChemistry["origin"],
) =>
  JSON.stringify([
    POSE_CHEMISTRY_VERSION,
    LIGAND_POSE_VERSION,
    componentId,
    origin,
    contentHash,
  ]);

/** A caller must supply an explicit pinned ID to restore; missing pins never cause a request.
 * Operation failures (network/storage/abort) throw. Scientific refusals return not_evaluated.
 * This entry point is independent of the interaction-analysis loader and its mutable CCD cache.
 */
export async function prepareLigandPose({
  source,
  snapshot,
  residueIds,
  signal,
  conformerId,
  minimumOccupancy,
  pinnedChemistryId,
  refresh = false,
}: {
  source: StructureSource;
  snapshot: StructureSnapshot;
  residueIds: string[];
  signal: AbortSignal;
  conformerId?: string | null;
  minimumOccupancy?: number;
  pinnedChemistryId?: string;
  refresh?: boolean;
}): Promise<PoseLigandPreparation> {
  signal.throwIfAborted();
  if (!residueIds.length)
    return poseUnavailable("missing_ligand", "No ligand is selected.");
  if (residueIds.length !== 1)
    return poseUnavailable(
      "ligand_group",
      "Select exactly one ligand residue.",
    );
  const residue = snapshot.residues.find((r) => r.id === residueIds[0]);
  if (!residue)
    return poseUnavailable("missing_ligand", "The selected ligand is absent.");
  if (residue.kind !== "ligand")
    return poseUnavailable(
      "unsupported_ligand",
      "Ions, branched ligands and polymer residues are outside the initial scope.",
    );
  if (!/^[A-Z0-9]{1,8}$/.test(residue.componentId))
    return poseUnavailable(
      "invalid_chemistry",
      "Unsupported component identifier.",
    );
  if (
    snapshot.provenance.contentHash !== source.contentHash ||
    (await hashBytes(source.bytes)) !== source.contentHash
  )
    return poseUnavailable(
      "source_mismatch",
      "The coordinate source bytes do not match the snapshot's pinned hash.",
    );
  const frame = await poseCifFrame(source.bytes, source.binary);
  const embedded = chemicalGraph(frame, residue.componentId);
  if (embedded.status === "not_evaluated") return embedded;
  const attachment = poseAttachment(frame, snapshot, residue.id);
  if (attachment.status === "covalent")
    return poseUnavailable(
      "covalent_attachment",
      "The source records a covalent attachment for this ligand.",
    );
  if (attachment.status === "unknown")
    return poseUnavailable(
      "attachment_unknown",
      "The source's connection identifiers cannot rule out a covalent attachment.",
    );
  if (snapshot.ligandGroups?.some((g) => g.residueIds.includes(residue.id)))
    return poseUnavailable(
      "ligand_group",
      "The residue belongs to a multi-residue ligand group.",
    );
  if (embedded.graph.containsMetal)
    return poseUnavailable(
      "metal_containing",
      "Metal-containing ligands, including HEM, are outside the initial pose scope.",
    );
  const inspect = async (record: PoseChemistry) => {
    try {
      if (
        record.componentId !== residue.componentId ||
        record.parserVersion !== POSE_CHEMISTRY_VERSION ||
        record.policyVersion !== LIGAND_POSE_VERSION ||
        record.id !==
          chemistryId(record.componentId, record.contentHash, record.origin) ||
        (await hashBytes(record.bytes)) !== record.contentHash ||
        (record.origin === "embedded" &&
          record.contentHash !== source.contentHash)
      )
        return null;
      const parsed = chemicalGraph(
        await poseCifFrame(record.bytes, record.binary),
        residue.componentId,
      );
      if (
        parsed.status !== "complete" ||
        (await hashBytes(
          new TextEncoder().encode(poseGraphIdentity(parsed.graph)),
        )) !== record.graphHash
      )
        return null;
      return { ...record, graph: parsed.graph };
    } catch {
      return null;
    }
  };
  let chemistry: PoseChemistry | null = null;
  if (pinnedChemistryId !== undefined) {
    if (refresh)
      throw Error(
        "Pinned chemistry cannot be refreshed in place; request a new preparation explicitly.",
      );
    const saved = await database.poseChemistry.get(pinnedChemistryId);
    if (saved) chemistry = await inspect(saved);
    if (!chemistry)
      return poseUnavailable(
        "pinned_chemistry_missing",
        "The exact saved chemical definition is missing, incompatible or damaged; recalculate explicitly.",
      );
  } else {
    if (embedded.status !== "complete" && !refresh) {
      const cached = await database.poseChemistry
        .where("componentId")
        .equals(residue.componentId)
        .sortBy("retrievedAt");
      for (const record of cached.reverse())
        if (record.origin === "ccd" && (chemistry = await inspect(record)))
          break;
    }
    if (!chemistry) {
      const raw =
        embedded.status === "complete"
          ? {
              bytes: source.bytes,
              binary: source.binary,
              origin: "embedded" as const,
              url: source.url,
              retrievedAt: source.fetchedAt,
            }
          : await fetchCcd(residue.componentId, signal);
      const parsed: PoseGraphRead =
        raw.origin === "embedded"
          ? embedded
          : chemicalGraph(await poseCifFrame(raw.bytes), residue.componentId);
      if (parsed.status === "not_evaluated") return parsed;
      if (parsed.status !== "complete")
        return poseUnavailable(
          "missing_chemistry",
          "The chosen source lacks complete charges, aromatic flags, stereochemistry or chemical connectivity.",
        );
      const contentHash = await hashBytes(raw.bytes),
        graphHash = await hashBytes(
          new TextEncoder().encode(poseGraphIdentity(parsed.graph)),
        );
      chemistry = {
        ...raw,
        bytes: raw.bytes.slice(),
        componentId: residue.componentId,
        id: chemistryId(residue.componentId, contentHash, raw.origin),
        parserVersion: POSE_CHEMISTRY_VERSION,
        policyVersion: LIGAND_POSE_VERSION,
        contentHash,
        graphHash,
        graph: parsed.graph,
      };
    }
  }
  const conflict = chemicalGraphConflict(embedded.graph, chemistry.graph);
  if (conflict) return poseUnavailable("chemistry_conflict", conflict);
  signal.throwIfAborted();
  // Add-only: refreshing never replaces bytes or retrieval metadata of an existing revision.
  await database.transaction("rw", database.poseChemistry, async () => {
    if (!(await database.poseChemistry.get(chemistry!.id)))
      await database.poseChemistry.add(chemistry!);
  });
  signal.throwIfAborted();
  return preparePoseLigand(snapshot, residueIds, chemistry, attachment, {
    conformerId,
    minimumOccupancy,
  });
}
