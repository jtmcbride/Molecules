import type {
  AnnotationProjection,
  BindingSiteSummary,
  FunctionalAnnotation,
  InterpretationSnapshot,
  ResidueMapping,
} from "../domain/biology";
import type { AnalysisRun } from "../domain/analysis";
export function projectAnnotations(
  annotations: FunctionalAnnotation[],
  mappings: ResidueMapping[],
): AnnotationProjection[] {
  const output: AnnotationProjection[] = [];
  for (const annotation of annotations) {
    if (
      !annotation.valid ||
      annotation.start.position === undefined ||
      annotation.end.position === undefined
    )
      continue;
    const matching = mappings.filter(
      (m) =>
        m.proteinId === annotation.proteinId &&
        m.uniprotPosition >= annotation.start.position! &&
        m.uniprotPosition <= annotation.end.position!,
    );
    for (const chainInstanceId of new Set(
      matching.map((m) => m.chainInstanceId),
    )) {
      const rows = matching.filter(
          (m) => m.chainInstanceId === chainInstanceId,
        ),
        uncertain =
          annotation.start.modifier !== "exact" ||
          annotation.end.modifier !== "exact";
      const exact = rows.filter((m) => m.status === "exact");
      output.push({
        annotationId: annotation.id,
        chainInstanceId,
        residueIds: uncertain
          ? []
          : [
              ...new Set(
                exact.flatMap((m) => (m.residueId ? [m.residueId] : [])),
              ),
            ],
        observedPositions: uncertain
          ? []
          : [
              ...new Set(
                exact.filter((m) => m.residueId).map((m) => m.uniprotPosition),
              ),
            ],
        unobservedPositions: [
          ...new Set(
            exact.filter((m) => !m.residueId).map((m) => m.uniprotPosition),
          ),
        ],
        ambiguousPositions: [
          ...new Set(
            rows
              .filter((m) => m.status !== "exact" || uncertain)
              .map((m) => m.uniprotPosition),
          ),
        ],
        uncertain,
      });
    }
  }
  return output;
}
export function summarizeBindingSite(
  interpretation: InterpretationSnapshot,
  run: AnalysisRun,
): BindingSiteSummary {
  if (interpretation.snapshotId !== run.snapshotId)
    throw Error(
      "Interpretation and analysis belong to different coordinate snapshots.",
    );
  const contacts = new Set(run.residues.map((r) => r.residueId));
  const mapped = new Set(
    interpretation.mappings
      .filter(
        (m) => m.residueId && m.status === "exact" && contacts.has(m.residueId),
      )
      .map((m) => m.residueId!),
  );
  const ambiguous = new Set(
    interpretation.mappings
      .filter(
        (m) => m.residueId && m.status !== "exact" && contacts.has(m.residueId),
      )
      .map((m) => m.residueId!),
  );
  const overlaps = new Map<
    string,
    { type: string; residueIds: Set<string>; annotationIds: Set<string> }
  >();
  for (const projection of interpretation.projections) {
    const ids = projection.residueIds.filter((id) => contacts.has(id));
    if (!ids.length) continue;
    const annotation = interpretation.annotations.find(
      (a) => a.id === projection.annotationId,
    )!;
    const group = overlaps.get(annotation.type) ?? {
      type: annotation.type,
      residueIds: new Set(),
      annotationIds: new Set(),
    };
    ids.forEach((id) => group.residueIds.add(id));
    group.annotationIds.add(annotation.id);
    overlaps.set(annotation.type, group);
  }
  const annotated = new Set(
    [...overlaps.values()].flatMap((g) => [...g.residueIds]),
  );
  return {
    analysisRunId: run.id,
    interpretationId: interpretation.id,
    contactCount: contacts.size,
    mappedCount: mapped.size,
    ambiguousCount: ambiguous.size,
    unmappedCount: [...contacts].filter(
      (id) => !mapped.has(id) && !ambiguous.has(id),
    ).length,
    annotatedCount: annotated.size,
    proximityResidueCount: run.residues.filter((r) => r.proximityPairCount > 0)
      .length,
    chemicalResidueCount: run.residues.filter(
      (r) => r.chemicalInteractionCount > 0,
    ).length,
    clashResidueCount: run.residues.filter((r) => r.clashCount > 0).length,
    overlaps: [...overlaps.values()].map((g) => ({
      type: g.type,
      residueIds: [...g.residueIds],
      annotationIds: [...g.annotationIds],
    })),
  };
}
