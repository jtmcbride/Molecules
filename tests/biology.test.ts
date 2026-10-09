import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseDiscovery,
  decompressSifts,
  parseSiftsXml,
} from "../src/data/sifts";
import { parseUniProt } from "../src/data/uniprot";
import { mapResidues } from "../src/biology/mapping";
import { projectAnnotations } from "../src/biology/projection";
import type { ResourceSnapshot } from "../src/domain/biology";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
import { biologyFixture } from "./helpers/biology";
describe("biological identity and evidence", () => {
  it("pins source bytes and validates real 3PTB catalytic/binding positions", async () => {
    const manifest = JSON.parse(
      await readFile("tests/fixtures/biology/manifest.json", "utf8"),
    );
    for (const row of manifest)
      expect(
        sha(
          new Uint8Array(await readFile(`tests/fixtures/biology/${row.file}`)),
        ),
      ).toBe(row.sha256);
    const p = await biologyFixture();
    for (const [author, label, uniprot] of [
      ["57", 40, 63],
      ["102", 84, 107],
      ["189", 171, 194],
      ["195", 177, 200],
    ] as const) {
      const residue = p.snapshot.residues.find(
        (r) => r.authSeqId === author && r.kind === "polymer",
      )!;
      expect(p.mappings.find((m) => m.residueId === residue.id)).toMatchObject({
        labelSeqId: label,
        uniprotPosition: uniprot,
        status: "exact",
        accession: "P00760",
      });
    }
    expect(p.coverage[0].exact).toBe(223);
    expect(p.coverage[0].unmapped).toBe(0);
    const active = p.annotations.find(
      (a) => a.type === "Active site" && a.start.position === 200,
    )!;
    expect(
      p.evidence.filter((e) => active.evidenceIds.includes(e.id) && e.ecoCode),
    ).toHaveLength(0);
    expect(active.evidenceIds.length).toBe(1);
    const projection = p.projections.find((a) => a.annotationId === active.id)!;
    expect(
      p.snapshot.residues.find((r) => r.id === projection.residueIds[0])!
        .authSeqId,
    ).toBe("195");
    expect(
      p.annotations.find((a) => a.type === "Signal")!.evidenceIds.length,
    ).toBeGreaterThan(1);
  });
  it("maps all hemoglobin chains and assembly instances without mixing alpha/beta proteins", async () => {
    const p = await biologyFixture("4HHB", "1");
    for (const chain of p.snapshot.chains.filter((c) => c.type === "polymer")) {
      const rows = p.mappings.filter((m) => m.chainInstanceId === chain.id);
      expect(new Set(rows.map((m) => m.accession))).toEqual(
        new Set(
          ["A", "C"].includes(chain.authAsymId) ? ["P69905"] : ["P68871"],
        ),
      );
      expect(rows[0].uniprotPosition).toBe(2);
      expect(rows.every((r) => r.status === "exact")).toBe(true);
    }
    expect(new Set(p.mappings.map((m) => m.id)).size).toBe(p.mappings.length);
  });
  it("keeps ambiguous correspondence, insertion codes, conflicts and sequence mismatches explicit", async () => {
    const p = await biologyFixture(),
      row = p.sifts.rows.find((r) => r.authNumber === "189")!,
      residue = p.snapshot.residues.find(
        (r) => r.kind === "polymer" && r.authSeqId === "189",
      )!;
    const duplicate = {
      ...row,
      uniprotPosition: 195,
      uniprotResidue: p.proteins[0].sequence[194],
    };
    const ambiguous = mapResidues(
      p.snapshot,
      p.discovery,
      [...p.sifts.rows, duplicate],
      p.proteins,
      [],
    );
    expect(
      ambiguous.mappings
        .filter((m) => m.residueId === residue.id)
        .every((m) => m.status !== "exact"),
    ).toBe(true);
    const wrong = mapResidues(
      p.snapshot,
      p.discovery,
      p.sifts.rows.map((r) => (r === row ? { ...r, uniprotResidue: "W" } : r)),
      p.proteins,
      [],
    );
    expect(wrong.mappings.find((m) => m.residueId === residue.id)!.status).toBe(
      "sequence_mismatch",
    );
    residue.insertionCode = "A";
    const inserted = mapResidues(
      p.snapshot,
      p.discovery,
      p.sifts.rows.map((r) => (r === row ? { ...r, authNumber: "189A" } : r)),
      p.proteins,
      [],
    );
    expect(
      inserted.mappings.find((m) => m.residueId === residue.id),
    ).toMatchObject({ status: "exact", insertionCode: "A" });
    expect(
      mapResidues(
        p.snapshot,
        p.discovery,
        p.sifts.rows,
        p.proteins,
        [],
      ).mappings.find((m) => m.residueId === residue.id)!.status,
    ).toBe("source_conflict");
  });
  it("preserves missing sequence positions and never projects uncertain boundaries as exact residues", async () => {
    const p = await biologyFixture();
    const position = p.snapshot.chains[0].sequence.find(
      (s) => s.labelSeqId === 177,
    )!;
    position.residueIds = [];
    const mapped = mapResidues(
      p.snapshot,
      p.discovery,
      p.sifts.rows,
      p.proteins,
      [],
    );
    const active = p.annotations.find(
      (a) => a.type === "Active site" && a.start.position === 200,
    )!;
    const projection = projectAnnotations([active], mapped.mappings)[0];
    expect(projection.residueIds).toHaveLength(0);
    expect(projection.unobservedPositions).toEqual([200]);
    const uncertain = projectAnnotations(
      [{ ...active, start: { position: 200, modifier: "less_than" } }],
      p.mappings,
    )[0];
    expect(uncertain.uncertain).toBe(true);
    expect(uncertain.residueIds).toEqual([]);
    expect(uncertain.ambiguousPositions).toEqual([200]);
  });
  it("rejects malformed/source-mismatched XML, compressed input and canonical substitution for an isoform", async () => {
    const p = await biologyFixture();
    expect(() => parseSiftsXml(p.xml, "4HHB")).toThrow("did not match");
    expect(() => parseSiftsXml("<entry>", "3PTB")).toThrow("Invalid");
    expect(() => parseSiftsXml("<!DOCTYPE entry><entry/>", "3PTB")).toThrow(
      "Invalid",
    );
    await expect(decompressSifts(new Uint8Array([1, 2]))).rejects.toThrow(
      "gzip",
    );
    const raw = JSON.parse(
      await readFile("tests/fixtures/biology/P00760.json", "utf8"),
    );
    const resource: ResourceSnapshot = {
      id: "test",
      key: "test",
      provider: "UniProt",
      identifier: "P00760-2",
      url: "https://example.test",
      bytes: new Uint8Array(),
      contentHash: "test",
      retrievedAt: "2026-10-09",
    };
    await expect(parseUniProt(raw, "P00760-2", resource)).rejects.toThrow(
      "isoform",
    );
  });
  it("does not project out-of-sequence features and retains attached evidence only on its statement", async () => {
    const raw = JSON.parse(
      await readFile("tests/fixtures/biology/P00760.json", "utf8"),
    );
    raw.features = [
      {
        type: "Active site",
        location: { start: { value: 1000 }, end: { value: 1000 } },
      },
      {
        type: "Domain",
        location: {
          start: { value: 30, modifier: "UNKNOWN" },
          end: { value: 50 },
        },
        evidences: [
          { evidenceCode: "ECO:0000269", source: "PubMed", id: "1234" },
        ],
      },
    ];
    const p = await biologyFixture(),
      record: ResourceSnapshot = {
        id: "test",
        key: "test",
        provider: "UniProt",
        identifier: "P00760",
        url: "https://example.test",
        bytes: new Uint8Array(),
        contentHash: "test",
        retrievedAt: "2026-10-09",
      };
    const parsed = await parseUniProt(raw, "P00760", record);
    expect(parsed.annotations[0].valid).toBe(false);
    expect(parsed.annotations[0].evidenceIds).toHaveLength(1);
    expect(parsed.annotations[1].start.modifier).toBe("unknown");
    expect(parsed.evidence.find((e) => e.ecoCode)!.url).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/1234/",
    );
    expect(projectAnnotations([parsed.annotations[0]], p.mappings)).toEqual([]);
  });
});
