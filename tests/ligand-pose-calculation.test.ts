import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { calculateLigandPose } from "../src/comparison/ligandPose";
import { enumeratePoseMappings } from "../src/comparison/poseMappings";
import {
  preparePoseInput,
  preparePoseLigand,
} from "../src/comparison/ligandPoseInput";
import {
  type PoseChemicalGraph,
  type LigandPoseInput,
} from "../src/domain/ligandPose";
import { benChemistry, poseFixture, sha } from "./helpers/ligandPose";
import { comparisonSide } from "./helpers/comparison";
import { correspondence } from "../src/comparison/correspondence";
import { superpose } from "../src/comparison/superposition";
import reference from "./fixtures/ligand-pose/reference.json";

import { ligand, input } from "./helpers/poseCalculation";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function evaluated(i: LigandPoseInput) {
  const r = calculateLigandPose(i);
  if (r.status !== "evaluated") throw Error(JSON.stringify(r));
  return r;
}
function permutations(xs: number[]): number[][] {
  return xs.length
    ? xs.flatMap((x, i) =>
        permutations(xs.filter((_, j) => i !== j)).map((p) => [x, ...p]),
      )
    : [[]];
}
// Independently exhaust ALL heavy permutations for a small non-stereo graph, without the
// application's partition/refinement/backtracking implementation or its returned maps.
function brute(graph: PoseChemicalGraph, names: string[]) {
  const atoms = names.map((n) => graph.atoms.find((a) => a.name === n)!);
  const edges = new Map(
    graph.bonds
      .filter((b) => names.includes(b.a) && names.includes(b.b))
      .map((b) => [
        [b.a, b.b].sort().join("/"),
        JSON.stringify([b.order, b.aromatic, b.stereo]),
      ]),
  );
  return permutations(names.map((_, i) => i)).filter(
    (m) =>
      m.every(
        (j, i) =>
          atoms[i].element === atoms[j].element &&
          atoms[i].charge === atoms[j].charge &&
          atoms[i].aromatic === atoms[j].aromatic,
      ) &&
      names.every((a, i) =>
        names.every(
          (b, j) =>
            edges.get([a, b].sort().join("/")) ===
            edges.get([names[m[i]], names[m[j]]].sort().join("/")),
        ),
      ),
  );
}

describe("independent graph maps and fixed-frame RMSD", () => {
  it("pins every independent source hash and tool version", async () => {
    for (const s of reference.sources)
      expect(sha(await readFile(s.path))).toBe(s.sha256);
    const manifest = JSON.parse(
      await readFile(
        "tests/fixtures/ligand-pose/reference-manifest.json",
        "utf8",
      ),
    );
    for (const s of manifest.files)
      expect(sha(await readFile(s.path))).toBe(s.sha256);
    expect(reference.tools.rdkit).toBe("2026.03.6");
    expect(reference.options.useChirality).toBe(true);
    expect(reference.options.symmetrizeConjugatedTerminalGroups).toBe(false);
  });
  for (const c of reference.cases)
    it(`${c.name}: matches independent RDKit maps and CalcRMS`, () => {
      const i = input(c),
        before = structuredClone(i),
        maps = enumeratePoseMappings(i.reference.graph, i.comparison.graph);
      expect(maps.status).toBe("mapped");
      if (maps.status !== "mapped") throw Error(maps.reason);
      expect(maps.maps).toEqual(c.maps);
      const r = evaluated(i);
      expect(r.admissibleMaps).toBe(c.maps.length);
      expect(Math.abs(r.rmsdAngstrom - c.rmsdAngstrom)).toBeLessThan(1e-10);
      expect(
        Math.abs(r.nameMatchedRmsdAngstrom! - c.nameMatchedRmsdAngstrom),
      ).toBeLessThan(1e-10);
      const selected = c.atomNames.map((n) =>
        c.atomNames.indexOf(
          r.pairs.find((p) => p.referenceAtomName === n)!.comparisonAtomName,
        ),
      );
      expect(c.minimumMaps).toContainEqual(selected);
      expect(r.pairs).toHaveLength(c.atomNames.length);
      expect(
        Math.sqrt(
          r.pairs.reduce((s, p) => s + p.distanceAngstrom ** 2, 0) /
            r.matchedAtoms,
        ),
      ).toBeCloseTo(r.rmsdAngstrom, 12);
      expect(i).toEqual(before);
      expect(r.reference.chemistryHash).toBe(i.reference.chemistryHash);
      expect(r.fit).toEqual(i.fit);
    });
  it("agrees with independent exhaustive permutations for a ring", () => {
    const c = reference.cases.find((c) => c.name === "ring")!,
      i = input(c);
    const exhaustive = brute(i.reference.graph, c.atomNames);
    expect(exhaustive).toEqual(c.maps);
    const scores = exhaustive.map((m) =>
      Math.sqrt(
        m.reduce(
          (s, j, k) =>
            s +
            c.reference[k].reduce(
              (ss, x, d) => ss + (x - c.comparison[j][d]) ** 2,
              0,
            ),
          0,
        ) / m.length,
      ),
    );
    expect(evaluated(i).rmsdAngstrom).toBe(Math.min(...scores));
  });
  it("retains a known residual displacement; applies rotation and translation exactly once", () => {
    const i = input();
    i.comparison.positions = i.reference.positions.slice();
    i.fit.transform = [...identity];
    expect(evaluated(i).rmsdAngstrom).toBe(0);
    i.fit.transform[12] = 3;
    i.fit.transform[13] = 4;
    const r = evaluated(i);
    expect(r.nameMatchedRmsdAngstrom).toBe(5);
    // A unique-element tetrahedron removes symmetry as a competing displacement explanation.
    const u = input(reference.cases.find((c) => c.name === "tetrahedral")!);
    u.comparison.positions = u.reference.positions.slice();
    u.fit.transform = [...i.fit.transform];
    expect(evaluated(u).rmsdAngstrom).toBe(5);
    // T is a +90 degree rotation about z then (3,4,5); inverse coordinates should recover zero.
    u.fit.transform = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1];
    for (let k = 0; k < u.reference.positions.length; k += 3) {
      const [x, y, z] = Array.from(u.reference.positions.slice(k, k + 3));
      u.comparison.positions.set([y - 4, 3 - x, z - 5], k);
    }
    expect(evaluated(u).rmsdAngstrom).toBe(0);
  });
  it("corrects a permitted symmetry permutation, but never swaps BEN terminal nitrogen labels", () => {
    const ring = evaluated(input());
    expect(ring.rmsdAngstrom).toBe(0);
    expect(ring.nameMatchedRmsdAngstrom).toBeGreaterThan(0);
    const c = reference.cases.find((c) => c.name === "3PTB-1S0R-global")!,
      i = input(c);
    const maps = enumeratePoseMappings(i.reference.graph, i.comparison.graph);
    if (maps.status !== "mapped") throw Error(maps.reason);
    for (const m of maps.maps)
      for (const n of ["N1", "N2"])
        expect(c.atomNames[m[c.atomNames.indexOf(n)]]).toBe(n);
  });
  it("breaks equal-score ties by stable atom IDs, independently of array order", () => {
    const i = input();
    i.reference.positions.fill(0);
    i.comparison.positions.fill(0);
    i.comparison.atomIds.reverse();
    const r = evaluated(i);
    const ordered = r.pairs.map((p) => p.comparisonAtomId);
    const c = reference.cases[0];
    const choices = c.maps
      .map((m) => m.map((j) => i.comparison.atomIds[j]))
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    expect(ordered).toEqual(choices[0]);
    for (const p of [i.reference, i.comparison]) {
      p.atomIds.reverse();
      p.atomNames.reverse();
      p.sourceRows.reverse();
      p.graph.atoms.reverse();
      p.graph.bonds.reverse();
    }
    expect(evaluated(i).pairs).toEqual(r.pairs);
  });
  it("prepares the actual frozen BEN snapshots and reproduces independently parsed coordinates", async () => {
    const chem = await benChemistry(),
      a = await poseFixture(),
      b = await poseFixture("tests/fixtures/biology/1S0R.cif.gz");
    const ra = preparePoseLigand(
        a.snapshot,
        [a.residue.id],
        chem,
        a.attachment,
      ),
      rb = preparePoseLigand(b.snapshot, [b.residue.id], chem, b.attachment);
    if (ra.status !== "prepared" || rb.status !== "prepared")
      throw Error("unexpected preparation refusal");
    const c = reference.cases.find((c) => c.name === "3PTB-1S0R-global")!;
    expect(Array.from(ra.ligand.positions)).toEqual(c.reference.flat());
    expect(Array.from(rb.ligand.positions)).toEqual(c.comparison.flat());
    const prepared = await preparePoseInput(
      ra.ligand,
      rb.ligand,
      input(c).fit,
      "frozen-numpy-global",
    );
    if (prepared.status !== "prepared") throw Error(prepared.reason);
    expect(
      Math.abs(evaluated(prepared.input).rmsdAngstrom - c.rmsdAngstrom),
    ).toBeLessThan(1e-10);
  });
  it("composes with the application's actual global and site protein fits within 1e-4 angstrom", async () => {
    const [a, b, chem] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
      benChemistry(),
    ]);
    const corr = correspondence(a.side, b.side),
      pa = await poseFixture(),
      pb = await poseFixture("tests/fixtures/biology/1S0R.cif.gz");
    const ra = preparePoseLigand(
        a.snapshot,
        [pa.residue.id],
        chem,
        pa.attachment,
      ),
      rb = preparePoseLigand(b.snapshot, [pb.residue.id], chem, pb.attachment);
    if (ra.status !== "prepared" || rb.status !== "prepared")
      throw Error("unexpected ligand refusal");
    for (const scope of ["global", "binding_site"] as const) {
      const fit = superpose(corr, a.snapshot, b.snapshot, scope, [
        pa.residue.id,
      ]);
      const prepared = await preparePoseInput(
        ra.ligand,
        rb.ligand,
        fit,
        sha(JSON.stringify({ corr, scope })),
      );
      if (prepared.status !== "prepared") throw Error(prepared.reason);
      const c = reference.cases.find(
        (c) => c.name === `3PTB-1S0R-${scope === "global" ? "global" : "site"}`,
      )!;
      expect(
        Math.abs(evaluated(prepared.input).rmsdAngstrom - c.rmsdAngstrom),
      ).toBeLessThan(1e-4);
    }
  });
});

describe("refusal and bounded exactness", () => {
  it("checks E/Z substituent parity at both ends of a fixed double bond", () => {
    // Artificial graph isolates the local E/Z constraint, independent of valence perception.
    const g: PoseChemicalGraph = {
      componentId: "EZPARITY",
      containsMetal: false,
      atoms: ["C", "Si", "F", "F", "Cl", "Cl"].map((element, i) => ({
        name: `A${i}`,
        element,
        charge: 0,
        aromatic: false,
        stereo: "N",
      })),
      bonds: [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 4],
        [1, 5],
      ].map(([i, j], n) => ({
        a: `A${i}`,
        b: `A${j}`,
        order: n ? "SING" : "DOUB",
        sourceOrder: n ? "SING" : "DOUB",
        aromatic: false,
        stereo: n ? "N" : "E",
      })),
    };
    const r = enumeratePoseMappings(g, g);
    if (r.status !== "mapped") throw Error(r.reason);
    expect(r.maps).toEqual([
      [0, 1, 2, 3, 4, 5],
      [0, 1, 3, 2, 5, 4],
    ]);
  });
  it("refuses an unresolved moving stereo site instead of silently discarding its maps", () => {
    // Artificial equivalent-arm tetrahedral sites force unresolved neighbor-color ties.
    const g: PoseChemicalGraph = {
      componentId: "MOVING",
      containsMetal: false,
      atoms: Array.from({ length: 8 }, (_, i) => ({
        name: `A${i}`,
        element: i < 2 ? "C" : "F",
        charge: 0,
        aromatic: false,
        stereo: i < 2 ? "R" : "N",
      })),
      bonds: [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
        [1, 5],
        [1, 6],
        [1, 7],
      ].map(([i, j]) => ({
        a: `A${i}`,
        b: `A${j}`,
        order: "SING",
        sourceOrder: "SING",
        aromatic: false,
        stereo: "N",
      })),
    };
    expect(enumeratePoseMappings(g, g)).toMatchObject({
      status: "not_evaluated",
      code: "unsupported_stereo",
    });
  });
  it("refuses malformed arrays, nonfinite values, stale versions and improper transforms", () => {
    for (const patch of [
      (i: LigandPoseInput) => {
        i.algorithmVersion = "old";
      },
      (i: LigandPoseInput) => {
        i.reference.atomIds.pop();
      },
      (i: LigandPoseInput) => {
        i.reference.positions = new Float64Array(1);
      },
      (i: LigandPoseInput) => {
        i.reference.positions[0] = NaN;
      },
      (i: LigandPoseInput) => {
        i.fit.transform[0] = -1;
      },
      (i: LigandPoseInput) => {
        i.fit.transform[0] = 2;
      },
      (i: LigandPoseInput) => {
        i.fit.transform[4] = 1;
      },
      (i: LigandPoseInput) => {
        i.comparison.graphHash = "other";
      },
      (i: LigandPoseInput) => {
        i.comparison.graph.atoms[0].charge = 1;
      },
      (i: LigandPoseInput) => {
        i.comparison.graph.bonds[0].stereo = "E";
      },
    ]) {
      const i = input();
      patch(i);
      expect(calculateLigandPose(i).status).toBe("not_evaluated");
    }
  });
  it("returns no partial maps when either deterministic budget is exhausted", () => {
    const i = input(),
      g = i.reference.graph;
    const maps = enumeratePoseMappings(g, g);
    if (maps.status !== "mapped") throw Error(maps.reason);
    expect(
      enumeratePoseMappings(g, g, { maxStates: 1, maxMaps: 4096 }),
    ).toMatchObject({ code: "search_limit" });
    expect(
      enumeratePoseMappings(g, g, {
        maxStates: 100000,
        maxMaps: maps.maps.length - 1,
      }),
    ).toMatchObject({ code: "map_limit" });
    expect(
      enumeratePoseMappings(g, g, {
        maxStates: maps.searchStates,
        maxMaps: maps.maps.length,
      }),
    ).toEqual(maps);
  });
  it("returns no score for a production map-limit exhaustion", () => {
    // Artificial graph stress case; not a chemically valid eight-coordinate carbon.
    const c = reference.cases[0],
      i = input(c),
      g: PoseChemicalGraph = {
        componentId: "STAR",
        containsMetal: false,
        atoms: Array.from({ length: 9 }, (_, n) => ({
          name: `A${n}`,
          element: n ? "F" : "C",
          charge: 0,
          aromatic: false,
          stereo: "N",
        })),
        bonds: Array.from({ length: 8 }, (_, n) => ({
          a: "A0",
          b: `A${n + 1}`,
          order: "SING",
          sourceOrder: "SING",
          aromatic: false,
          stereo: "N",
        })),
      };
    const names = g.atoms.map((a) => a.name),
      coords = names.map((_, i) => [i, 0, 0]);
    i.reference = ligand(g, names, coords, "reference");
    i.comparison = ligand(g, names, coords, "comparison");
    const result = calculateLigandPose(i);
    expect(result).toMatchObject({
      status: "not_evaluated",
      code: "map_limit",
    });
    expect(result).not.toHaveProperty("rmsdAngstrom");
  });
  it("checks tetrahedral neighbor permutation parity, not just equal R labels", () => {
    // Artificial oriented graph with equivalent arms isolates the parity constraint.
    // This is NOT claimed to be a chemically valid R-labelled CF4 molecule.
    const g: PoseChemicalGraph = {
      componentId: "PARITY",
      containsMetal: false,
      atoms: Array.from({ length: 5 }, (_, n) => ({
        name: `A${n}`,
        element: n ? "F" : "C",
        charge: 0,
        aromatic: false,
        stereo: n ? "N" : "R",
      })),
      bonds: Array.from({ length: 4 }, (_, n) => ({
        a: "A0",
        b: `A${n + 1}`,
        order: "SING",
        sourceOrder: "SING",
        aromatic: false,
        stereo: "N",
      })),
    };
    const r = enumeratePoseMappings(g, g);
    if (r.status !== "mapped") throw Error(r.reason);
    const even = permutations([1, 2, 3, 4])
      .filter(
        (p) =>
          p.reduce(
            (n, x, i) => n + p.slice(i + 1).filter((y) => x > y).length,
            0,
          ) %
            2 ===
          0,
      )
      .map((p) => [0, ...p]);
    expect(r.maps).toEqual(even);
    expect(r.maps).toHaveLength(12);
    const coords = [
        [0, 0, 0],
        [1, 1, 1],
        [-1, -1, 1],
        [-1, 1, -1],
        [1, -1, -1],
      ],
      i = input();
    i.reference = ligand(
      g,
      g.atoms.map((a) => a.name),
      coords,
      "reference",
    );
    const reflected = coords.map((p) => [-p[0], p[1], p[2]]);
    i.comparison = ligand(
      g,
      g.atoms.map((a) => a.name),
      reflected,
      "comparison",
    );
    expect(evaluated(i).rmsdAngstrom).toBeGreaterThan(0);
  });
});
