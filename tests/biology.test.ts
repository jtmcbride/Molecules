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
import { dpiFree } from "../src/structure/quality";
import {
  cutoffMargin,
  distanceUncertainty,
  isBorderline,
} from "../src/analysis/uncertainty";
import {
  DEFAULT_PARAMETERS,
  type MolecularInteraction,
} from "../src/domain/analysis";
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
describe("engineered mutations (1OPH, S195A trypsin with alpha-1-antitrypsin Pittsburgh)", () => {
  const at = (
    p: Awaited<ReturnType<typeof biologyFixture>>,
    accession: string,
    position: number,
  ) =>
    p.mappings.filter(
      (m) => m.accession === accession && m.uniprotPosition === position,
    );
  it("keeps exact position correspondence for a curated engineered mutation and labels the change", async () => {
    const p = await biologyFixture("1OPH");
    const [ser195] = at(p, "P00760", 200);
    expect(ser195).toMatchObject({
      status: "exact",
      identity: "engineered_mutation",
      residueChange: { uniprot: "S", deposited: "A" },
      authSeqId: "195",
    });
    expect(
      p.snapshot.residues.find((r) => r.id === ser195.residueId)!.componentId,
    ).toBe("ALA");
    // The catalytic active-site feature still projects onto the mutated, observed residue.
    const activeSite = p.annotations.find(
      (a) =>
        a.proteinId === ser195.proteinId &&
        a.type === "Active site" &&
        a.start.position === 200,
    )!;
    const projection = p.projections.find(
      (pr) => pr.annotationId === activeSite.id,
    )!;
    expect(projection.residueIds).toEqual([ser195.residueId]);
    // The Pittsburgh variant (M358R) is also a curated engineered change in the other protein.
    expect(at(p, "P01009", 382)[0]).toMatchObject({
      identity: "engineered_mutation",
      residueChange: { uniprot: "M", deposited: "R" },
    });
    // Unchanged residues record a match without a residue change.
    expect(at(p, "P00760", 63)[0]).toMatchObject({
      identity: "match",
      status: "exact",
    });
    expect(at(p, "P00760", 63)[0].residueChange).toBeUndefined();
  });
  it("does not project the same difference when SIFTS gives no curated explanation", async () => {
    const p = await biologyFixture("1OPH");
    // Synthetic in-memory change: drop the "Engineered mutation" annotation from the row.
    const rows = p.sifts.rows.map((r) =>
      r.accession === "P00760" && r.uniprotPosition === 200
        ? { ...r, annotations: [] }
        : r,
    );
    const remapped = mapResidues(p.snapshot, p.discovery, rows, p.proteins, [
      "sifts-fixture",
    ]);
    const [row] = remapped.mappings.filter(
      (m) => m.accession === "P00760" && m.uniprotPosition === 200,
    );
    expect(row).toMatchObject({
      status: "sequence_mismatch",
      identity: "unexplained_mismatch",
    });
    const activeSite = p.annotations.find(
      (a) =>
        a.proteinId === row.proteinId &&
        a.type === "Active site" &&
        a.start.position === 200,
    )!;
    expect(
      projectAnnotations([activeSite], remapped.mappings)[0].residueIds,
    ).toEqual([]);
  });
});
describe("structure quality evidence", () => {
  it("computes Cruickshank DPI_free from 1OPH refinement statistics", async () => {
    const p = await biologyFixture("1OPH");
    const q = p.snapshot.quality!;
    expect(q).toMatchObject({
      method: "X-RAY DIFFRACTION",
      resolutionAngstrom: 2.3,
      rFree: 0.229,
      reflectionsUsed: 32771,
      completenessPercent: 97.5,
      coordinateErrorSource: "computed_dpi_free",
    });
    // Independent arithmetic: sqrt(Ni / n_obs) · C^(-1/3) · d_min · R_free.
    const expected =
      Math.sqrt(q.refinedAtomCount / 32771) * 0.975 ** (-1 / 3) * 2.3 * 0.229;
    expect(q.coordinateErrorAngstrom).toBeCloseTo(expected, 10);
    expect(q.coordinateErrorAngstrom!).toBeGreaterThan(0.15);
    expect(q.coordinateErrorAngstrom!).toBeLessThan(0.3);
    expect(q.refinedAtomCount).toBeGreaterThan(4000);
    expect(distanceUncertainty(q)).toBeCloseTo(
      Math.SQRT2 * q.coordinateErrorAngstrom!,
      12,
    );
  });
  it("estimates no coordinate error when refinement inputs are missing", async () => {
    const p = await biologyFixture();
    expect(p.snapshot.quality).toMatchObject({ resolutionAngstrom: 1.7 });
    expect(p.snapshot.quality!.coordinateErrorAngstrom).toBeUndefined();
    expect(
      dpiFree({ refinedAtomCount: 1000, resolutionAngstrom: 2, rFree: 0.2 }),
    ).toBeUndefined();
    expect(distanceUncertainty(p.snapshot.quality)).toBeUndefined();
  });
  it("flags measurements within one distance uncertainty of their cutoff without reclassifying them", () => {
    const params = { ...DEFAULT_PARAMETERS };
    const hbond = (d: number) =>
      ({ type: "hydrogen_bond", distanceAngstrom: d }) as MolecularInteraction;
    expect(cutoffMargin(hbond(3.3), params)).toBeCloseTo(0.2, 10);
    expect(isBorderline(hbond(3.3), params, 0.29)).toBe(true);
    expect(isBorderline(hbond(3.0), params, 0.29)).toBe(false);
    expect(isBorderline(hbond(3.3), params, undefined)).toBe(false);
    const stack = {
      type: "pi_stacking",
      distanceAngstrom: 3.4,
      geometry: { centroidDistanceAngstrom: 5.4 },
    } as MolecularInteraction;
    expect(cutoffMargin(stack, params)).toBeCloseTo(0.1, 10);
    const water = {
      type: "water_bridge",
      distanceAngstrom: 5,
      geometry: { waterLegDistancesAngstrom: [2.8, 4.0] },
    } as MolecularInteraction;
    expect(cutoffMargin(water, params)).toBeCloseTo(0.1, 10);
    const clash = {
      type: "steric_clash",
      distanceAngstrom: 2.6,
      geometry: { overlapAngstrom: 0.7 },
    } as MolecularInteraction;
    expect(cutoffMargin(clash, params)).toBeCloseTo(0.1, 10);
  });
});
