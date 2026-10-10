import { describe, expect, it } from "vitest";
import { biologyFixture } from "./helpers/biology";
import {
  BIOLOGY_VERSION,
  type InterpretationSnapshot,
} from "../src/domain/biology";
import { analyze } from "../src/analysis/engine";
import { DEFAULT_PARAMETERS } from "../src/domain/analysis";
import {
  ligandRelation,
  summarizeBindingSite,
  projectAnnotations,
} from "../src/biology/projection";
import { annotationCsv, interpretationJson } from "../src/biology/export";
import { mapResidues } from "../src/biology/mapping";
import { parseChemComp } from "../src/data/chemcomp";
import { cutoffMargin } from "../src/analysis/uncertainty";
import { readFile } from "node:fs/promises";
async function ligandIdentity(componentId: string) {
  const bytes = new Uint8Array(
    await readFile(`tests/fixtures/biology/chemcomp-${componentId}.json`),
  );
  return parseChemComp(
    JSON.parse(new TextDecoder().decode(bytes)),
    componentId,
    {
      id: `chemcomp:${componentId}`,
      key: `rcsb:chemcomp:${componentId}`,
      provider: "RCSB",
      identifier: componentId,
      url: `https://data.rcsb.org/rest/v1/core/chemcomp/${componentId}`,
      contentHash: "fixture",
      retrievedAt: "2026-10-10T00:00:00Z",
      bytes,
    },
  ).ligand;
}
async function caseData() {
  const p = await biologyFixture();
  const interpretation: InterpretationSnapshot = {
    schemaVersion: 1,
    id: "pinned-fixture",
    version: BIOLOGY_VERSION,
    snapshotId: p.snapshot.id,
    sourceHash: p.source.contentHash,
    entryId: "3PTB",
    createdAt: "2026-10-09T00:00:00Z",
    resourceIds: [],
    resourceRefs: [],
    proteins: p.proteins,
    annotations: p.annotations,
    mappings: p.mappings,
    coverage: p.coverage,
    projections: p.projections,
    evidence: p.evidence,
    qualityFlags: [],
    ligands: [await ligandIdentity("BEN"), await ligandIdentity("CA")],
  };
  return { ...p, interpretation };
}
async function benRun(p: Awaited<ReturnType<typeof caseData>>) {
  return analyze(
    p.structure,
    p.snapshot,
    p.selectionIndex,
    {
      ligandResidueId: p.snapshot.ligands.find((l) => l.componentId === "BEN")!
        .residueId,
      receptorChainIds: p.snapshot.chains
        .filter((c) => c.type === "polymer")
        .map((c) => c.id),
      parameters: { ...DEFAULT_PARAMETERS },
    },
    [],
  );
}
describe("interpretation snapshots", () => {
  it("summarizes polymer contacts using explicit denominators and separates computed/database evidence", async () => {
    const p = await caseData(),
      request = {
        ligandResidueId: p.snapshot.ligands.find(
          (l) => l.componentId === "BEN",
        )!.residueId,
        receptorChainIds: p.snapshot.chains
          .filter((c) => c.type === "polymer")
          .map((c) => c.id),
        parameters: { ...DEFAULT_PARAMETERS },
      },
      run = await analyze(
        p.structure,
        p.snapshot,
        p.selectionIndex,
        request,
        [],
      );
    const summary = summarizeBindingSite(p.interpretation, run, "BEN");
    expect(summary.contactCount).toBe(run.residues.length);
    expect(summary.mappedCount).toBe(summary.contactCount);
    expect(summary.unmappedCount).toBe(0);
    expect(
      summary.overlaps.some(
        (o) =>
          o.type === "Binding site" &&
          o.residueIds.some(
            (id) =>
              p.snapshot.residues.find((r) => r.id === id)!.authSeqId === "189",
          ),
      ),
    ).toBe(true);
    // Specific active/binding-site overlap is smaller than whole-domain coverage.
    const functional = new Set(
      summary.overlaps
        .filter((o) => ["Active site", "Binding site"].includes(o.type))
        .flatMap((o) => o.residueIds),
    );
    expect(functional.size).toBeGreaterThan(0);
    expect(functional.size).toBeLessThan(summary.contactCount);
    const exportData = JSON.parse(
      interpretationJson(p.interpretation, p.snapshot, p.source, run),
    );
    expect(exportData.analysis).toEqual(JSON.parse(JSON.stringify(run)));
    expect(
      exportData.evidence.some(
        (e: { kind: string }) => e.kind === "computed_geometry",
      ),
    ).toBe(true);
    expect(
      exportData.evidence.some(
        (e: { kind: string }) => e.kind === "database_annotation",
      ),
    ).toBe(true);
    const before = JSON.stringify(p.interpretation);
    summarizeBindingSite(p.interpretation, run, "BEN");
    expect(JSON.stringify(p.interpretation)).toBe(before);
    expect(() =>
      summarizeBindingSite(
        { ...p.interpretation, snapshotId: "wrong" },
        run,
        "BEN",
      ),
    ).toThrow("different");
  });
  it("headlines site-level features against a chain background and keeps whole-chain domains as context", async () => {
    const p = await caseData(),
      run = await benRun(p);
    const summary = summarizeBindingSite(p.interpretation, run, "BEN");
    const domain = summary.overlaps.find((o) => o.type === "Domain")!;
    // The Peptidase S1 domain (P00760 24–244) covers every mapped contact residue.
    expect(domain.category).toBe("context");
    expect(domain.residueIds).toHaveLength(summary.mappedCount);
    expect(summary.siteAnnotatedCount).toBeGreaterThan(0);
    expect(summary.siteAnnotatedCount).toBeLessThan(summary.mappedCount);
    expect(
      summary.overlaps.filter((o) => o.category === "site").map((o) => o.type),
    ).toEqual(expect.arrayContaining(["Active site", "Binding site"]));
    // Independent background count: every exactly mapped observed chain A residue.
    const exact = new Set(
      p.interpretation.mappings
        .filter((m) => m.status === "exact" && m.residueId)
        .map((m) => m.residueId),
    );
    expect(summary.siteBackground.total).toBe(exact.size);
    const siteResidues = new Set(
      p.interpretation.projections
        .filter((pr) =>
          ["Active site", "Binding site", "Site"].includes(
            p.interpretation.annotations.find((a) => a.id === pr.annotationId)!
              .type,
          ),
        )
        .flatMap((pr) => pr.residueIds),
    );
    expect(summary.siteBackground.annotated).toBe(siteResidues.size);
    expect(summary.siteBackground.annotated).toBeLessThan(
      summary.siteBackground.total,
    );
    // The domain spans UniProt 24–244; the chain maps 24–246, so two residues lie outside it.
    expect(domain.background).toEqual({
      annotated: summary.siteBackground.total - 2,
      total: summary.siteBackground.total,
    });
  });
  it("relates annotation ligands to the analyzed component by ChEBI identifier only", async () => {
    const p = await caseData(),
      run = await benRun(p);
    expect(p.interpretation.ligands![0]).toMatchObject({
      componentId: "BEN",
      chebiIds: ["CHEBI:41033"],
    });
    const summary = summarizeBindingSite(p.interpretation, run, "BEN");
    const substrate = summary.ligandSites.find((s) =>
      s.residueIds.some(
        (id) =>
          p.snapshot.residues.find((r) => r.id === id)!.authSeqId === "189",
      ),
    )!;
    expect(substrate).toMatchObject({
      ligandName: "substrate",
      relation: "unresolved",
    });
    expect(ligandRelation("ChEBI:CHEBI:29108", ["CHEBI:41033"]).relation).toBe(
      "different",
    );
    expect(ligandRelation("CHEBI:41033", ["CHEBI:41033"]).relation).toBe(
      "same",
    );
    expect(ligandRelation("ChEBI:CHEBI:29108", []).relation).toBe("unresolved");
    expect(ligandRelation(undefined, ["CHEBI:41033"]).relation).toBe(
      "unresolved",
    );
    // Synthetic in-memory change: give the substrate site the analyzed ligand's ChEBI ID.
    const annotations = p.interpretation.annotations.map((a) =>
      a.id === substrate.annotationId
        ? {
            ...a,
            ligand: { name: "benzamidine", identifier: "ChEBI:CHEBI:41033" },
          }
        : a,
    );
    const same = summarizeBindingSite(
      { ...p.interpretation, annotations },
      run,
      "BEN",
    ).ligandSites.find((s) => s.annotationId === substrate.annotationId)!;
    expect(same.relation).toBe("same");
    // A biology-1.0.0 snapshot has no ligand identities; relations stay unresolved.
    const legacy = summarizeBindingSite(
      { ...p.interpretation, ligands: undefined },
      run,
      "BEN",
    );
    expect(legacy.analyzedLigand.chebiIds).toEqual([]);
    const csv = annotationCsv(p.interpretation, p.snapshot).split("\r\n");
    expect(csv[0]).toContain(
      '"feature_category","feature_ligand","feature_ligand_id"',
    );
    expect(
      csv.some(
        (row) =>
          row.includes('"Binding site"') &&
          row.includes('"site","Ca(2+)","ChEBI:CHEBI:29108","match",""'),
      ),
    ).toBe(true);
    expect(
      csv.some((row) => row.includes('"Domain"') && row.includes('"context"')),
    ).toBe(true);
    expect(
      JSON.parse(
        interpretationJson(p.interpretation, p.snapshot, p.source, run),
      ).bindingSiteSummary.siteBackground,
    ).toEqual({ annotated: 11, total: 223 });
    expect(legacy.ligandSites.every((s) => s.relation === "unresolved")).toBe(
      true,
    );
  });
  it("exports stable scientific fields, numbering, evidence and uncertainty without a computation run", async () => {
    const p = await caseData(),
      one = interpretationJson(p.interpretation, p.snapshot, p.source, null);
    expect(
      interpretationJson(
        JSON.parse(JSON.stringify(p.interpretation)),
        p.snapshot,
        p.source,
        null,
      ),
    ).toBe(one);
    const csv = annotationCsv(p.interpretation, p.snapshot);
    expect(csv).toContain("mapping_status");
    expect(csv).toContain("start_modifier");
    expect(csv).toContain('"171","189","","');
    expect(csv).toContain('"P00760","194","exact","Binding site"');
    expect(() =>
      interpretationJson(
        { ...p.interpretation, snapshotId: "wrong" },
        p.snapshot,
        p.source,
        null,
      ),
    ).toThrow("does not match");
  });
  it("retains unmapped positions and supports nonoverlapping chimeric segments without choosing one accession", async () => {
    const p = await caseData(),
      row = p.sifts.rows.find((r) => r.pdbePosition === 171)!;
    const absent = mapResidues(
      p.snapshot,
      p.discovery,
      p.sifts.rows.filter((r) => r !== row),
      p.proteins,
      [],
    );
    expect(absent.coverage[0].unmapped).toBe(1);
    const unmappedCsv = annotationCsv(
      {
        ...p.interpretation,
        mappings: absent.mappings,
        coverage: absent.coverage,
      },
      p.snapshot,
    );
    expect(
      unmappedCsv
        .split("\r\n")
        .some(
          (line) => line.includes('"171","189"') && line.includes('"unmapped"'),
        ),
    ).toBe(true);
    const second = {
        ...p.proteins[0],
        id: "second-protein",
        accession: "P00761",
      },
      segments = [
        { ...p.discovery[0], end: 100, uniprotEnd: 123 },
        {
          ...p.discovery[0],
          accession: second.accession,
          start: 101,
          uniprotStart: 124,
        },
      ],
      rows = p.sifts.rows.map((r) =>
        r.pdbePosition > 100 ? { ...r, accession: second.accession } : r,
      ),
      chimera = mapResidues(
        p.snapshot,
        segments,
        rows,
        [p.proteins[0], second],
        [],
      );
    expect(chimera.coverage[0].accessions).toHaveLength(2);
    expect(
      chimera.mappings.filter((m) => m.labelSeqId === 171)[0],
    ).toMatchObject({ accession: "P00761", status: "exact" });
  });
  it("validates modified-residue parents rather than treating unknown residue codes as sequence agreement", async () => {
    const p = await caseData(),
      position = p.snapshot.chains[0].sequence.find(
        (s) => s.componentId === "MET",
      )!;
    position.componentId = "MSE";
    const changed = p.sifts.rows.map((r) =>
      r.pdbePosition === position.labelSeqId ? { ...r, componentId: "MSE" } : r,
    );
    expect(
      mapResidues(
        p.snapshot,
        p.discovery,
        changed,
        p.proteins,
        [],
      ).mappings.find((m) => m.labelSeqId === position.labelSeqId)!.status,
    ).toBe("sequence_mismatch");
    p.snapshot.componentParentIds = { MSE: "MET" };
    expect(
      mapResidues(
        p.snapshot,
        p.discovery,
        changed,
        p.proteins,
        [],
      ).mappings.find((m) => m.labelSeqId === position.labelSeqId)!.status,
    ).toBe("exact");
  });
});
describe("coordinate uncertainty export", () => {
  it("lists interactions within one distance uncertainty of their cutoff and leaves the run unchanged", async () => {
    const p = await caseData(),
      run = await benRun(p);
    const before = JSON.stringify(run);
    // Synthetic in-memory quality: a 0.2 Å coordinate error (3PTB deposits no R-free).
    const snapshot = {
      ...p.snapshot,
      quality: {
        refinedAtomCount: 1,
        coordinateErrorAngstrom: 0.2,
        coordinateErrorSource: "computed_dpi_free" as const,
      },
    };
    const exported = JSON.parse(
      interpretationJson(p.interpretation, snapshot, p.source, run),
    );
    const sigma = Math.SQRT2 * 0.2;
    expect(
      exported.coordinateUncertainty.distanceUncertaintyAngstrom,
    ).toBeCloseTo(sigma, 12);
    const ids: string[] =
      exported.coordinateUncertainty.borderlineInteractionIds;
    expect(ids.length).toBeGreaterThan(0);
    const margins = new Map(
      run.interactions.map((i) => [
        i.id,
        cutoffMargin(i, run.request.parameters),
      ]),
    );
    for (const id of ids) expect(margins.get(id)!).toBeLessThan(sigma);
    expect(
      run.interactions
        .filter((i) => !ids.includes(i.id))
        .every((i) => (margins.get(i.id) ?? Infinity) >= sigma),
    ).toBe(true);
    expect(JSON.stringify(run)).toBe(before);
    const none = JSON.parse(
      interpretationJson(p.interpretation, p.snapshot, p.source, run),
    );
    expect(none.coordinateUncertainty).toMatchObject({
      coordinateErrorAngstrom: null,
      borderlineInteractionIds: [],
    });
  });
});
