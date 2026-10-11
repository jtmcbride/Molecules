import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseUniProt } from "../src/data/uniprot";
import { featureCategory } from "../src/domain/biology";
import type { ResourceSnapshot } from "../src/domain/biology";
import { projectAnnotations } from "../src/biology/projection";
import { variantResidueStates } from "../src/biology/variants";
import { biologyFixture } from "./helpers/biology";

async function uniprot(accession: string, edit?: (raw: any) => void) {
  const raw = JSON.parse(
    await readFile(`tests/fixtures/biology/${accession}.json`, "utf8"),
  );
  edit?.(raw);
  const resource: ResourceSnapshot = {
    id: `${accession}:fixture`,
    key: accession,
    provider: "UniProt",
    identifier: accession,
    url: `https://rest.uniprot.org/uniprotkb/${accession}.json`,
    bytes: new Uint8Array(),
    contentHash: "fixture",
    retrievedAt: "2026-10-10T00:00:00Z",
  };
  return parseUniProt(raw, accession, resource);
}
type Fixture = Awaited<ReturnType<typeof biologyFixture>>;
const variant = (
  p: { annotations: Fixture["annotations"] },
  accession: string,
  type: string,
  position: number,
  alternative?: string,
) =>
  p.annotations.find(
    (a) =>
      a.proteinId.startsWith(`${accession}:`) &&
      a.type === type &&
      a.start.position === position &&
      (alternative === undefined ||
        a.substitution?.alternatives.includes(alternative)),
  )!;

describe("curated variant records (UniProt)", () => {
  it("keeps the stated replacement and cross-references of hemoglobin beta variants", async () => {
    const { annotations } = await uniprot("P68871");
    const variants = annotations.filter((a) => a.type === "Natural variant");
    expect(variants).toHaveLength(261);
    expect(variants.filter((a) => a.substitution)).toHaveLength(258);
    expect(variants.every((a) => featureCategory(a.type) === "variant")).toBe(
      true,
    );
    expect(variants.flatMap((a) => a.qualityFlags)).toEqual([]);
    const sickle = variant(
      { annotations },
      "P68871",
      "Natural variant",
      7,
      "V",
    );
    expect(sickle).toMatchObject({
      substitution: { original: "E", alternatives: ["V"] },
      crossReferences: [{ database: "dbSNP", id: "rs334" }],
    });
    expect(sickle.description).toContain("Hb S");
    // Hb Bruxelles (a deletion) states no replacement; none is inferred from its text.
    const bruxelles = variants.filter((a) =>
      a.description.startsWith("in Bruxelles"),
    );
    expect(bruxelles.length).toBeGreaterThan(0);
    expect(bruxelles.every((a) => a.substitution === undefined)).toBe(true);
  });

  it("keeps multi-residue replacements and mutagenesis features as separate records", async () => {
    const { annotations } = await uniprot("P01009");
    expect(
      annotations.find(
        (a) => a.start.position === 190 && a.end.position === 198,
      )!.substitution,
    ).toEqual({ original: "QGKIVDLVK", alternatives: ["GFQNAILVR"] });
    const pittsburgh = variant(
        { annotations },
        "P01009",
        "Natural variant",
        382,
        "R",
      ),
      mutagenesis = variant({ annotations }, "P01009", "Mutagenesis", 382);
    expect(pittsburgh.description).toContain("Pittsburgh");
    expect(mutagenesis).toMatchObject({
      substitution: { original: "M", alternatives: ["V"] },
    });
    expect(mutagenesis.id).not.toBe(pittsburgh.id);
    expect(featureCategory("Mutagenesis")).toBe("variant");
    // Only variant types carry a replacement: sequence conflicts keep their previous form.
    expect(
      annotations
        .filter((a) => a.type === "Sequence conflict")
        .every((a) => !a.substitution && !a.qualityFlags.length),
    ).toBe(true);
  });

  it("drops a replacement that disagrees with the sequence or has uncertain bounds, with a flag", async () => {
    // Synthetic in-memory changes to the frozen P68871 record.
    const { annotations } = await uniprot("P68871", (raw) => {
      const features = raw.features.filter(
        (f: any) => f.type === "Natural variant",
      );
      features[0].alternativeSequence.originalSequence = "W";
      features[1].location.start.modifier = "LESS_THAN";
      features[2].alternativeSequence = { originalSequence: 5 };
    });
    const variants = annotations.filter((a) => a.type === "Natural variant");
    expect(variants[0].substitution).toBeUndefined();
    expect(variants[0].qualityFlags[0]).toMatch(/differ from the sequence/);
    expect(variants[1].substitution).toBeUndefined();
    expect(variants[1].qualityFlags[0]).toMatch(/uncertain feature bounds/);
    // A malformed replacement is dropped without rejecting the record.
    expect(variants[2].substitution).toBeUndefined();
    expect(variants).toHaveLength(261);
  });
});

describe("natural variants in deposited structures", () => {
  it("maps sickle haemoglobin (2HBS) beta Val6 exactly to P68871 E7V as a SIFTS natural variant", async () => {
    const p = await biologyFixture("2HBS");
    const rows = p.mappings.filter(
      (m) => m.accession === "P68871" && m.uniprotPosition === 7,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows)
      expect(row).toMatchObject({
        status: "exact",
        identity: "natural_variant",
        residueChange: { uniprot: "E", deposited: "V" },
        authSeqId: "6",
      });
    const states = variantResidueStates(p.annotations, p.mappings, p.proteins);
    const sickle = variant(p, "P68871", "Natural variant", 7, "V"),
      hbC = variant(p, "P68871", "Natural variant", 7, "K");
    for (const row of rows) {
      expect(
        states.find(
          (s) =>
            s.annotationId === sickle.id &&
            s.chainInstanceId === row.chainInstanceId,
        ),
      ).toMatchObject({
        state: "carries",
        deposited: "V",
        identities: ["natural_variant"],
        residueIds: [row.residueId],
      });
      expect(
        states.find(
          (s) =>
            s.annotationId === hbC.id &&
            s.chainInstanceId === row.chainInstanceId,
        ),
      ).toMatchObject({ state: "other", deposited: "V" });
    }
  });

  it("reports that 1OPH carries the Pittsburgh variant through a SIFTS engineered mutation", async () => {
    const p = await biologyFixture("1OPH");
    const states = variantResidueStates(p.annotations, p.mappings, p.proteins);
    const pittsburgh = variant(p, "P01009", "Natural variant", 382, "R"),
      mutagenesis = variant(p, "P01009", "Mutagenesis", 382);
    expect(states.find((s) => s.annotationId === pittsburgh.id)).toMatchObject({
      state: "carries",
      deposited: "R",
      identities: ["engineered_mutation"],
    });
    expect(states.find((s) => s.annotationId === mutagenesis.id)).toMatchObject(
      { state: "other", deposited: "R" },
    );
    // The nine-residue replacement is compared over its whole span.
    const aberrant = p.annotations.find(
      (a) => a.start.position === 190 && a.end.position === 198,
    )!;
    expect(states.find((s) => s.annotationId === aberrant.id)).toMatchObject({
      state: "original",
      deposited: "QGKIVDLVK",
    });
  });

  it("records the original residue in wild-type 4HHB and leaves unstated replacements unevaluated", async () => {
    const p = await biologyFixture("4HHB");
    const states = variantResidueStates(p.annotations, p.mappings, p.proteins);
    const sickle = variant(p, "P68871", "Natural variant", 7, "V");
    const sickleStates = states.filter((s) => s.annotationId === sickle.id);
    expect(sickleStates).toHaveLength(2); // chains B and D
    expect(sickleStates.every((s) => s.state === "original")).toBe(true);
    const bruxelles = p.annotations.find(
      (a) =>
        a.type === "Natural variant" &&
        a.description.startsWith("in Bruxelles"),
    )!;
    expect(states.find((s) => s.annotationId === bruxelles.id)).toMatchObject({
      state: "not_evaluated",
      reason: "The source states no residue replacement.",
    });
  });

  it("projects variant features like other features and keeps them out of site counts", async () => {
    const p = await biologyFixture("4HHB");
    const variants = p.annotations.filter(
      (a) => featureCategory(a.type) === "variant",
    );
    const projections = projectAnnotations(variants, p.mappings);
    const sickle = variant(p, "P68871", "Natural variant", 7, "V");
    expect(
      projections.filter((pr) => pr.annotationId === sickle.id),
    ).toHaveLength(2);
    expect(
      projections.find((pr) => pr.annotationId === sickle.id)!.residueIds,
    ).toHaveLength(1);
  });

  it("does not evaluate a position whose correspondence is not exact", async () => {
    const p = await biologyFixture("2HBS");
    // Synthetic in-memory change: drop the SIFTS "Variant" annotation at UniProt 7.
    const { mapResidues } = await import("../src/biology/mapping");
    const rows = p.sifts.rows.map((r) =>
      r.accession === "P68871" && r.uniprotPosition === 7
        ? { ...r, annotations: [] }
        : r,
    );
    const remapped = mapResidues(p.snapshot, p.discovery, rows, p.proteins, [
      "sifts-fixture",
    ]);
    const states = variantResidueStates(
      p.annotations,
      remapped.mappings,
      p.proteins,
    );
    const sickle = variant(p, "P68871", "Natural variant", 7, "V");
    const sickleStates = states.filter((s) => s.annotationId === sickle.id);
    expect(sickleStates.length).toBeGreaterThan(0);
    for (const s of sickleStates)
      expect(s).toMatchObject({
        state: "not_evaluated",
        reason: expect.stringMatching(/no exact correspondence/),
      });
  });
});

describe("comparison with a natural-variant structure", () => {
  it("pairs 4HHB with sickle haemoglobin 2HBS at UniProt 7 as E→V instead of not comparable", async () => {
    const { comparisonSide } = await import("./helpers/comparison");
    const { correspondence } = await import("../src/comparison/correspondence");
    const [a, b] = await Promise.all([
      comparisonSide("4HHB"),
      comparisonSide("2HBS"),
    ]);
    const result = correspondence(a.side, b.side);
    const atSeven = result.pairs.filter(
      (p) => p.accession === "P68871" && p.uniprotPosition === 7,
    );
    expect(atSeven).toHaveLength(2); // beta chains B and D of the reference
    for (const pair of atSeven)
      expect(pair).toMatchObject({
        status: "paired",
        residueChange: { reference: "E", comparison: "V" },
      });
    expect(result.counts.not_comparable).toBe(0);
  });
});
