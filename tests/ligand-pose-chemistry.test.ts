import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { prepareLigandPose } from "../src/data/ligandChemistry";
import { database } from "../src/data/repository";
import { benChemistry, poseFixture, sha } from "./helpers/ligandPose";
import { prepareStructure } from "../src/analysis/prepare";
import type {
  PoseChemistry,
  PoseLigandPreparation,
} from "../src/domain/ligandPose";
let p: Awaited<ReturnType<typeof poseFixture>>, ben: PoseChemistry;
beforeAll(async () => {
  [p, ben] = await Promise.all([poseFixture(), benChemistry()]);
});
beforeEach(async () => {
  await database.delete();
  await database.open();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(ben.bytes.slice())),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
});
const run = (extra: Partial<Parameters<typeof prepareLigandPose>[0]> = {}) =>
  prepareLigandPose({
    source: p.source,
    snapshot: p.snapshot,
    residueIds: [p.residue.id],
    signal: new AbortController().signal,
    ...extra,
  });
function prepared(r: PoseLigandPreparation) {
  if (r.status !== "prepared") throw Error(JSON.stringify(r));
  return r.ligand;
}

it("uses CCD fallback without an analysis, caches by hash, and restores pinned chemistry offline", async () => {
  const a = prepared(await run());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    "https://files.rcsb.org/ligands/download/BEN.cif",
  );
  const stored = (await database.poseChemistry.get(a.chemistryId))!;
  expect(stored.contentHash).toBe(ben.contentHash);
  expect(stored.bytes).toEqual(ben.bytes);
  expect(stored.graphHash).toBe(ben.graphHash);
  expect(await database.chemicalDefinitions.count()).toBe(0);
  expect(await database.analyses.count()).toBe(0);
  expect(await database.ligandPoses.count()).toBe(0);
  expect(prepared(await run()).chemistryId).toBe(a.chemistryId);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockImplementation(async () => {
    throw Error("offline");
  });
  expect(
    prepared(await run({ pinnedChemistryId: a.chemistryId })).positions,
  ).toEqual(a.positions);
  expect(fetch).toHaveBeenCalledTimes(1);
  await database.poseChemistry.delete(a.chemistryId);
  expect(await run({ pinnedChemistryId: a.chemistryId })).toMatchObject({
    code: "pinned_chemistry_missing",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps different byte revisions and restores the exact older pin", async () => {
  const a = prepared(await run());
  const stored = await database.poseChemistry.get(a.chemistryId);
  const revision = new TextEncoder().encode(
    new TextDecoder().decode(ben.bytes) +
      "\n# synthetic metadata-only revision\n",
  );
  vi.mocked(fetch).mockResolvedValue(new Response(revision));
  const b = prepared(await run({ refresh: true }));
  expect(b.chemistryId).not.toBe(a.chemistryId);
  expect(b.graphHash).toBe(a.graphHash);
  expect(await database.poseChemistry.count()).toBe(2);
  expect(await database.poseChemistry.get(a.chemistryId)).toEqual(stored);
  expect(
    prepared(await run({ pinnedChemistryId: a.chemistryId })).chemistryHash,
  ).toBe(a.chemistryHash);
  await expect(
    run({ pinnedChemistryId: a.chemistryId, refresh: true }),
  ).rejects.toThrow(/cannot be refreshed/);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("refuses damaged pins and supplied definitions that contradict embedded facts", async () => {
  const a = prepared(await run());
  await database.poseChemistry.update(a.chemistryId, {
    bytes: new Uint8Array([1, 2, 3]),
  }); // synthetic storage corruption
  expect(await run({ pinnedChemistryId: a.chemistryId })).toMatchObject({
    code: "pinned_chemistry_missing",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const conflicting = new TextDecoder()
    .decode(ben.bytes)
    .replace("BEN C  N1   DOUB N E", "BEN C  N1   DOUB N Z");
  vi.mocked(fetch).mockResolvedValue(new Response(conflicting));
  expect(await run({ refresh: true })).toMatchObject({
    code: "chemistry_conflict",
  });
  expect(await database.poseChemistry.count()).toBe(1);
});
it("prefers a sufficiently specified embedded graph, with its coordinate source pinned", async () => {
  // Artificially enrich 3PTB's embedded BEN dictionary by substituting frozen CCD atom/bond loops.
  const ccd = new TextDecoder().decode(ben.bytes),
    original = new TextDecoder().decode(p.source.bytes);
  const loops = ["chem_comp_atom", "chem_comp_bond"].map(
    (name) => ccd.match(new RegExp(`loop_\\s+_${name}\\.[\\s\\S]*?(?=#)`))![0],
  );
  let text = original;
  for (const name of ["chem_comp_atom", "chem_comp_bond"])
    text = text.replace(new RegExp(`loop_\\s+_${name}\\.[\\s\\S]*?(?=#)`), "");
  const bytes = new TextEncoder().encode(
    text + "\n" + loops.join("\n#\n") + "\n#\n",
  );
  const source = { ...p.source, bytes, contentHash: sha(bytes) };
  const { snapshot } = await prepareStructure(source, 0, "");
  const ligand = snapshot.ligands.find((l) => l.componentId === "BEN")!;
  const a = prepared(
    await run({ source, snapshot, residueIds: [ligand.residueId] }),
  );
  expect(fetch).not.toHaveBeenCalled();
  const stored = (await database.poseChemistry.get(a.chemistryId))!;
  expect(stored.origin).toBe("embedded");
  expect(stored.bytes).toEqual(bytes);
  expect(stored.contentHash).toBe(source.contentHash);
});
it("does not fetch for HEM, covalent ligands, groups, or mismatched coordinate bytes", async () => {
  for (const [path, component, code] of [
    ["public/structures/4HHB.cif", "HEM", "metal_containing"],
    ["tests/fixtures/reference-set/5P9J.cif.gz", "8E8", "covalent_attachment"],
  ]) {
    const f = await poseFixture(path, component);
    expect(
      await run({
        source: f.source,
        snapshot: f.snapshot,
        residueIds: [f.residue.id],
      }),
    ).toMatchObject({ code });
  }
  expect(await run({ residueIds: [] })).toMatchObject({
    code: "missing_ligand",
  });
  expect(await run({ residueIds: [p.residue.id, p.residue.id] })).toMatchObject(
    { code: "ligand_group" },
  );
  expect(
    await run({ source: { ...p.source, bytes: new Uint8Array([1]) } }),
  ).toMatchObject({ code: "source_mismatch" });
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps network, size-limit and cancellation failures separate from scientific refusals", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("missing", { status: 404 }));
  await expect(run()).rejects.toThrow(/HTTP 404/);
  vi.mocked(fetch).mockResolvedValue(
    new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
  );
  await expect(run()).rejects.toThrow(/exceeds 2 MB/);
  const abort = new AbortController();
  abort.abort();
  await expect(run({ signal: abort.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(await database.poseChemistry.count()).toBe(0);
});
it("upgrades an existing v4 database without changing old chemistry or saved analyses", async () => {
  await database.close();
  await Dexie.delete("molecular-explorer");
  const old = new Dexie("molecular-explorer");
  old.version(4).stores({
    sources: "contentHash, id, fetchedAt",
    sourceUsage: "contentHash, lastUsedAt",
    sessions: "id",
    analyses: "cacheKey, sourceHash, generatedAt",
    chemicalDefinitions: "componentId",
    biologyResources: "id, key, contentHash, retrievedAt",
    proteins: "id, accession, sequenceHash",
    interpretations: "id, snapshotId, sourceHash, createdAt",
  });
  const legacy = {
    componentId: "BEN",
    contentHash: "legacy",
    bytes: new Uint8Array([9]),
  };
  await old.table("chemicalDefinitions").put(legacy);
  await old.table("analyses").put({ cacheKey: "old-run", retained: true });
  await old.table("sessions").put({
    id: "last",
    descriptor: { schemaVersion: 3, sourceHash: p.source.contentHash },
  });
  await old.table("sources").put(p.source);
  old.close();
  await database.open();
  expect(database.verno).toBe(5);
  expect(await database.chemicalDefinitions.get("BEN")).toEqual(legacy);
  expect(await database.analyses.get("old-run")).toMatchObject({
    retained: true,
  });
  expect(await database.sessions.get("last")).toMatchObject({
    descriptor: { schemaVersion: 3 },
  });
  expect(await database.sources.get(p.source.contentHash)).toEqual(p.source);
  expect(await database.poseChemistry.count()).toBe(0);
  prepared(await run());
  expect(await database.chemicalDefinitions.get("BEN")).toEqual(legacy);
});
