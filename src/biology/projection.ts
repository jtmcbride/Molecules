import {
  featureCategory,
  type AnnotationProjection,
  type BindingSiteSummary,
  type FeatureCategory,
  type FunctionalAnnotation,
  type InterpretationSnapshot,
  type LigandRelation,
  type LigandSiteOverlap,
  type ResidueMapping,
} from "../domain/biology";
import { normalizeChebi } from "../data/chemcomp";
import type { AnalysisRun } from "../domain/analysis";
import type { StructureSnapshot } from "../domain/types";
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
/** Chemical component ID of the run's target ligand. */
export function analyzedComponent(
  snapshot: Pick<StructureSnapshot, "residues">,
  run: AnalysisRun,
): string {
  const residue = snapshot.residues.find(
    (r) => r.id === run.request.ligandResidueId,
  );
  if (!residue) throw Error("The analyzed ligand is not in this structure.");
  return residue.componentId;
}

/** Relation of an annotation ligand to the analyzed component, by ChEBI identifier only. */
export function ligandRelation(
  annotationLigandId: string | undefined,
  analyzedChebiIds: string[],
): { relation: LigandRelation; reason: string } {
  const id = normalizeChebi(annotationLigandId);
  if (!id)
    return {
      relation: "unresolved",
      reason:
        "The annotation names its ligand without a ChEBI identifier (e.g. a generic substrate).",
    };
  if (!analyzedChebiIds.length)
    return {
      relation: "unresolved",
      reason:
        "The analyzed component has no ChEBI cross-reference in its RCSB chemical component record.",
    };
  return analyzedChebiIds.includes(id)
    ? { relation: "same", reason: `Both identify ${id}.` }
    : {
        relation: "different",
        reason: `Annotation ligand ${id} differs from ${analyzedChebiIds.join(", ")}. Charge states and conjugate forms have separate ChEBI entries.`,
      };
}

/**
 * Functional interpretation of the polymer residues in one analysis run's binding site.
 * Site-level overlap is the headline; domains/regions are reported as context. Each overlap
 * carries the background rate over all exactly mapped observed residues in the same chain
 * instances, so the fraction can be compared rather than read as enrichment by itself.
 */
export function summarizeBindingSite(
  interpretation: InterpretationSnapshot,
  run: AnalysisRun,
  ligandComponentId: string,
): BindingSiteSummary {
  if (interpretation.snapshotId !== run.snapshotId)
    throw Error(
      "Interpretation and analysis belong to different coordinate snapshots.",
    );
  const contacts = new Set(run.residues.map((r) => r.residueId));
  const exact = interpretation.mappings.filter(
    (m) => m.residueId && m.status === "exact",
  );
  const mapped = new Set(
    exact.filter((m) => contacts.has(m.residueId!)).map((m) => m.residueId!),
  );
  const ambiguous = new Set(
    interpretation.mappings
      .filter(
        (m) => m.residueId && m.status !== "exact" && contacts.has(m.residueId),
      )
      .map((m) => m.residueId!),
  );
  // Background: chain instances that contain a mapped contact residue.
  const chains = new Set(
    exact.filter((m) => mapped.has(m.residueId!)).map((m) => m.chainInstanceId),
  );
  const backgroundResidues = new Set(
    exact.filter((m) => chains.has(m.chainInstanceId)).map((m) => m.residueId!),
  );
  const annotationById = new Map(
    interpretation.annotations.map((a) => [a.id, a]),
  );
  const groups = new Map<
    string,
    {
      category: FeatureCategory;
      contact: Set<string>;
      background: Set<string>;
      annotationIds: Set<string>;
    }
  >();
  // One entry per annotation, merging repeated chain instances of the same protein.
  const ligandSites = new Map<string, LigandSiteOverlap>();
  const analyzedChebi =
    interpretation.ligands?.find((l) => l.componentId === ligandComponentId)
      ?.chebiIds ?? [];
  for (const projection of interpretation.projections) {
    if (!chains.has(projection.chainInstanceId)) continue;
    const annotation = annotationById.get(projection.annotationId)!;
    const category = featureCategory(annotation.type);
    if (!category) continue;
    const group = groups.get(annotation.type) ?? {
      category,
      contact: new Set<string>(),
      background: new Set<string>(),
      annotationIds: new Set<string>(),
    };
    projection.residueIds.forEach((id) => group.background.add(id));
    const touched = projection.residueIds.filter((id) => mapped.has(id));
    if (touched.length) {
      touched.forEach((id) => group.contact.add(id));
      group.annotationIds.add(annotation.id);
      if (annotation.type === "Binding site") {
        const site = ligandSites.get(annotation.id) ?? {
          annotationId: annotation.id,
          ligandName: annotation.ligand?.name,
          ligandId: annotation.ligand?.identifier,
          ...ligandRelation(annotation.ligand?.identifier, analyzedChebi),
          residueIds: [],
        };
        site.residueIds.push(...touched);
        ligandSites.set(annotation.id, site);
      }
    }
    groups.set(annotation.type, group);
  }
  const union = (category: FeatureCategory, key: "contact" | "background") =>
    new Set(
      [...groups.values()]
        .filter((g) => g.category === category)
        .flatMap((g) => [...g[key]]),
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
    siteAnnotatedCount: union("site", "contact").size,
    siteBackground: {
      annotated: union("site", "background").size,
      total: backgroundResidues.size,
    },
    proximityResidueCount: run.residues.filter((r) => r.proximityPairCount > 0)
      .length,
    chemicalResidueCount: run.residues.filter(
      (r) => r.chemicalInteractionCount > 0,
    ).length,
    clashResidueCount: run.residues.filter((r) => r.clashCount > 0).length,
    overlaps: [...groups]
      .filter(([, g]) => g.contact.size)
      .map(([type, g]) => ({
        type,
        category: g.category,
        residueIds: [...g.contact],
        annotationIds: [...g.annotationIds],
        background: {
          annotated: g.background.size,
          total: backgroundResidues.size,
        },
      }))
      .sort(
        (a, b) =>
          Number(a.category === "context") - Number(b.category === "context") ||
          a.type.localeCompare(b.type),
      ),
    ligandSites: [...ligandSites.values()],
    analyzedLigand: { componentId: ligandComponentId, chebiIds: analyzedChebi },
  };
}
