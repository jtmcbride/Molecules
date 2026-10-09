import { describe, expect, it } from "vitest";
import { biologyFixture } from "./helpers/biology";
import {
  BIOLOGY_VERSION,
  type InterpretationSnapshot,
} from "../src/domain/biology";
import { analyze } from "../src/analysis/engine";
import { DEFAULT_PARAMETERS } from "../src/domain/analysis";
import {
  summarizeBindingSite,
  projectAnnotations,
} from "../src/biology/projection";
import { annotationCsv, interpretationJson } from "../src/biology/export";
import { mapResidues } from "../src/biology/mapping";
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
  };
  return { ...p, interpretation };
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
    const summary = summarizeBindingSite(p.interpretation, run);
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
    summarizeBindingSite(p.interpretation, run);
    expect(JSON.stringify(p.interpretation)).toBe(before);
    expect(() =>
      summarizeBindingSite({ ...p.interpretation, snapshotId: "wrong" }, run),
    ).toThrow("different");
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
