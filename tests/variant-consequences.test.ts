import { describe, expect, it } from "vitest";
import {
  atomConsequence,
  RESIDUE_NAMES,
  variantConsequences,
} from "../src/biology/consequences";
import {
  atomSentence,
  consequenceSentences,
  FORBIDDEN_CONSEQUENCE_WORDS,
} from "../src/biology/consequenceText";
import { SIDECHAINS } from "../src/analysis/completeness";
import {
  BIOLOGY_VERSION,
  CONSEQUENCE_CODES,
  type FunctionalAnnotation,
  type VariantConsequence,
} from "../src/domain/biology";
import type { InteractionType } from "../src/domain/analysis";
import { comparisonSide } from "./helpers/comparison";
import { analyzeLigand } from "./helpers/fingerprint";

async function analyzed(id: string, component: string, chain: string) {
  const p = await comparisonSide(id);
  const run = await analyzeLigand(p, component, chain);
  const interpretation = {
    snapshotId: p.snapshot.id,
    version: BIOLOGY_VERSION,
    proteins: p.proteins,
    annotations: p.annotations,
    mappings: p.mappings,
  };
  return { ...p, run, interpretation };
}
type Case = Awaited<ReturnType<typeof analyzed>>;
const at = (p: Case, accession: string, position: number) =>
  p.annotations.filter(
    (a) =>
      a.proteinId.startsWith(`${accession}:`) &&
      (a.type === "Natural variant" || a.type === "Mutagenesis") &&
      a.start.position === position,
  );
const forbidden = (text: string) =>
  FORBIDDEN_CONSEQUENCE_WORDS.filter((w) => text.toLowerCase().includes(w));

describe("structural consequences at the 4HHB beta heme", () => {
  it("reports the proximal His93 iron coordination atom as absent in every stated replacement", async () => {
    const p = await analyzed("4HHB", "HEM", "B");
    const consequences = variantConsequences(
      p.interpretation,
      p.run,
      p.snapshot,
    );
    const interactions = new Map(p.run.interactions.map((i) => [i.id, i]));
    const proximal = consequences.filter(
      (c) =>
        at(p, "P68871", 93).some((a) => a.id === c.annotationId) &&
        interactions.get(c.interactionId)!.type === "metal_coordination",
    );
    expect(
      proximal.map((c) => c.status === "evaluated" && c.replacement).sort(),
    ).toEqual(["D", "N", "P", "Q"]);
    for (const c of proximal) {
      expect(c).toMatchObject({
        status: "evaluated",
        deposited: "H",
        retained: "none",
        sideChainAdded: false,
        atoms: [{ atomName: "NE2", code: "deposited_atom_absent" }],
      });
      const text = consequenceSentences(c);
      expect(text.at(-1)).toMatch(
        /forms this or another interaction, are not evaluated/,
      );
      expect(text.flatMap(forbidden)).toEqual([]);
    }
  });

  it("states only atom facts for Hb M Saskatoon and quotes the source unchanged", async () => {
    const p = await analyzed("4HHB", "HEM", "B");
    const consequences = variantConsequences(
      p.interpretation,
      p.run,
      p.snapshot,
    );
    const saskatoon = at(p, "P68871", 64).find((a) =>
      a.substitution?.alternatives.includes("Y"),
    )!;
    expect(saskatoon.description).toBe(
      "in M-Saskatoon; O(2) affinity up; dbSNP:rs33922873",
    );
    const c = consequences.filter((x) => x.annotationId === saskatoon.id);
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) {
      expect(x).toMatchObject({ status: "evaluated", replacement: "Y" });
      const text = consequenceSentences(x).join(" ");
      expect(text).toContain("not part of Tyr");
      expect(text).toContain("whether Tyr forms this or another interaction");
      // The tyrosine binds the iron in this variant: nothing may say the contact goes away.
      expect(forbidden(text)).toEqual([]);
    }
  });

  it("reports Hammersmith (F43S) ring contacts as absent and leaves Bruxelles unevaluated", async () => {
    const p = await analyzed("4HHB", "HEM", "B");
    const consequences = variantConsequences(
      p.interpretation,
      p.run,
      p.snapshot,
    );
    const variants = at(p, "P68871", 43);
    const hammersmith = variants.find((a) =>
      a.description.startsWith("in Hammersmith"),
    )!;
    const bruxelles = variants.find((a) =>
      a.description.startsWith("in Bruxelles"),
    )!;
    const evaluated = consequences.filter(
      (c) => c.annotationId === hammersmith.id,
    );
    expect(evaluated.length).toBeGreaterThan(0);
    for (const c of evaluated)
      expect(c).toMatchObject({ status: "evaluated", retained: "none" });
    for (const c of consequences.filter((x) => x.annotationId === bruxelles.id))
      expect(c).toMatchObject({
        status: "not_evaluated",
        reason: "The source states no residue replacement.",
      });
  });

  it("evaluates chemical interaction types only", async () => {
    const p = await analyzed("4HHB", "HEM", "B");
    const consequences = variantConsequences(
      p.interpretation,
      p.run,
      p.snapshot,
    );
    const types = new Set(
      consequences.map(
        (c) => p.run.interactions.find((i) => i.id === c.interactionId)!.type,
      ),
    );
    expect(types.has("proximity_contact")).toBe(false);
    expect(types.has("steric_clash")).toBe(false);
  });

  it("refuses an analysis of another structure", async () => {
    const p = await analyzed("4HHB", "HEM", "B");
    expect(() =>
      variantConsequences(
        { ...p.interpretation, snapshotId: "other" },
        p.run,
        p.snapshot,
      ),
    ).toThrow(/different coordinate snapshots/);
  });
});

describe("atom classification rules", () => {
  it("keeps backbone atoms, removes side-chain atoms beyond CB and treats CB by glycine", () => {
    expect(atomConsequence("O", "A", "hydrogen_bond", "acceptor")).toBe(
      "deposited_atom_retained",
    );
    expect(atomConsequence("CA", "G", "hydrophobic_contact", "receptor")).toBe(
      "deposited_atom_retained",
    );
    expect(atomConsequence("CB", "A", "hydrophobic_contact", "receptor")).toBe(
      "deposited_atom_retained",
    );
    expect(atomConsequence("CB", "G", "hydrophobic_contact", "receptor")).toBe(
      "deposited_atom_absent",
    );
    // No name equivalence: Asp OD1 is not Asn OD1, Leu CD1 is not Ile CD1.
    expect(atomConsequence("OD1", "N", "salt_bridge", "negative_group")).toBe(
      "deposited_atom_absent",
    );
    expect(atomConsequence("CD1", "I", "hydrophobic_contact", "receptor")).toBe(
      "deposited_atom_absent",
    );
  });

  it("states that proline's backbone nitrogen has no hydrogen only where it donates", () => {
    for (const type of ["hydrogen_bond", "water_bridge"] as InteractionType[])
      expect(atomConsequence("N", "P", type, "donor")).toBe(
        "backbone_nitrogen_without_hydrogen",
      );
    expect(atomConsequence("N", "P", "metal_coordination", "coordinator")).toBe(
      "deposited_atom_retained",
    );
    expect(atomConsequence("N", "A", "hydrogen_bond", "donor")).toBe(
      "deposited_atom_retained",
    );
  });
});

describe("synthetic positions (artificial in-memory variant records)", () => {
  // Bovine trypsin (P00760) has no curated variants. These cases add artificial ones.
  async function trypsinWith(
    edit: (residueAt: (u: number) => string) => FunctionalAnnotation[],
  ) {
    const p = await analyzed("3PTB", "BEN", "A");
    const protein = p.proteins[0];
    const residueAt = (u: number) => protein.sequence[u - 1];
    const annotations = edit(residueAt).map((a) => ({
      ...a,
      proteinId: protein.id,
    }));
    return {
      p,
      consequences: variantConsequences(
        {
          ...p.interpretation,
          annotations: [...p.annotations, ...annotations],
        },
        p.run,
        p.snapshot,
      ),
    };
  }
  const artificial = (
    id: string,
    start: number,
    end: number,
    substitution?: FunctionalAnnotation["substitution"],
  ): FunctionalAnnotation => ({
    id,
    proteinId: "",
    type: "Natural variant",
    description: "artificial",
    start: { position: start, modifier: "exact" },
    end: { position: end, modifier: "exact" },
    ...(substitution ? { substitution } : {}),
    evidenceIds: [],
    valid: true,
    qualityFlags: [],
  });

  it("adds a side-chain note for a deposited glycine and evaluates Asp189 (UniProt 194) salt bridges", async () => {
    const { p, consequences } = await trypsinWith((r) => [
      artificial("gly", 219, 219, { original: r(219), alternatives: ["A"] }),
      artificial("asp", 194, 194, { original: r(194), alternatives: ["N"] }),
    ]);
    expect(p.proteins[0].sequence[218]).toBe("G");
    const gly = consequences.filter((c) => c.annotationId === "gly");
    expect(gly.length).toBeGreaterThan(0);
    for (const c of gly)
      expect(c).toMatchObject({ status: "evaluated", sideChainAdded: true });
    const salt = consequences.filter(
      (c) =>
        c.annotationId === "asp" &&
        p.run.interactions.find((i) => i.id === c.interactionId)!.type ===
          "salt_bridge",
    );
    expect(salt.length).toBeGreaterThan(0);
    for (const c of salt)
      expect(c).toMatchObject({ status: "evaluated", retained: "none" });
  });

  it("does not evaluate multi-residue, mismatched-original or unstated replacements", async () => {
    const { consequences } = await trypsinWith((r) => [
      artificial("span", 194, 195, {
        original: r(194) + r(195),
        alternatives: ["NA"],
      }),
      artificial("mismatch", 194, 194, { original: "E", alternatives: ["K"] }),
      artificial("unstated", 194, 194),
    ]);
    const reason = (id: string) =>
      consequences.find((c) => c.annotationId === id) as Extract<
        VariantConsequence,
        { status: "not_evaluated" }
      >;
    expect(reason("span").reason).toMatch(/Multi-residue/);
    expect(reason("mismatch").reason).toBe(
      "The deposited residue (D) is not the stated original (E).",
    );
    expect(reason("unstated").reason).toBe(
      "The source states no residue replacement.",
    );
  });

  it("does not evaluate a non-standard deposited component", async () => {
    const p = await analyzed("3PTB", "BEN", "A");
    const protein = p.proteins[0];
    const asp = p.mappings.find(
      (m) => m.uniprotPosition === 194 && m.status === "exact",
    )!.residueId!;
    const consequences = variantConsequences(
      {
        ...p.interpretation,
        annotations: [
          {
            id: "renamed",
            proteinId: protein.id,
            type: "Natural variant",
            description: "artificial",
            start: { position: 194, modifier: "exact" },
            end: { position: 194, modifier: "exact" },
            substitution: { original: "D", alternatives: ["N"] },
            evidenceIds: [],
            valid: true,
            qualityFlags: [],
          },
        ],
      },
      p.run,
      {
        ...p.snapshot,
        // Artificial: rename the deposited Asp189 component.
        residues: p.snapshot.residues.map((r) =>
          r.id === asp ? { ...r, componentId: "XYZ" } : r,
        ),
      },
    );
    expect(consequences[0]).toMatchObject({
      status: "not_evaluated",
      reason: "The deposited residue XYZ is not a standard amino acid.",
    });
  });
});

describe("consequence wording", () => {
  it("never uses effect words in any sentence the module can produce", () => {
    const sentences = new Set<string>();
    const codes = Object.keys(RESIDUE_NAMES);
    for (const deposited of codes)
      for (const replacement of codes) {
        if (deposited === replacement) continue;
        const names = [
          "N",
          "CA",
          "C",
          "O",
          "OXT",
          ...SIDECHAINS[RESIDUE_NAMES[deposited]].split(" ").filter(Boolean),
        ];
        for (const atomName of names)
          for (const code of CONSEQUENCE_CODES)
            sentences.add(
              atomSentence(
                { atomIndex: 0, atomName, code },
                deposited,
                replacement,
              ),
            );
        for (const retained of ["all", "some", "none"] as const)
          for (const sideChainAdded of [true, false])
            consequenceSentences({
              annotationId: "a",
              interactionId: "i",
              residueId: "r",
              status: "evaluated",
              deposited,
              replacement,
              atoms: [],
              retained,
              sideChainAdded,
            }).forEach((s) => sentences.add(s));
      }
    expect(sentences.size).toBeGreaterThan(1000);
    expect([...sentences].filter((s) => forbidden(s).length)).toEqual([]);
  });
});
