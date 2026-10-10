import { describe, expect, it } from "vitest";
import { correspondence } from "../src/comparison/correspondence";
import { superpose } from "../src/comparison/superposition";
import { siteDifferences } from "../src/comparison/siteDifferences";
import { angleDelta, dihedral } from "../src/comparison/torsions";
import type { StructureSnapshot } from "../src/domain/types";
import { comparisonSide } from "./helpers/comparison";

type Side = Awaited<ReturnType<typeof comparisonSide>>;
const ligandIn = (s: Side, component: string) =>
  s.snapshot.ligands
    .filter((l) => {
      const residue = s.snapshot.residues.find((r) => r.id === l.residueId)!;
      return (
        l.componentId === component &&
        s.snapshot.chains.find((c) => c.id === residue.chainId)?.authAsymId ===
          "A"
      );
    })
    .slice(0, 1)
    .map((l) => l.residueId);
async function site(ref: string, cmp: string, component: string) {
  const [a, b] = await Promise.all([comparisonSide(ref), comparisonSide(cmp)]);
  const corr = correspondence(a.side, b.side);
  const fit = superpose(corr, a.snapshot, b.snapshot, "global");
  return {
    a,
    b,
    corr,
    fit,
    result: siteDifferences(
      a.snapshot,
      b.snapshot,
      corr,
      fit,
      ligandIn(a, component),
      ligandIn(b, component),
    ),
  };
}
const name = (s: StructureSnapshot, id: string) => {
  const r = s.residues.find((x) => x.id === id)!;
  return `${r.componentId}${r.authSeqId}`;
};

describe("torsions", () => {
  it("measures dihedral angles and periodic differences", () => {
    expect(dihedral([1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 1])).toBeCloseTo(
      -90,
      10,
    );
    expect(dihedral([1, 0, 0], [0, 0, 0], [0, 1, 0], [-1, 1, 0])).toBeCloseTo(
      180,
      10,
    );
    expect(angleDelta(170, -170)).toBeCloseTo(20, 10);
    expect(angleDelta(10, -170, 180)).toBeCloseTo(0, 10);
    expect(angleDelta(-60, 60)).toBeCloseTo(120, 10);
  });
});

describe("binding-site differences", () => {
  it("apo 1S0Q against holo 1S0R: small shifts judged against coordinate error, apo waters in the benzamidine site", async () => {
    const { a, result } = await site("1S0R", "1S0Q", "BEN");
    // DPI_free of both 1.02 Å structures (about 0.02 Å each).
    expect(result.combinedCoordinateErrorAngstrom).toBeCloseTo(0.0305, 3);
    expect(result.residues).toHaveLength(16);
    expect(result.unpairedSiteResidues).toBe(0);
    expect(
      Math.max(...result.residues.map((r) => r.caDisplacementAngstrom!)),
    ).toBeLessThan(0.4);
    expect(result.residues.some((r) => r.rotamerChange)).toBe(false);
    expect(name(a.snapshot, result.residues[0].referenceResidueId)).toBe(
      "GLN174",
    );
    expect(
      result.residues.filter(
        (r) => r.significance === "exceeds_coordinate_error",
      ),
    ).toHaveLength(14);
    expect(
      result.referenceWaters.filter((w) => w.status === "conserved"),
    ).toHaveLength(16);
    expect(result.referenceWaters).toHaveLength(22);
    // Waters of the apo structure where benzamidine binds in the holo structure.
    expect(
      result.comparisonWaters.filter((w) => w.overlapsReferenceLigand),
    ).toHaveLength(6);
  });

  it("3PTB against 1S0R: Gln192 changes rotamer; significance needs both coordinate errors", async () => {
    const { a, result } = await site("3PTB", "1S0R", "BEN");
    expect(result.combinedCoordinateErrorAngstrom).toBeUndefined();
    expect(
      result.residues.every((r) => r.significance === "not_assessable"),
    ).toBe(true);
    const moved = result.residues.filter((r) => r.rotamerChange);
    expect(moved.map((r) => name(a.snapshot, r.referenceResidueId))).toEqual([
      "GLN192",
    ]);
    expect(moved[0].chi.find((c) => c.index === 2)!.delta).toBeGreaterThan(120);
  });

  it("deoxy 2DN2 against oxy 2DN1: the heme-pocket F helix shifts", async () => {
    const { a, result } = await site("2DN2", "2DN1", "HEM");
    const shifted = result.residues
      .filter((r) => r.caDisplacementAngstrom! > 1)
      .map((r) => name(a.snapshot, r.referenceResidueId));
    for (const residue of ["LEU83", "LEU86", "HIS87", "LEU91"])
      expect(shifted).toContain(residue);
  });

  it("does not report swapped names of equivalent atoms as movement", async () => {
    const { a, b, corr, fit } = await site("1S0R", "1S0Q", "BEN");
    // Artificial: swap Asp189 (UniProt 194) OD1/OD2 coordinates in the comparison.
    const aspId = corr.pairs.find(
      (p) => p.uniprotPosition === 194,
    )!.comparisonResidueId!;
    const asp = b.snapshot.residues.find((r) => r.id === aspId)!;
    expect(asp.componentId).toBe("ASP");
    const index = (n: string) =>
      asp.atomIndices.find((i) => b.snapshot.atoms[i].name === n)!;
    const positions = new Float32Array(b.snapshot.atomBuffer.positions);
    const [o1, o2] = [index("OD1"), index("OD2")];
    for (let k = 0; k < 3; k++)
      [positions[o1 * 3 + k], positions[o2 * 3 + k]] = [
        positions[o2 * 3 + k],
        positions[o1 * 3 + k],
      ];
    const swapped = {
      ...b.snapshot,
      atomBuffer: { ...b.snapshot.atomBuffer, positions },
    };
    const before = siteDifferences(
      a.snapshot,
      b.snapshot,
      corr,
      fit,
      ligandIn(a, "BEN"),
      [],
    ).residues.find((r) => r.comparisonResidueId === asp.id)!;
    const after = siteDifferences(
      a.snapshot,
      swapped,
      corr,
      fit,
      ligandIn(a, "BEN"),
      [],
    ).residues.find((r) => r.comparisonResidueId === asp.id)!;
    expect(after.sideChainRmsdAngstrom).toBeCloseTo(
      before.sideChainRmsdAngstrom!,
      5,
    );
    // The deposited OD1 and OD2 are not exactly 180° apart about CB–CG.
    expect(Math.abs(after.chi[1].delta - before.chi[1].delta)).toBeLessThan(5);
    expect(after.rotamerChange).toBe(false);
  });
});
