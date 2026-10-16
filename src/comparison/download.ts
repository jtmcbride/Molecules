import { useExplorer } from "../state/explorer";
import { useComparison } from "../state/comparison";
import { database } from "../data/repository";
import { comparisonJson, download } from "./export";
import {
  comparisonFingerprint,
  slotCorrespondence,
  slotSiteDifferences,
} from "./derived";
import { poseContextKey } from "./poseContext";
/** Export the full workspace comparison, independent of visible fingerprint filters. */
export async function downloadWorkspaceComparison() {
  const reference = useExplorer.getState();
  if (!reference.source || !reference.snapshot) return;
  const slots = useComparison
    .getState()
    .slots.map((s) =>
      s.pose &&
      s.pose.contextKey !== poseContextKey(reference, s, s.pose.options)
        ? { ...s, pose: undefined }
        : s,
    );
  const fingerprint = comparisonFingerprint(reference, slots);
  const ids = [
    ...new Set(
      slots.flatMap((s) =>
        s.pose?.record
          ? [
              s.pose.record.input.reference.chemistryId,
              s.pose.record.input.comparison.chemistryId,
            ]
          : [],
      ),
    ),
  ];
  const definitions = await database.poseChemistry.bulkGet(ids).catch(() => []);
  const text = comparisonJson(
    {
      source: reference.source,
      snapshot: reference.snapshot,
      analysisCacheKey: reference.analysis?.cacheKey,
      interpretationId: reference.interpretation?.id,
    },
    slots,
    new Map(slots.map((s) => [s.id, slotCorrespondence(reference, s)])),
    "matrix" in fingerprint ? fingerprint.matrix : null,
    new Map(slots.map((s) => [s.id, slotSiteDifferences(reference, s)])),
    new Map(definitions.flatMap((d) => (d ? [[d.id, d] as const] : []))),
  );
  download(
    `${reference.source.id.replace(/[^a-z0-9_-]/gi, "_")}-comparison.json`,
    text,
    "application/json",
  );
}
