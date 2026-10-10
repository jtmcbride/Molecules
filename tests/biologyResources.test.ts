import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cacheSource,
  database,
  enforceCacheBudget,
  getLastSession,
  saveSession,
} from "../src/data/repository";
import {
  biologyResource,
  uniprotRequest,
  BIOLOGY_FRESHNESS_MS,
} from "../src/data/biologyResources";
import { queryClient } from "../src/data/provider";
import { loadInterpretation } from "../src/biology/load";
import { biologyFixture } from "./helpers/biology";
import { readFile } from "node:fs/promises";
import type { ResourceSnapshot } from "../src/domain/biology";
import type { SessionDescriptor } from "../src/domain/types";
const request = uniprotRequest("P00760");
const resource = (
  retrievedAt = new Date().toISOString(),
): ResourceSnapshot => ({
  ...request,
  id: "original",
  contentHash: "hash",
  retrievedAt,
  bytes: new TextEncoder().encode("{}"),
});
beforeEach(async () => {
  await database.delete();
  await database.open();
  queryClient.clear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  queryClient.clear();
  await database.delete();
});
test("Dexie v2 upgrades without losing coordinate sources, saved sessions or analysis records", async () => {
  await database.close();
  await Dexie.delete("molecular-explorer");
  const legacy = new Dexie("molecular-explorer");
  legacy.version(2).stores({
    sources: "contentHash, id, fetchedAt",
    sessions: "id",
    analyses: "cacheKey, sourceHash, generatedAt",
    chemicalDefinitions: "componentId",
  });
  const fixture = await biologyFixture(),
    descriptor: SessionDescriptor = {
      schemaVersion: 1,
      sourceHash: fixture.source.contentHash,
      modelIndex: 0,
      assemblyId: "",
      selectedResidueId: null,
      activeChainId: null,
      representation: "cartoon",
      showWater: false,
      savedAt: "2026-10-09T00:00:00Z",
    };
  await legacy.table("sources").put(fixture.source);
  await legacy.table("sessions").put({ id: "last", descriptor });
  await legacy.table("analyses").put({
    cacheKey: "preserved",
    sourceHash: fixture.source.contentHash,
    generatedAt: descriptor.savedAt,
    interactions: [{ id: "untouched" }],
  });
  legacy.close();
  await database.open();
  expect(database.verno).toBe(4);
  expect((await getLastSession())?.descriptor).toEqual(descriptor);
  // Version 4 records each existing source's size for cache accounting.
  expect(
    (await database.sourceUsage.get(fixture.source.contentHash))?.byteLength,
  ).toBe(fixture.source.bytes.byteLength);
  expect((await database.analyses.get("preserved"))?.interactions).toEqual([
    { id: "untouched" },
  ]);
  expect(await database.interpretations.count()).toBe(0);
});
test("fresh biological snapshots are reused without requests; stale offline fallback preserves bytes and dates", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const original = resource();
  await database.biologyResources.put(original);
  expect(
    await biologyResource(request, new AbortController().signal, "fresh"),
  ).toEqual({ resource: original, mode: "cached" });
  expect(fetcher).not.toHaveBeenCalled();
  const stale = {
    ...original,
    retrievedAt: new Date(
      Date.now() - BIOLOGY_FRESHNESS_MS - 1000,
    ).toISOString(),
  };
  await database.biologyResources.put(stale);
  expect(
    await biologyResource(request, new AbortController().signal, "stale"),
  ).toEqual({ resource: stale, mode: "stale" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    biologyResource(request, new AbortController().signal, "explicit", true),
  ).rejects.toThrow("offline");
  expect(await database.biologyResources.get("original")).toEqual(stale);
});
test("manual refresh creates a new immutable resource and oversized or cancelled responses are rejected", async () => {
  const original = resource();
  await database.biologyResources.put(original);
  const fetcher = vi.fn().mockResolvedValue(
    new Response('{"new":true}', {
      headers: { "x-uniprot-release": "2026_05" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const next = await biologyResource(
    request,
    new AbortController().signal,
    "refresh",
    true,
  );
  expect(next.mode).toBe("fresh");
  expect(next.resource.id).not.toBe(original.id);
  expect(next.resource.release).toBe("2026_05");
  expect(await database.biologyResources.get("original")).toEqual(original);
  fetcher.mockResolvedValue(
    new Response("too large", {
      headers: { "content-length": String(request.limit + 1) },
    }),
  );
  await expect(
    biologyResource(request, new AbortController().signal, "large", true),
  ).rejects.toThrow("size limit");
  const abort = new AbortController();
  abort.abort();
  await expect(
    biologyResource(request, abort.signal, "aborted", true),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("malformed source data cannot be persisted as a validated interpretation", async () => {
  const f = await biologyFixture();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async (url: string) =>
          new Response(
            url.includes("xml/")
              ? await readFile("tests/fixtures/biology/3ptb-sifts.xml.gz")
              : '{"invalid":true}',
          ),
      ),
  );
  await expect(
    loadInterpretation(
      f.source,
      f.snapshot,
      "3PTB",
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(await database.interpretations.count()).toBe(0);
  expect(await database.biologyResources.count()).toBe(0);
});
/** Serves frozen provider fixtures by URL; `fail` lists URL fragments that return HTTP 404. */
function fixtureFetch(fail: string[] = []) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (fail.some((f) => url.includes(f)))
      return new Response("missing", { status: 404 });
    const file = url.includes("/mappings/uniprot/")
      ? `${url.split("/").at(-1)}-discovery.json`
      : url.includes("/sifts/xml/")
        ? `${url.split("/").at(-1)!.split(".")[0]}-sifts.xml.gz`
        : url.includes("/chemcomp/")
          ? `chemcomp-${url.split("/").at(-1)}.json`
          : url.includes("/nonpolymer_entity_instance/")
            ? `ligand-${url.split("/").slice(-2).join("-")}.json`
            : url.split("/").at(-1)!;
    return new Response(await readFile(`tests/fixtures/biology/${file}`));
  });
}
test("pins ligand chemical identities with their source records and tolerates a missing record", async () => {
  const f = await biologyFixture();
  vi.stubGlobal("fetch", fixtureFetch());
  const { interpretation } = await loadInterpretation(
    f.source,
    f.snapshot,
    "3PTB",
    new AbortController().signal,
  );
  expect(interpretation.version).toBe("biology-1.1.0");
  expect(interpretation.ligands).toEqual([
    expect.objectContaining({ componentId: "BEN", chebiIds: ["CHEBI:41033"] }),
    expect.objectContaining({ componentId: "CA", chebiIds: [] }),
  ]);
  const refs = interpretation.resourceRefs.filter((r) => r.provider === "RCSB");
  expect(refs.map((r) => r.identifier)).toEqual([
    "BEN",
    "CA",
    "3PTB.B",
    "3PTB.C",
  ]);
  expect(interpretation.ligandFits).toEqual([
    expect.objectContaining({
      labelAsymId: "B",
      componentId: "CA",
      rscc: 0.996,
    }),
    expect.objectContaining({
      labelAsymId: "C",
      componentId: "BEN",
      rscc: 0.921,
      rsr: 0.067,
      completeness: 1,
    }),
  ]);
  const structure = interpretation.evidence.find((e) =>
    e.id.startsWith("structure:"),
  )!;
  expect(structure.quality).toMatchObject({
    resolutionAngstrom: 1.7,
    method: "X-RAY DIFFRACTION",
  });
  // 3PTB deposits no R-free or reflection count, so no coordinate error is estimated.
  expect(structure.quality!.coordinateErrorAngstrom).toBeUndefined();
  for (const ligand of interpretation.ligands!)
    expect(
      interpretation.evidence.some((e) => ligand.evidenceIds.includes(e.id)),
    ).toBe(true);
  await database.delete();
  await database.open();
  queryClient.clear();
  vi.stubGlobal("fetch", fixtureFetch(["/chemcomp/BEN"]));
  const partial = await loadInterpretation(
    f.source,
    f.snapshot,
    "3PTB",
    new AbortController().signal,
  );
  expect(partial.interpretation.ligands!.map((l) => l.componentId)).toEqual([
    "CA",
  ]);
  expect(
    partial.interpretation.qualityFlags.some((q) =>
      q.startsWith("Chemical identity unavailable for BEN"),
    ),
  ).toBe(true);
  expect(partial.interpretation.proteins).toHaveLength(1);
});
test("cache eviction removes least-recently-used sources with their records, never protected ones", async () => {
  const fixture = await biologyFixture();
  // Artificial sources: the fixture bytes under distinct hashes and use times.
  const source = (hash: string) => ({
    ...fixture.source,
    contentHash: hash,
  });
  for (const hash of ["old", "saved", "open", "recent"]) {
    await cacheSource(source(hash));
    await database.sourceUsage.update(hash, {
      lastUsedAt: {
        old: "2026-01-01T00:00:00Z",
        saved: "2026-01-02T00:00:00Z",
        open: "2026-01-03T00:00:00Z",
        recent: "2026-01-04T00:00:00Z",
      }[hash],
    });
    await database.analyses.put({
      cacheKey: `run-${hash}`,
      sourceHash: hash,
    } as never);
  }
  await saveSession({
    schemaVersion: 3,
    sourceHash: "saved",
    modelIndex: 0,
    assemblyId: "",
    selectedResidueId: null,
    activeChainId: null,
    representation: "cartoon",
    showWater: false,
    savedAt: "2026-01-05T00:00:00Z",
    comparison: [],
  });
  const size = fixture.source.bytes.byteLength;
  // Budget for one source: only the unprotected ones go, oldest first.
  expect(await enforceCacheBudget(["open"], size)).toBe(2);
  expect((await database.sources.toCollection().primaryKeys()).sort()).toEqual([
    "open",
    "saved",
  ]);
  expect(await database.analyses.get("run-old")).toBeUndefined();
  expect(await database.analyses.get("run-recent")).toBeUndefined();
  expect(await database.analyses.get("run-saved")).toBeDefined();
  expect(await database.sourceUsage.count()).toBe(2);
});
