import { carrierSchema } from "./biologySchemas";
import type { CarrierLookup, ResourceSnapshot } from "../domain/biology";

/**
 * Normalize an RCSB sequence-coordinates alignment response. The aligned UniProt sequence must
 * equal the pinned UniProt record; otherwise the lookup is refused as a source conflict.
 * Entities whose regions disagree with their sequences are listed and never used.
 */
export function parseCarriers(
  value: unknown,
  accession: string,
  uniprotSequence: string,
  resource: Omit<ResourceSnapshot, "bytes">,
): CarrierLookup {
  if (
    value &&
    typeof value === "object" &&
    "errors" in value &&
    Array.isArray(value.errors) &&
    value.errors.length
  )
    throw Error("The sequence-coordinates service returned an error.");
  const { query_sequence, target_alignments } =
    carrierSchema.parse(value).data.alignments;
  if (query_sequence !== uniprotSequence)
    throw Error(
      `Source conflict: the aligned ${accession} sequence differs from the pinned UniProt record.`,
    );
  const entities: CarrierLookup["entities"] = [],
    invalidEntityIds: string[] = [],
    computedModelIds: string[] = [];
  for (const target of target_alignments ?? []) {
    // RCSB also aligns computed structure models (AlphaFold "AF_", ModelArchive "MA_").
    if (/^(AF|MA)_/.test(target.target_id)) {
      computedModelIds.push(target.target_id);
      continue;
    }
    const sequence = target.target_sequence ?? "";
    const regions = target.aligned_regions.map((r) => ({
      queryBegin: r.query_begin,
      queryEnd: r.query_end,
      targetBegin: r.target_begin,
      targetEnd: r.target_end,
    }));
    // Four-character PDB entries only, as for every other biology request.
    const valid =
      /^[0-9][A-Z0-9]{3}_\d+$/.test(target.target_id) &&
      /^[A-Z]+$/.test(sequence) &&
      regions.length > 0 &&
      regions.every(
        (r) =>
          r.queryEnd - r.queryBegin === r.targetEnd - r.targetBegin &&
          r.queryBegin <= r.queryEnd &&
          r.queryEnd <= query_sequence.length &&
          r.targetEnd <= sequence.length,
      );
    if (!valid) {
      invalidEntityIds.push(target.target_id);
      continue;
    }
    entities.push({
      entityId: target.target_id,
      entryId: target.target_id.split("_")[0],
      sequence,
      regions,
    });
  }
  return {
    accession,
    resourceRef: resource,
    entities,
    invalidEntityIds,
    computedModelIds,
  };
}
