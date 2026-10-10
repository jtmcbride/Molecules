import { describe, expect, it } from "vitest";
import { correspondence } from "../src/comparison/correspondence";
import type { ResidueMapping } from "../src/domain/biology";
import { comparisonSide } from "./helpers/comparison";

describe("residue correspondence through SIFTS", () => {
  it("pairs every trypsin residue by UniProt position although author numbering differs", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const result = correspondence(ref.side, cmp.side);
    expect(result.sharedAccessions).toEqual(["P00760"]);
    expect(result.pairings).toHaveLength(1);
    expect(result.pairings[0].basis).toBe("same_author_chain");
    expect(result.counts).toEqual({
      paired: 223,
      reference_only: 0,
      comparison_only: 0,
      not_comparable: 0,
    });
    const residue = (side: typeof ref, id?: string) =>
      side.snapshot.residues.find((r) => r.id === id)!;
    // Asp189 (chymotrypsinogen numbering in 3PTB) is UniProt 194; 1S0R numbers it 171.
    const asp = result.pairs.find((p) => p.uniprotPosition === 194)!;
    expect(residue(ref, asp.referenceResidueId)).toMatchObject({
      componentId: "ASP",
      authSeqId: "189",
    });
    expect(residue(cmp, asp.comparisonResidueId).componentId).toBe("ASP");
    expect(residue(cmp, asp.comparisonResidueId).authSeqId).not.toBe("189");
    expect(
      result.pairs.every(
        (p) =>
          residue(ref, p.referenceResidueId).componentId ===
          residue(cmp, p.comparisonResidueId).componentId,
      ),
    ).toBe(true);
  });

  it("pairs hemoglobin chains explicitly and reports the chains only one structure has", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("4HHB"),
      comparisonSide("1HHO"),
    ]);
    const chain = (side: typeof ref, id: string) =>
      side.snapshot.chains.find((c) => c.id === id)!.authAsymId;
    const result = correspondence(ref.side, cmp.side);
    expect(result.sharedAccessions).toEqual(["P68871", "P69905"]);
    expect(
      result.pairings.map((p) => [
        p.accession,
        chain(ref, p.referenceChainId),
        chain(cmp, p.comparisonChainId),
        p.basis,
      ]),
    ).toEqual([
      ["P68871", "B", "B", "same_author_chain"],
      ["P69905", "A", "A", "same_author_chain"],
    ]);
    // 4HHB deposits the tetramer; 1HHO deposits one αβ dimer.
    expect(
      result.unpairedReferenceChains.map((c) => [
        chain(ref, c.chainId),
        c.accessions,
      ]),
    ).toEqual([
      ["C", ["P69905"]],
      ["D", ["P68871"]],
    ]);
    expect(result.counts.paired).toBe(287);
  });

  it("applies user pairings first and never pairs a comparison chain twice", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("4HHB"),
      comparisonSide("1HHO"),
    ]);
    const id = (side: typeof ref, auth: string) =>
      side.snapshot.chains.find((c) => c.authAsymId === auth)!.id;
    const result = correspondence(ref.side, cmp.side, [
      {
        accession: "P69905",
        referenceChainId: id(ref, "C"),
        comparisonChainId: id(cmp, "A"),
      },
      {
        accession: "P68871",
        referenceChainId: id(ref, "B"),
        comparisonChainId: null,
      },
    ]);
    expect(result.pairings.map((p) => [p.referenceChainId, p.basis])).toEqual([
      [id(ref, "D"), "chain_order"],
      [id(ref, "C"), "user"],
    ]);
    expect(result.unpairedReferenceChains.map((c) => c.chainId).sort()).toEqual(
      [id(ref, "A"), id(ref, "B")].sort(),
    );
  });

  it("labels unobserved, ambiguous and mutated positions instead of pairing them silently", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    // Artificial in-memory modifications of the 1S0R mapping.
    const edits: Record<number, (m: ResidueMapping) => ResidueMapping | null> =
      {
        60: (m) => ({ ...m, residueId: undefined }), // unobserved
        70: (m) => ({ ...m, status: "ambiguous" }),
        80: () => null, // no SIFTS row
        200: (m) => ({
          ...m,
          identity: "engineered_mutation",
          residueChange: { uniprot: "S", deposited: "A" },
        }),
      };
    const mappings = cmp.side.interpretation.mappings.flatMap((m) => {
      const edit = edits[m.uniprotPosition];
      const changed = edit ? edit(m) : m;
      return changed ? [changed] : [];
    });
    const result = correspondence(ref.side, {
      ...cmp.side,
      interpretation: { ...cmp.side.interpretation, mappings },
    });
    const at = (position: number) =>
      result.pairs.find((p) => p.uniprotPosition === position)!;
    expect(at(60).status).toBe("reference_only");
    expect(at(60).comparisonResidueId).toBeUndefined();
    expect(at(70)).toMatchObject({
      status: "not_comparable",
      reason: "comparison: ambiguous",
    });
    expect(at(80).status).toBe("reference_only");
    expect(at(200)).toMatchObject({
      status: "paired",
      residueChange: { reference: "S", comparison: "A" },
    });
    expect(result.counts).toEqual({
      paired: 220,
      reference_only: 2,
      comparison_only: 0,
      not_comparable: 1,
    });
  });

  it("offers nothing when the structures share no UniProt accession", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("4HHB"),
    ]);
    const result = correspondence(ref.side, cmp.side);
    expect(result.sharedAccessions).toEqual([]);
    expect(result.pairs).toEqual([]);
    expect(result.unpairedComparisonChains).toHaveLength(4);
  });
});
