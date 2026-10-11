import {
  featureCategory,
  type FunctionalAnnotation,
  type ProteinRecord,
  type ResidueMapping,
} from "../domain/biology";

/**
 * What a deposited chain instance has at a curated variant's positions (biology-1.2.0):
 * - `carries`: the deposited residues equal one of the stated replacements;
 * - `original`: they equal the stated original residues;
 * - `other`: they equal neither;
 * - `not_evaluated`: the comparison cannot be made, with the reason.
 * Only exact mappings of observed residues are read. The SIFTS residue identity is reported
 * unchanged: a structure can carry a natural variant through an engineered mutation (1OPH).
 */
export type VariantResidueState =
  | {
      annotationId: string;
      chainInstanceId: string;
      state: "carries" | "original" | "other";
      deposited: string;
      residueIds: string[];
      identities: NonNullable<ResidueMapping["identity"]>[];
    }
  | {
      annotationId: string;
      chainInstanceId: string;
      state: "not_evaluated";
      reason: string;
    };

export function isVariantAnnotation(annotation: FunctionalAnnotation) {
  return featureCategory(annotation.type) === "variant";
}

export function variantResidueStates(
  annotations: FunctionalAnnotation[],
  mappings: ResidueMapping[],
  proteins: ProteinRecord[],
): VariantResidueState[] {
  const output: VariantResidueState[] = [];
  const sequences = new Map(proteins.map((p) => [p.id, p.sequence]));
  for (const annotation of annotations) {
    const start = annotation.start.position,
      end = annotation.end.position;
    if (
      !isVariantAnnotation(annotation) ||
      !annotation.valid ||
      start === undefined ||
      end === undefined
    )
      continue;
    const rows = mappings.filter(
      (m) =>
        m.proteinId === annotation.proteinId &&
        m.uniprotPosition >= start &&
        m.uniprotPosition <= end,
    );
    for (const chainInstanceId of new Set(rows.map((m) => m.chainInstanceId))) {
      const base = { annotationId: annotation.id, chainInstanceId };
      const notEvaluated = (reason: string) =>
        output.push({ ...base, state: "not_evaluated", reason });
      const substitution = annotation.substitution;
      if (
        annotation.start.modifier !== "exact" ||
        annotation.end.modifier !== "exact"
      ) {
        notEvaluated("The feature bounds are uncertain.");
        continue;
      }
      if (!substitution) {
        notEvaluated("The source states no residue replacement.");
        continue;
      }
      const residues: string[] = [],
        residueIds: string[] = [],
        identities: NonNullable<ResidueMapping["identity"]>[] = [];
      let reason: string | undefined;
      for (let position = start; position <= end && !reason; position++) {
        const here = rows.filter(
          (m) =>
            m.chainInstanceId === chainInstanceId &&
            m.uniprotPosition === position,
        );
        const exact = here.filter((m) => m.status === "exact" && m.residueId);
        if (!here.length)
          reason = `UniProt position ${position} is outside the deposited sequence.`;
        else if (here.every((m) => m.status === "exact" && !m.residueId))
          reason = `UniProt position ${position} is not observed in the coordinates.`;
        else if (exact.length !== 1)
          reason = `UniProt position ${position} has no exact correspondence (${here.map((m) => m.status.replaceAll("_", " ")).join(", ")}).`;
        else {
          const mapping = exact[0];
          const deposited = !mapping.identity
            ? undefined
            : mapping.identity === "match"
              ? sequences.get(mapping.proteinId)?.[position - 1]
              : mapping.residueChange?.deposited;
          if (!mapping.identity)
            reason =
              "The interpretation predates recorded residue identities (biology-1.0.0).";
          else if (!deposited || deposited === "?")
            reason = `The deposited residue at UniProt position ${position} is not a standard amino acid.`;
          else {
            residues.push(deposited);
            residueIds.push(mapping.residueId!);
            identities.push(mapping.identity);
          }
        }
      }
      if (reason) {
        notEvaluated(reason);
        continue;
      }
      const deposited = residues.join("");
      output.push({
        ...base,
        state: substitution.alternatives.includes(deposited)
          ? "carries"
          : deposited === substitution.original
            ? "original"
            : "other",
        deposited,
        residueIds,
        identities,
      });
    }
  }
  return output;
}
