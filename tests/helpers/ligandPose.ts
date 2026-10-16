import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { prepareStructure } from "../../src/analysis/prepare";
import {
  chemicalGraph,
  poseCifFrame,
  poseGraphIdentity,
  poseAttachment,
} from "../../src/structure/chemicalGraph";
import {
  LIGAND_POSE_VERSION,
  POSE_CHEMISTRY_VERSION,
  type PoseChemistry,
} from "../../src/domain/ligandPose";
import type { StructureSource } from "../../src/domain/types";
export const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export async function poseFixture(
  path = "public/structures/3PTB.cif",
  component = "BEN",
  assembly = "",
) {
  const raw = await readFile(path),
    bytes = new Uint8Array(path.endsWith(".gz") ? gunzipSync(raw) : raw);
  const source: StructureSource = {
    id: path,
    name: path,
    kind: "local",
    format: "mmcif",
    binary: path.endsWith(".bcif"),
    bytes,
    contentHash: sha(bytes),
    fetchedAt: "2026-10-15T00:00:00Z",
  };
  const p = await prepareStructure(source, 0, assembly);
  const residue = p.snapshot.residues.find((r) => r.componentId === component)!;
  const frame = await poseCifFrame(bytes, source.binary);
  return {
    ...p,
    source,
    residue,
    frame,
    attachment: poseAttachment(frame, p.snapshot, residue.id),
  };
}
export async function benChemistry(): Promise<PoseChemistry> {
  const bytes = new Uint8Array(await readFile("tests/fixtures/BEN-ccd.cif"));
  const result = chemicalGraph(await poseCifFrame(bytes), "BEN");
  if (result.status !== "complete") throw Error(JSON.stringify(result));
  const contentHash = sha(bytes);
  return {
    id: JSON.stringify([
      POSE_CHEMISTRY_VERSION,
      LIGAND_POSE_VERSION,
      "BEN",
      "ccd",
      contentHash,
    ]),
    componentId: "BEN",
    bytes,
    binary: false,
    origin: "ccd",
    retrievedAt: "2026-10-15T00:00:00Z",
    url: "https://files.rcsb.org/ligands/download/BEN.cif",
    contentHash,
    graphHash: sha(poseGraphIdentity(result.graph)),
    parserVersion: POSE_CHEMISTRY_VERSION,
    policyVersion: LIGAND_POSE_VERSION,
    graph: result.graph,
  };
}
