import type {
  InterpretationSnapshot,
  FunctionalAnnotation,
  ResidueMapping,
} from "../domain/biology";
import type { AnalysisRun } from "../domain/analysis";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import { analysisEvidence } from "./evidence";
import { summarizeBindingSite } from "./projection";
export function interpretationJson(
  interpretation: InterpretationSnapshot,
  snapshot: StructureSnapshot,
  source: StructureSource,
  run: AnalysisRun | null,
) {
  if (interpretation.snapshotId !== snapshot.id)
    throw Error("Interpretation does not match the displayed structure.");
  if (run && run.snapshotId !== snapshot.id)
    throw Error("Analysis does not match the displayed structure.");
  const structure = {
    id: snapshot.id,
    chains: snapshot.chains,
    residues: snapshot.residues,
    atoms: snapshot.atoms,
    componentParentIds: snapshot.componentParentIds,
    positionsAngstrom: Array.from(snapshot.atomBuffer.positions),
    occupancies: Array.from(snapshot.atomBuffer.occupancies),
    preferredAtomIndices: Array.from(snapshot.atomBuffer.preferredAtomIndices),
    provenance: snapshot.provenance,
  };
  return JSON.stringify(
    {
      schemaVersion: 1,
      kind: "molecular-interpretation",
      interpretation,
      analysis: run,
      structure,
      source: {
        id: source.id,
        url: source.url,
        contentHash: source.contentHash,
        fetchedAt: source.fetchedAt,
      },
      evidence: run
        ? [...interpretation.evidence, analysisEvidence(run)]
        : interpretation.evidence,
      bindingSiteSummary: run
        ? summarizeBindingSite(interpretation, run)
        : null,
    },
    null,
    2,
  );
}
const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
export function annotationCsv(
  interpretation: InterpretationSnapshot,
  snapshot: StructureSnapshot,
) {
  const rows: unknown[][] = [
    [
      "structure_sha256",
      "interpretation_id",
      "chain_instance_id",
      "author_chain",
      "operator",
      "label_seq_id",
      "author_seq_id",
      "insertion_code",
      "residue_id",
      "accession",
      "uniprot_position",
      "mapping_status",
      "annotation_type",
      "description",
      "feature_start",
      "start_modifier",
      "feature_end",
      "end_modifier",
      "feature_valid",
      "evidence_ids",
      "source_hashes",
    ],
  ];
  if (interpretation.snapshotId !== snapshot.id)
    throw Error("Interpretation does not match the displayed structure.");
  const sourceHashes = interpretation.resourceRefs
    .map((r) => r.contentHash)
    .join(";");
  const byPosition = new Map<string, ResidueMapping[]>();
  for (const mapping of interpretation.mappings) {
    const key = JSON.stringify([mapping.chainInstanceId, mapping.labelSeqId]);
    const group = byPosition.get(key) ?? [];
    group.push(mapping);
    byPosition.set(key, group);
  }
  const residues = new Map(snapshot.residues.map((r) => [r.id, r]));
  for (const chain of snapshot.chains.filter((c) => c.type === "polymer")) {
    for (const position of chain.sequence) {
      const mapped =
        byPosition.get(JSON.stringify([chain.id, position.labelSeqId])) ?? [];
      const append = (
        mapping?: ResidueMapping,
        feature?: FunctionalAnnotation,
        residueId?: string,
      ) => {
        const residue = residueId ? residues.get(residueId) : undefined;
        rows.push([
          interpretation.sourceHash,
          interpretation.id,
          chain.id,
          chain.authAsymId,
          chain.operatorId,
          position.labelSeqId,
          mapping?.authSeqId ?? residue?.authSeqId,
          mapping?.insertionCode ?? residue?.insertionCode,
          mapping?.residueId ?? residueId,
          mapping?.accession,
          mapping?.uniprotPosition,
          mapping?.status ?? "unmapped",
          feature?.type,
          feature?.description,
          feature?.start.position,
          feature?.start.modifier,
          feature?.end.position,
          feature?.end.modifier,
          feature?.valid,
          [
            ...(mapping?.evidenceIds ?? []),
            ...(feature?.evidenceIds ?? []),
          ].join(";"),
          sourceHashes,
        ]);
      };
      if (!mapped.length) {
        for (const id of position.residueIds.length
          ? position.residueIds
          : [undefined])
          append(undefined, undefined, id);
        continue;
      }
      for (const mapping of mapped) {
        const features = interpretation.annotations.filter(
          (a) =>
            a.proteinId === mapping.proteinId &&
            a.start.position !== undefined &&
            a.end.position !== undefined &&
            mapping.uniprotPosition >= a.start.position &&
            mapping.uniprotPosition <= a.end.position,
        );
        for (const feature of features.length ? features : [undefined])
          append(mapping, feature);
      }
    }
  }
  return rows.map((row) => row.map(csv).join(",")).join("\r\n");
}
export function downloadInterpretation(
  interpretation: InterpretationSnapshot,
  snapshot: StructureSnapshot,
  source: StructureSource,
  run: AnalysisRun | null,
  format: "json" | "csv",
) {
  const blob = new Blob(
      [
        format === "json"
          ? interpretationJson(interpretation, snapshot, source, run)
          : annotationCsv(interpretation, snapshot),
      ],
      {
        type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
      },
    ),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `${interpretation.entryId}-${format === "json" ? "interpretation.json" : "residue-annotations.csv"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
