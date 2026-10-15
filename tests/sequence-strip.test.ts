import { describe, expect, it } from "vitest";
import { correspondence } from "../src/comparison/correspondence";
import { pairedSequenceStrip } from "../src/comparison/sequenceStrip";
import type { ResidueMapping } from "../src/domain/biology";
import type { InvestigationCorrespondence } from "../src/domain/selection";
import { comparisonSide } from "./helpers/comparison";

describe("paired sequence strip", async () => {
  const [ref, cmp] = await Promise.all([
    comparisonSide("3PTB"),
    comparisonSide("1S0R"),
  ]);
  const chainA = (side: typeof ref) =>
    side.snapshot.chains.find((c) => c.authAsymId === "A")!.id;
  const at = (position: number): InvestigationCorrespondence => ({
    basis: "sifts_exact",
    accession: "P00760",
    uniprotPosition: position,
    referenceChainId: chainA(ref),
    comparisonChainId: chainA(cmp),
    status: "paired",
  });

  it("shows the deposited residues of both chains around the selected UniProt position", () => {
    const corr = correspondence(ref.side, cmp.side);
    const strip = pairedSequenceStrip(
      corr,
      at(194),
      ref.snapshot,
      cmp.snapshot,
    );
    expect(strip.columns.map((c) => c.uniprotPosition)).toEqual(
      Array.from({ length: 15 }, (_, i) => 187 + i),
    );
    const selected = strip.columns.filter((c) => c.selected);
    // Asp189 (3PTB author numbering) is UniProt 194 in both structures.
    expect(selected).toEqual([
      {
        uniprotPosition: 194,
        status: "paired",
        reference: "D",
        comparison: "D",
        selected: true,
        differs: false,
      },
    ]);
    expect(strip.columns.every((c) => c.status === "paired")).toBe(true);
    expect(strip.columns.map((c) => c.reference).join("")).toBe(
      strip.columns.map((c) => c.comparison).join(""),
    );
  });

  it("marks unobserved, ambiguous, mutated and unmapped positions instead of filling them", () => {
    // Artificial in-memory modifications of the 1S0R mapping.
    const edits: Record<number, (m: ResidueMapping) => ResidueMapping> = {
      27: (m) => ({ ...m, residueId: undefined }),
      28: (m) => ({ ...m, status: "ambiguous" }),
      29: (m) => ({
        ...m,
        identity: "engineered_mutation",
        residueChange: { uniprot: "V", deposited: "A" },
      }),
    };
    const mappings = cmp.side.interpretation.mappings.map(
      (m) => edits[m.uniprotPosition]?.(m) ?? m,
    );
    const corr = correspondence(ref.side, {
      ...cmp.side,
      interpretation: { ...cmp.side.interpretation, mappings },
    });
    const strip = pairedSequenceStrip(corr, at(25), ref.snapshot, cmp.snapshot);
    const col = (position: number) =>
      strip.columns.find((c) => c.uniprotPosition === position)!;
    // The mature chain starts at UniProt 24; the propeptide is mapped by neither entry.
    expect(col(23)).toMatchObject({
      status: "unmapped",
      reference: null,
      comparison: null,
    });
    expect(col(24).status).toBe("paired");
    expect(col(27)).toMatchObject({
      status: "reference_only",
      comparison: null,
    });
    expect(col(27).reference).not.toBeNull();
    expect(col(28)).toMatchObject({
      status: "not_comparable",
      comparison: null,
    });
    expect(col(29)).toMatchObject({ status: "paired", differs: true });
    expect(col(25).selected).toBe(true);
    expect(strip.columns[0].uniprotPosition).toBe(18);
  });

  it("never starts before UniProt position 1", () => {
    const corr = correspondence(ref.side, cmp.side);
    const strip = pairedSequenceStrip(corr, at(3), ref.snapshot, cmp.snapshot);
    expect(strip.columns[0].uniprotPosition).toBe(1);
    expect(strip.columns.at(-1)!.uniprotPosition).toBe(10);
  });
});
