/** Coordinate bytes kept in browser storage before least-recently-used sources are evicted. */
export const SOURCE_CACHE_BUDGET_BYTES = 300 * 1024 * 1024;

export interface SourceUsage {
  contentHash: string;
  byteLength: number;
  /** ISO timestamp of the last load or save that used this source. */
  lastUsedAt: string;
}

/**
 * Sources to evict so that the cached total fits `budget`, least recently used first.
 * Protected sources (open structures, the saved session) are never evicted, so the result
 * can leave the total above budget when protected sources alone exceed it.
 */
export function planEviction(
  entries: SourceUsage[],
  protectedHashes: ReadonlySet<string>,
  budget: number,
): string[] {
  let total = entries.reduce((t, e) => t + e.byteLength, 0);
  const evict: string[] = [];
  const candidates = entries
    .filter((e) => !protectedHashes.has(e.contentHash))
    .sort(
      (a, b) =>
        a.lastUsedAt.localeCompare(b.lastUsedAt) ||
        a.contentHash.localeCompare(b.contentHash),
    );
  for (const entry of candidates) {
    if (total <= budget) break;
    evict.push(entry.contentHash);
    total -= entry.byteLength;
  }
  return evict;
}
