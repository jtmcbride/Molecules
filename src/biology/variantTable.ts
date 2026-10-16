import type { AnalysisRun } from "../domain/analysis";
import type {
  FeatureBoundary,
  FunctionalAnnotation,
  InterpretationSnapshot,
} from "../domain/biology";
import {
  interpretationVariantStates,
  isVariantAnnotation,
  variantLabel,
  type VariantResidueState,
} from "./variants";

export type VariantContact = "proximity" | "chemical" | "clash";
export interface VariantChainRow {
  chainInstanceId: string;
  residueIds: string[];
  observedPositions: number[];
  unobservedPositions: number[];
  ambiguousPositions: number[];
  /** Positions absent from the deposited mapping; null for invalid/uncertain bounds. */
  outsideCount: number | null;
  state: VariantResidueState;
  contacts: VariantContact[];
}
export interface VariantTableRow {
  annotation: FunctionalAnnotation;
  chains: VariantChainRow[];
  searchText: string;
}
export interface VariantTableModel {
  rows: VariantTableRow[];
  contactsAvailable: boolean;
}
export interface VariantFilters {
  type: string;
  text: string;
  observed: "all" | "observed" | "unobserved";
  contact: "all" | VariantContact;
}

const boundary = (b: FeatureBoundary) =>
  b.position === undefined
    ? "?"
    : `${b.modifier === "less_than" ? "<" : b.modifier === "greater_than" ? ">" : b.modifier === "unknown" ? "?" : ""}${b.position}`;
/** Preserve source uncertainty; variantLabel alone is deliberately compact. */
export function variantBounds(a: FunctionalAnnotation) {
  const start = boundary(a.start),
    end = boundary(a.end);
  return start === end ? start : `${start}–${end}`;
}

/** One source feature per protein, independent of assembly copies and visible categories.
 * Scientific states and coordinate projection come from the existing interpretation policies.
 * Contacts mean receptor membership in this interpretation's current analysis only.
 */
export function variantTable(
  interpretation: InterpretationSnapshot,
  proteinId: string,
  analysis: AnalysisRun | null = null,
): VariantTableModel {
  const protein = interpretation.proteins.find((p) => p.id === proteinId);
  const annotations = [
    ...new Map(
      interpretation.annotations
        .filter((a) => a.proteinId === proteinId && isVariantAnnotation(a))
        .map((a) => [a.id, a]),
    ).values(),
  ];
  const mappings = interpretation.mappings.filter(
    (m) => m.proteinId === proteinId,
  );
  const chainIds = [
    ...new Set([
      ...interpretation.coverage
        .filter((c) => protein && c.accessions.includes(protein.accession))
        .map((c) => c.chainInstanceId),
      ...mappings.map((m) => m.chainInstanceId),
    ]),
  ];
  const states = new Map(
    interpretationVariantStates({ ...interpretation, annotations }).map((s) => [
      JSON.stringify([s.annotationId, s.chainInstanceId]),
      s,
    ]),
  );
  const projections = new Map(
    interpretation.projections.map((p) => [
      JSON.stringify([p.annotationId, p.chainInstanceId]),
      p,
    ]),
  );
  const contactsAvailable =
    !!analysis && analysis.snapshotId === interpretation.snapshotId;
  const contacts = new Map<string, Set<VariantContact>>();
  if (contactsAvailable)
    for (const i of analysis!.interactions) {
      const kinds =
        contacts.get(i.receptor.residueId) ?? new Set<VariantContact>();
      kinds.add(
        i.type === "proximity_contact"
          ? "proximity"
          : i.type === "steric_clash"
            ? "clash"
            : "chemical",
      );
      contacts.set(i.receptor.residueId, kinds);
    }
  const rows = annotations
    .map((annotation): VariantTableRow => {
      const a = annotation;
      const exact =
        a.valid &&
        a.start.modifier === "exact" &&
        a.end.modifier === "exact" &&
        a.start.position !== undefined &&
        a.end.position !== undefined;
      const chains = chainIds.map((chainInstanceId): VariantChainRow => {
        const key = JSON.stringify([a.id, chainInstanceId]);
        const p = projections.get(key);
        const residueIds = exact ? (p?.residueIds ?? []) : [];
        const mappedPositions = new Set(
          mappings
            .filter(
              (m) =>
                m.chainInstanceId === chainInstanceId &&
                m.uniprotPosition >= a.start.position! &&
                m.uniprotPosition <= a.end.position!,
            )
            .map((m) => m.uniprotPosition),
        );
        const outsideCount = exact
          ? a.end.position! - a.start.position! + 1 - mappedPositions.size
          : null;
        const reason = !a.valid
          ? "Invalid source feature bounds."
          : !exact
            ? "The feature bounds are uncertain."
            : "The feature is outside the deposited sequence mapped to this protein.";
        return {
          chainInstanceId,
          residueIds,
          observedPositions: exact ? (p?.observedPositions ?? []) : [],
          unobservedPositions: p?.unobservedPositions ?? [],
          ambiguousPositions: p?.ambiguousPositions ?? [],
          outsideCount,
          state: states.get(key) ?? {
            annotationId: a.id,
            chainInstanceId,
            state: "not_evaluated",
            reason,
          },
          contacts: [
            ...new Set(
              residueIds.flatMap((id) => [...(contacts.get(id) ?? [])]),
            ),
          ],
        };
      });
      return {
        annotation,
        chains,
        searchText: [
          variantLabel(a),
          variantBounds(a),
          a.type,
          a.description,
          a.sourceFeatureId,
          a.id,
          ...(a.crossReferences ?? []).map((x) => `${x.database}:${x.id}`),
        ]
          .join(" ")
          .toLowerCase(),
      };
    })
    .sort(
      (a, b) =>
        (a.annotation.start.position ?? Infinity) -
          (b.annotation.start.position ?? Infinity) ||
        (a.annotation.id < b.annotation.id
          ? -1
          : a.annotation.id > b.annotation.id
            ? 1
            : 0),
    );
  return { rows, contactsAvailable };
}

/** Filtering never changes the interpretation, analyses, consequences or exported records. */
export function filterVariants(
  model: VariantTableModel,
  filters: VariantFilters,
) {
  const text = filters.text.trim().toLowerCase();
  return model.rows.filter(
    (row) =>
      (!filters.type || row.annotation.type === filters.type) &&
      (!text || row.searchText.includes(text)) &&
      (filters.observed === "all" ||
        row.chains.some((c) => c.residueIds.length > 0) ===
          (filters.observed === "observed")) &&
      (filters.contact === "all" ||
        !model.contactsAvailable ||
        row.chains.some((c) =>
          c.contacts.includes(filters.contact as VariantContact),
        )),
  );
}
