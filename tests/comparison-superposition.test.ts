import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { correspondence } from "../src/comparison/correspondence";
import {
  applyTransform,
  fitRigid,
  superpose,
  superposePairs,
  type PointPair,
} from "../src/comparison/superposition";
import { comparisonSide } from "./helpers/comparison";

type Vec = [number, number, number];
/** Deterministic pseudo-random numbers (artificial test geometry). */
function random(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}
function rotation(axis: Vec, angle: number, t: Vec) {
  const n = Math.hypot(...axis),
    [x, y, z] = axis.map((v) => v / n),
    c = Math.cos(angle),
    s = Math.sin(angle),
    C = 1 - c;
  const R = [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
  return (p: Vec): Vec =>
    [0, 1, 2].map(
      (r) => R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2] + t[r],
    ) as Vec;
}
const points = (n: number, seed: number) => {
  const r = random(seed);
  return Array.from(
    { length: n },
    () => [r() * 40 - 20, r() * 40 - 20, r() * 40 - 20] as Vec,
  );
};

describe("least-squares superposition", () => {
  it("recovers a known rotation and translation", () => {
    const target = points(60, 7);
    const inverse = rotation([0.3, -1, 0.5], -1.1, [0, 0, 0]);
    const moving = target.map((p) =>
      inverse([p[0] - 12.5, p[1] + 3, p[2] - 40]),
    );
    const m = fitRigid(target, moving);
    for (let i = 0; i < target.length; i++)
      applyTransform(m, moving[i]).forEach((v, k) =>
        expect(Math.abs(v - target[i][k])).toBeLessThan(1e-4),
      );
  });

  it("returns a proper rotation for mirror-image input", () => {
    const target = points(20, 3);
    const mirrored = target.map(([x, y, z]) => [-x, y, z] as Vec);
    const m = fitRigid(target, mirrored);
    const det =
      m[0] * (m[5] * m[10] - m[9] * m[6]) -
      m[4] * (m[1] * m[10] - m[9] * m[2]) +
      m[8] * (m[1] * m[6] - m[5] * m[2]);
    expect(det).toBeCloseTo(1, 10);
  });

  it("rejects displaced pairs and fits the rest exactly", () => {
    const move = rotation([1, 1, 0], 0.7, [5, -2, 9]);
    const target = points(100, 11);
    const pairs: PointPair[] = target.map((p, i) => ({
      id: String(i),
      target: p,
      moving:
        i % 10 === 0
          ? ([p[0] + 6, p[1], p[2]] as Vec) // artificial outliers
          : p,
    }));
    const moved = pairs.map((p) => ({ ...p, moving: move(p.moving) }));
    const result = superposePairs(moved);
    expect(result.rejected).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i * 10)),
    );
    expect(result.rmsdCore).toBeLessThan(1e-6);
    expect(result.fitted).toBe(90);
    expect(result.rmsdAll).toBeGreaterThan(1);
  });

  it("refuses fits with too few atoms", () => {
    const target = points(9, 5);
    expect(() =>
      superposePairs(
        target.map((p, i) => ({ id: String(i), target: p, moving: p })),
      ),
    ).toThrow(/at least 10 paired/);
  });
});

/*
 * Fixture pairs, checked against an independent numpy SVD fit with the same rejection
 * policy (scripts/comparison-reference.py). RECORD_COMPARISON_PAIRS=1 rewrites the paired
 * coordinates that script reads.
 */
const CASES = [
  { name: "3PTB-1S0R-global", ref: "3PTB", cmp: "1S0R" },
  { name: "3PTB-1S0R-site", ref: "3PTB", cmp: "1S0R", ligand: "BEN" },
  { name: "1S0Q-1S0R-global", ref: "1S0Q", cmp: "1S0R" },
  { name: "4HHB-1HHO-dimer-global", ref: "4HHB", cmp: "1HHO" },
  {
    name: "4HHB-1HHO-tetramer-global",
    ref: "4HHB",
    cmp: "1HHO",
    assembly: "1",
  },
  { name: "4HHB-1HHO-site", ref: "4HHB", cmp: "1HHO", ligand: "HEM" },
] as const;

describe("fixture superpositions", async () => {
  const reference = JSON.parse(
    await readFile("validation/comparison.json", "utf8"),
  ).superposition as Record<
    string,
    {
      rmsdCore: number;
      rmsdAll: number;
      fitted: number;
      total: number;
      cycles: number;
      rejected: string[];
      transform: number[];
    }
  >;
  for (const c of CASES)
    it(`${c.name} matches numpy`, async () => {
      const assembly = "assembly" in c ? c.assembly : "";
      const [ref, cmp] = await Promise.all([
        comparisonSide(c.ref, assembly),
        comparisonSide(c.cmp, assembly),
      ]);
      const corr = correspondence(ref.side, cmp.side);
      const ligand =
        "ligand" in c
          ? [
              ref.snapshot.ligands.find((l) => l.componentId === c.ligand)!
                .residueId,
            ]
          : [];
      const result = superpose(
        corr,
        ref.snapshot,
        cmp.snapshot,
        ligand.length ? "binding_site" : "global",
        ligand,
      );
      if (process.env.RECORD_COMPARISON_PAIRS) {
        const { alphaPairs, siteResidues } =
          await import("../src/comparison/superposition");
        await mkdir("validation/comparison", { recursive: true });
        await writeFile(
          `validation/comparison/${c.name}.pairs.json`,
          JSON.stringify(
            alphaPairs(
              corr,
              ref.snapshot,
              cmp.snapshot,
              ligand.length ? siteResidues(ref.snapshot, ligand) : undefined,
            ),
          ),
        );
        return;
      }
      const expected = reference[c.name];
      expect(result.fitted).toBe(expected.fitted);
      expect(result.total).toBe(expected.total);
      expect(result.cycles).toBe(expected.cycles);
      expect(result.rejected).toEqual(expected.rejected);
      expect(Math.abs(result.rmsdCore - expected.rmsdCore)).toBeLessThan(1e-3);
      expect(Math.abs(result.rmsdAll - expected.rmsdAll)).toBeLessThan(1e-3);
      result.transform.forEach((v, i) =>
        expect(Math.abs(v - expected.transform[i])).toBeLessThan(1e-4),
      );
    });

  it("a quaternary change shows as a much larger tetramer RMSD than dimer RMSD", () => {
    expect(reference["4HHB-1HHO-tetramer-global"].rmsdCore).toBeGreaterThan(
      3 * reference["4HHB-1HHO-dimer-global"].rmsdCore,
    );
    expect(reference["3PTB-1S0R-global"].rmsdCore).toBeLessThan(0.3);
  });
});
