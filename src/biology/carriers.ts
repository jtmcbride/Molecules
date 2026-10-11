import type {
  CarrierLookup,
  FunctionalAnnotation,
  VariantCarriers,
} from "../domain/biology";

/** Deposited entity residue aligned to a UniProt position, or undefined when not aligned. */
export function alignedResidue(
  entity: CarrierLookup["entities"][number],
  uniprotPosition: number,
) {
  const region = entity.regions.find(
    (r) => uniprotPosition >= r.queryBegin && uniprotPosition <= r.queryEnd,
  );
  return region
    ? entity.sequence[
        region.targetBegin + uniprotPosition - region.queryBegin - 1
      ]
    : undefined;
}

/**
 * Entries whose deposited entity sequence has the variant's stated replacement at every
 * position of the feature. Only same-length replacements of exact bounds are compared.
 */
export function variantCarriers(
  annotation: FunctionalAnnotation,
  lookup: CarrierLookup,
): VariantCarriers[] {
  const substitution = annotation.substitution;
  if (!substitution) return [];
  const start = annotation.start.position,
    end = annotation.end.position;
  return substitution.alternatives.map((replacement) => {
    const base = { annotationId: annotation.id, replacement };
    if (
      start === undefined ||
      end === undefined ||
      annotation.start.modifier !== "exact" ||
      annotation.end.modifier !== "exact"
    )
      return {
        ...base,
        status: "not_evaluated",
        reason: "The feature bounds are uncertain.",
      };
    if (replacement.length !== end - start + 1)
      return {
        ...base,
        status: "not_evaluated",
        reason:
          "Insertions and deletions are not looked up; aligned sequences are compared position by position.",
      };
    const entries = new Map<string, string[]>();
    let otherResidue = 0,
      notCovered = 0;
    for (const entity of lookup.entities) {
      const residues: (string | undefined)[] = [];
      for (let u = start; u <= end; u++)
        residues.push(alignedResidue(entity, u));
      if (residues.some((r) => r === undefined)) notCovered++;
      else if (residues.join("") === replacement)
        entries.set(entity.entryId, [
          ...(entries.get(entity.entryId) ?? []),
          entity.entityId,
        ]);
      else otherResidue++;
    }
    return {
      ...base,
      status: "evaluated",
      carriers: [...entries]
        .map(([entryId, entityIds]) => ({ entryId, entityIds }))
        .sort((a, b) => a.entryId.localeCompare(b.entryId)),
      otherResidue,
      notCovered,
      total: lookup.entities.length,
    };
  });
}
