import Dexie, { type EntityTable } from "dexie";
import type {
  InterpretationSnapshot,
  ProteinRecord,
  ResourceSnapshot,
} from "../domain/biology";
import type { AnalysisRun, ChemicalDefinition } from "../domain/analysis";
import type { SessionDescriptor, StructureSource } from "../domain/types";
import {
  planEviction,
  SOURCE_CACHE_BUDGET_BYTES,
  type SourceUsage,
} from "./cache";

class ExplorerDatabase extends Dexie {
  sources!: EntityTable<StructureSource, "contentHash">;
  sourceUsage!: EntityTable<SourceUsage, "contentHash">;
  sessions!: EntityTable<{ id: string; descriptor: SessionDescriptor }, "id">;
  analyses!: EntityTable<AnalysisRun, "cacheKey">;
  chemicalDefinitions!: EntityTable<ChemicalDefinition, "componentId">;
  biologyResources!: EntityTable<ResourceSnapshot, "id">;
  proteins!: EntityTable<ProteinRecord, "id">;
  interpretations!: EntityTable<InterpretationSnapshot, "id">;
  constructor() {
    super("molecular-explorer");
    this.version(1).stores({
      sources: "contentHash, id, fetchedAt",
      sessions: "id",
    });
    this.version(2).stores({
      sources: "contentHash, id, fetchedAt",
      sessions: "id",
      analyses: "cacheKey, sourceHash, generatedAt",
      chemicalDefinitions: "componentId",
    });
    this.version(3).stores({
      sources: "contentHash, id, fetchedAt",
      sessions: "id",
      analyses: "cacheKey, sourceHash, generatedAt",
      chemicalDefinitions: "componentId",
      biologyResources: "id, key, contentHash, retrievedAt",
      proteins: "id, accession, sequenceHash",
      interpretations: "id, snapshotId, sourceHash, createdAt",
    });
    // Source sizes and last use, kept apart from the bytes so eviction never loads them.
    this.version(4)
      .stores({
        sources: "contentHash, id, fetchedAt",
        sourceUsage: "contentHash, lastUsedAt",
        sessions: "id",
        analyses: "cacheKey, sourceHash, generatedAt",
        chemicalDefinitions: "componentId",
        biologyResources: "id, key, contentHash, retrievedAt",
        proteins: "id, accession, sequenceHash",
        interpretations: "id, snapshotId, sourceHash, createdAt",
      })
      .upgrade((tx) =>
        tx.table<StructureSource>("sources").each((source) =>
          tx.table<SourceUsage>("sourceUsage").put({
            contentHash: source.contentHash,
            byteLength: source.bytes.byteLength,
            lastUsedAt: source.fetchedAt,
          }),
        ),
      );
  }
}
export const database = new ExplorerDatabase();

async function touchSource(source: StructureSource) {
  await database.sourceUsage.put({
    contentHash: source.contentHash,
    byteLength: source.bytes.byteLength,
    lastUsedAt: new Date().toISOString(),
  });
}
/**
 * Caches a source and evicts least-recently-used sources beyond the budget. `open` lists
 * the content hashes of structures currently in use; they and the saved session's sources
 * are never evicted.
 */
export async function cacheSource(
  source: StructureSource,
  open: Iterable<string> = [],
) {
  await database.transaction(
    "rw",
    database.sources,
    database.sourceUsage,
    async () => {
      await database.sources.put(source);
      await touchSource(source);
    },
  );
  await enforceCacheBudget([source.contentHash, ...open]).catch(() => {});
}
export async function getCachedSource(id: string) {
  const source = await database.sources.where("id").equals(id).last();
  if (source) await touchSource(source).catch(() => {});
  return source;
}
export async function getSourceByHash(contentHash: string) {
  const source = await database.sources.get(contentHash);
  if (source) await touchSource(source).catch(() => {});
  return source;
}
/** Source hashes a saved session needs to restore. */
export function sessionSourceHashes(descriptor: SessionDescriptor) {
  return [
    descriptor.sourceHash,
    ...(descriptor.comparison ?? []).map((m) => m.sourceHash),
  ];
}
async function protectedHashes(open: Iterable<string>) {
  const session = await database.sessions.get("last");
  return new Set([
    ...open,
    ...(session ? sessionSourceHashes(session.descriptor) : []),
  ]);
}
/** Deletes sources with their analyses and interpretations. */
async function evict(hashes: string[]) {
  if (!hashes.length) return;
  await database.transaction(
    "rw",
    [
      database.sources,
      database.sourceUsage,
      database.analyses,
      database.interpretations,
    ],
    async () => {
      await database.sources.bulkDelete(hashes);
      await database.sourceUsage.bulkDelete(hashes);
      await database.analyses.where("sourceHash").anyOf(hashes).delete();
      await database.interpretations.where("sourceHash").anyOf(hashes).delete();
    },
  );
}
export async function enforceCacheBudget(
  open: Iterable<string>,
  budget = SOURCE_CACHE_BUDGET_BYTES,
) {
  const hashes = planEviction(
    await database.sourceUsage.toArray(),
    await protectedHashes(open),
    budget,
  );
  await evict(hashes);
  return hashes.length;
}
export async function cacheUsage() {
  const entries = await database.sourceUsage.toArray();
  return {
    count: entries.length,
    bytes: entries.reduce((t, e) => t + e.byteLength, 0),
    budget: SOURCE_CACHE_BUDGET_BYTES,
  };
}
/** Removes every cached source that no open structure or saved session needs. */
export function clearUnusedCache(open: Iterable<string>) {
  return enforceCacheBudget(open, 0);
}
/** Stores a completed run with the CCD definitions it actually used. */
export async function saveAnalysis(
  run: AnalysisRun,
  definitions: ChemicalDefinition[],
) {
  await database.transaction(
    "rw",
    database.analyses,
    database.chemicalDefinitions,
    async () => {
      await database.analyses.put(run);
      await database.chemicalDefinitions.bulkPut(
        definitions.filter((d) =>
          run.chemistrySources.some(
            (c) =>
              c.source === "ccd" &&
              c.componentId === d.componentId &&
              c.contentHash === d.contentHash,
          ),
        ),
      );
    },
  );
}
export async function saveSession(descriptor: SessionDescriptor) {
  await database.sessions.put({ id: "last", descriptor });
}
export async function getLastSession() {
  const session = await database.sessions.get("last");
  if (!session || ![1, 2, 3].includes(session.descriptor.schemaVersion))
    return null;
  const source = await getSourceByHash(session.descriptor.sourceHash);
  return source ? { source, descriptor: session.descriptor } : null;
}
