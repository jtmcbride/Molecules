import type { InterpretationSnapshot } from "../domain/biology";
import type { Correspondence } from "../domain/comparison";
import type { StructureSnapshot } from "../domain/types";
import type { ComparisonSlot } from "../state/comparison";
import { correspondence } from "./correspondence";

interface Reference {
  snapshot: StructureSnapshot | null;
  interpretation: InterpretationSnapshot | null;
}

const cache = new Map<string, Correspondence>();

/**
 * Correspondence between the reference and a comparison slot, or null until both have a
 * residue mapping. Memoized on the identities of every input.
 */
export function slotCorrespondence(
  reference: Reference,
  slot: Pick<
    ComparisonSlot,
    "id" | "snapshot" | "interpretation" | "pairingOverrides"
  >,
): Correspondence | null {
  if (
    !reference.snapshot ||
    !reference.interpretation ||
    reference.interpretation.snapshotId !== reference.snapshot.id ||
    !slot.snapshot ||
    !slot.interpretation ||
    slot.interpretation.snapshotId !== slot.snapshot.id
  )
    return null;
  const key = JSON.stringify([
    reference.interpretation.id,
    slot.id,
    slot.interpretation.id,
    slot.pairingOverrides,
  ]);
  let result = cache.get(key);
  if (!result) {
    if (cache.size > 64) cache.clear();
    result = correspondence(
      {
        snapshot: reference.snapshot,
        interpretation: reference.interpretation,
      },
      { snapshot: slot.snapshot, interpretation: slot.interpretation },
      slot.pairingOverrides,
    );
    cache.set(key, result);
  }
  return result;
}
