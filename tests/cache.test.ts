import { describe, expect, it } from "vitest";
import { planEviction, type SourceUsage } from "../src/data/cache";

const MB = 1024 * 1024;
const entry = (hash: string, mb: number, day: number): SourceUsage => ({
  contentHash: hash,
  byteLength: mb * MB,
  lastUsedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`,
});

describe("source cache eviction", () => {
  const entries = [
    entry("a", 100, 1),
    entry("b", 100, 3),
    entry("c", 100, 2),
    entry("d", 100, 4),
  ];

  it("keeps everything within budget", () => {
    expect(planEviction(entries, new Set(), 400 * MB)).toEqual([]);
  });

  it("evicts least recently used first until the total fits", () => {
    expect(planEviction(entries, new Set(), 250 * MB)).toEqual(["a", "c"]);
  });

  it("never evicts protected sources, even when that leaves the total over budget", () => {
    expect(planEviction(entries, new Set(["a", "c"]), 250 * MB)).toEqual([
      "b",
      "d",
    ]);
    expect(planEviction(entries, new Set(["a", "b", "c", "d"]), 0)).toEqual([]);
  });

  it("clears every unprotected source with a zero budget", () => {
    expect(planEviction(entries, new Set(["d"]), 0).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("orders ties deterministically by hash", () => {
    expect(
      planEviction([entry("y", 10, 5), entry("x", 10, 5)], new Set(), 10 * MB),
    ).toEqual(["x"]);
  });
});
