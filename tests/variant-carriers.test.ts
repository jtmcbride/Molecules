import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { carrierRequest } from "../src/data/biologyResources";
import { parseCarriers } from "../src/data/variantCarriers";
import {
  decompressSifts,
  parseDiscovery,
  parseSiftsXml,
} from "../src/data/sifts";
import { alignedResidue, variantCarriers } from "../src/biology/carriers";
import { CODES } from "../src/biology/mapping";
import { parseUniProt } from "../src/data/uniprot";
import type { FunctionalAnnotation } from "../src/domain/biology";

const fixture = (file: string) =>
  readFile(`tests/fixtures/biology/${file}`, "utf8").then(JSON.parse);
async function protein(accession: string) {
  return parseUniProt(await fixture(`${accession}.json`), accession, {
    id: `${accession}:fixture`,
    key: accession,
    provider: "UniProt",
    identifier: accession,
    url: `https://rest.uniprot.org/uniprotkb/${accession}.json`,
    bytes: new Uint8Array(),
    contentHash: "fixture",
    retrievedAt: "2026-10-10T00:00:00Z",
  });
}
async function lookup(accession: string, edit?: (raw: any) => void) {
  const raw = await fixture(`carriers-${accession}.json`);
  edit?.(raw);
  const { protein: record, annotations } = await protein(accession);
  const request = carrierRequest(accession);
  return {
    annotations,
    lookup: parseCarriers(raw, accession, record.sequence, {
      ...request,
      id: `${accession}:carriers`,
      contentHash: "fixture",
      retrievedAt: "2026-10-10T00:00:00Z",
    }),
  };
}
const find = (
  annotations: FunctionalAnnotation[],
  position: number,
  replacement: string,
  type = "Natural variant",
) =>
  annotations.find(
    (a) =>
      a.type === type &&
      a.start.position === position &&
      a.substitution?.alternatives.includes(replacement),
  )!;
const entriesFor = (
  annotation: FunctionalAnnotation,
  data: Awaited<ReturnType<typeof lookup>>["lookup"],
  replacement: string,
) => {
  const result = variantCarriers(annotation, data).find(
    (c) => c.replacement === replacement,
  )!;
  if (result.status !== "evaluated") throw Error(result.reason);
  return result;
};

describe("carrier lookup (RCSB sequence-coordinates alignments)", () => {
  it("records the exact request body that produced each frozen response", async () => {
    const manifest = await fixture("manifest.json");
    for (const accession of ["P68871", "P69905", "P01009", "P00760"]) {
      const entry = manifest.find(
        (e: { file: string }) => e.file === `carriers-${accession}.json`,
      );
      expect(entry.requestBody).toBe(carrierRequest(accession).requestBody);
      expect(entry.url).toBe(carrierRequest(accession).url);
    }
    expect(() => carrierRequest("P68871-2")).toThrow(/canonical/);
  });

  it("normalizes every aligned entity of the frozen responses", async () => {
    for (const [accession, count] of [
      ["P68871", 351],
      ["P69905", 358],
      ["P01009", 57],
      ["P00760", 618],
    ] as const) {
      const { lookup: data } = await lookup(accession);
      expect(data.entities).toHaveLength(count);
      expect(data.invalidEntityIds).toEqual([]);
      // Each response also aligns one AlphaFold model, which is not a deposited structure.
      expect(data.computedModelIds).toEqual([`AF_AF${accession}F1_1`]);
    }
  });

  it("finds sickle haemoglobin and the alpha-1-antitrypsin Pittsburgh and Z variants", async () => {
    const beta = await lookup("P68871");
    const sickle = entriesFor(find(beta.annotations, 7, "V"), beta.lookup, "V");
    expect(sickle.carriers.map((c) => c.entryId)).toEqual([
      "1HBS",
      "1NEJ",
      "2HBS",
      "3W4U",
      "5E6E",
      "5E83",
      "5U3I",
      "5UFJ",
      "7K4M",
      "7UVB",
    ]);
    expect(sickle.total).toBe(351);
    expect(sickle.otherResidue + sickle.notCovered).toBe(
      351 - sickle.carriers.flatMap((c) => c.entityIds).length,
    );
    const a1at = await lookup("P01009");
    expect(
      entriesFor(
        find(a1at.annotations, 382, "R"),
        a1at.lookup,
        "R",
      ).carriers.map((c) => c.entryId),
    ).toEqual(["1D5S", "1OO8", "1OPH", "1QMB", "3NDD", "3NDF", "3T1P", "5IO1"]);
    expect(
      entriesFor(
        find(a1at.annotations, 366, "K"),
        a1at.lookup,
        "K",
      ).carriers.map((c) => c.entryId),
    ).toEqual(["5IO1", "5NBV"]);
  });

  it("refuses a response whose aligned sequence differs from the pinned UniProt record", async () => {
    await expect(
      lookup("P68871", (raw) => {
        // Artificial in-memory change.
        raw.data.alignments.query_sequence =
          "M" + raw.data.alignments.query_sequence;
      }),
    ).rejects.toThrow(/Source conflict/);
    await expect(
      lookup("P68871", (raw) => {
        raw.errors = [{ message: "artificial" }];
      }),
    ).rejects.toThrow(/returned an error/);
  });

  it("sets aside an entity whose regions disagree with its sequence", async () => {
    const { lookup: data } = await lookup("P68871", (raw) => {
      // Artificial: stretch one region past its target sequence.
      raw.data.alignments.target_alignments[0].aligned_regions[0].target_end += 500;
      raw.data.alignments.target_alignments[0].aligned_regions[0].query_end += 500;
    });
    expect(data.invalidEntityIds).toHaveLength(1);
    expect(data.entities).toHaveLength(350);
  });

  it("does not look up insertions, deletions or uncertain bounds", async () => {
    const { annotations, lookup: data } = await lookup("P68871");
    const base = find(annotations, 7, "V");
    const results = [
      { ...base, substitution: { original: "E", alternatives: ["VV"] } },
      { ...base, start: { position: 7, modifier: "less_than" as const } },
    ].flatMap((a) => variantCarriers(a, data));
    expect(results.map((r) => r.status)).toEqual([
      "not_evaluated",
      "not_evaluated",
    ]);
    expect(variantCarriers({ ...base, substitution: undefined }, data)).toEqual(
      [],
    );
  });
});

describe("cross-check: alignment residues agree with frozen SIFTS residue mappings", () => {
  for (const entry of [
    "1OPH",
    "2HBS",
    "4HHB",
    "1HHO",
    "2DN1",
    "2DN2",
    "3PTB",
    "1S0R",
    "1S0Q",
  ])
    it(entry, async () => {
      const discovery = parseDiscovery(
        await fixture(`${entry.toLowerCase()}-discovery.json`),
        entry,
      );
      const xml = await decompressSifts(
        new Uint8Array(
          await readFile(
            `tests/fixtures/biology/${entry.toLowerCase()}-sifts.xml.gz`,
          ),
        ),
      );
      const rows = parseSiftsXml(xml, entry).rows;
      let compared = 0;
      for (const accession of new Set(discovery.map((d) => d.accession))) {
        const { lookup: data } = await lookup(accession);
        for (const row of rows.filter((r) => r.accession === accession)) {
          const code = CODES[row.componentId];
          if (!code) continue; // modified or non-standard components
          const segment = discovery.find(
            (d) => d.accession === accession && d.authChain === row.authChain,
          );
          if (!segment) continue;
          const entity = data.entities.find(
            (e) => e.entityId === `${entry}_${segment.entityId}`,
          );
          expect(entity, `${entry}_${segment.entityId}`).toBeDefined();
          expect([
            entry,
            row.authChain,
            row.uniprotPosition,
            alignedResidue(entity!, row.uniprotPosition),
          ]).toEqual([entry, row.authChain, row.uniprotPosition, code]);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(200);
    });
});
