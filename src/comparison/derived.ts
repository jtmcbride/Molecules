import type { AnalysisRun } from "../domain/analysis";
import type { InterpretationSnapshot } from "../domain/biology";
import type { Correspondence, FingerprintMatrix } from "../domain/comparison";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import type { ComparisonSlot } from "../state/comparison";
import { correspondence } from "./correspondence";
import { buildFingerprint } from "./fingerprint";

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

/**
 * Fingerprint matrix of the reference and every loaded comparison structure, or a reason
 * why there is none yet.
 */
export function comparisonFingerprint(
  reference: Reference & {
    analysis: AnalysisRun | null;
    source: StructureSource | null;
  },
  slots: ComparisonSlot[],
): { matrix: FingerprintMatrix } | { reason: string } {
  if (!reference.snapshot || !reference.source)
    return { reason: "Load a reference structure." };
  if (
    !reference.analysis ||
    reference.analysis.snapshotId !== reference.snapshot.id
  )
    return {
      reason:
        "Run the reference analysis to compare interactions. Comparison analyses use its settings.",
    };
  if (!reference.interpretation)
    return {
      reason:
        "Load the reference's protein annotations: fingerprints are keyed by UniProt position.",
    };
  const ready = slots.filter((s) => s.phase === "ready" && s.snapshot);
  if (!ready.length) return { reason: "Add a comparison structure." };
  return {
    matrix: buildFingerprint(
      {
        label:
          reference.source.kind === "local"
            ? reference.source.name
            : reference.source.id,
        snapshot: reference.snapshot,
        run: reference.analysis,
        mappings: reference.interpretation.mappings,
      },
      ready.map((slot) => ({
        id: slot.id,
        label: slot.label,
        snapshot: slot.snapshot!,
        run:
          slot.analysis && slot.analysis.snapshotId === slot.snapshot!.id
            ? slot.analysis
            : null,
        correspondence: slotCorrespondence(reference, slot),
      })),
    ),
  };
}
