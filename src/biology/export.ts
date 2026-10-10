import {
  featureCategory,
  type InterpretationSnapshot,
  type FunctionalAnnotation,
  type ResidueMapping,
} from "../domain/biology";
import type { AnalysisRun } from "../domain/analysis";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import { analysisEvidence } from "./evidence";
import { distanceUncertainty, isBorderline } from "../analysis/uncertainty";
import { analyzedComponent, summarizeBindingSite } from "./projection";
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
    quality: snapshot.quality,
  };
  const sigma = distanceUncertainty(snapshot.quality);
  return JSON.stringify(
    {
      // Schema 2 (biology-1.1.0): site/context overlaps, chain background and ligand relations.
      schemaVersion: 2,
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
      // Display/export metadata derived from an unchanged analysis run; nothing is reclassified.
      coordinateUncertainty: {
        coordinateErrorAngstrom:
          snapshot.quality?.coordinateErrorAngstrom ?? null,
        source: snapshot.quality?.coordinateErrorSource ?? null,
        distanceUncertaintyAngstrom: sigma ?? null,
        borderlineInteractionIds: run
          ? run.interactions
              .filter((i) => isBorderline(i, run.request.parameters, sigma))
              .map((i) => i.id)
          : [],
      },
      bindingSiteSummary: run
        ? summarizeBindingSite(
            interpretation,
            run,
            analyzedComponent(snapshot, run),
          )
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
      "feature_category",
      "feature_ligand",
      "feature_ligand_id",
      "residue_identity",
      "residue_change",
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
          feature
            ? (featureCategory(feature.type) ?? "processing_or_other")
            : "",
          feature?.ligand?.name,
          feature?.ligand?.identifier,
          mapping?.identity,
          mapping?.residueChange
            ? `${mapping.residueChange.uniprot}${mapping.uniprotPosition}${mapping.residueChange.deposited}`
            : "",
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
