import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { database, getLastSession } from "../src/data/repository";
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
  legacy
    .version(2)
    .stores({
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
  await legacy
    .table("analyses")
    .put({
      cacheKey: "preserved",
      sourceHash: fixture.source.contentHash,
      generatedAt: descriptor.savedAt,
      interactions: [{ id: "untouched" }],
    });
  legacy.close();
  await database.open();
  expect(database.verno).toBe(3);
  expect((await getLastSession())?.descriptor).toEqual(descriptor);
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
  const fetcher = vi
    .fn()
    .mockResolvedValue(
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
