import { useEffect, useState } from "react";
import { cacheUsage, clearUnusedCache } from "../data/repository";
import { useExplorer } from "../state/explorer";
import { useComparison } from "../state/comparison";

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Cached coordinate storage, with removal of sources no open structure or saved session needs. */
export function CacheUsage() {
  const source = useExplorer((s) => s.source),
    slots = useComparison((s) => s.slots);
  const [usage, setUsage] = useState<Awaited<
    ReturnType<typeof cacheUsage>
  > | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () =>
    void cacheUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  useEffect(refresh, [source?.contentHash, slots.length]);
  if (!usage) return null;
  const open = [
    ...(source ? [source.contentHash] : []),
    ...slots.flatMap((s) => (s.source ? [s.source.contentHash] : [])),
  ];
  return (
    <>
      <div className="cache-usage" data-testid="cache-usage">
        <span>
          Browser cache: {usage.count} structure{usage.count === 1 ? "" : "s"} ·{" "}
          {megabytes(usage.bytes)} of {megabytes(usage.budget)}
        </span>
        <button
          className="button secondary"
          onClick={() =>
            void clearUnusedCache(open)
              .then((removed) => {
                setMessage(
                  `Removed ${removed} cached structure${removed === 1 ? "" : "s"} with their analyses and interpretations.`,
                );
                refresh();
              })
              .catch(() => setMessage("Browser storage is unavailable."))
          }
        >
          Clear unused
        </button>
      </div>
      <p className="small muted">
        Least-recently-used structures are removed beyond the budget. Open
        structures and the saved session are kept.
        {message ? ` ${message}` : ""}
      </p>
    </>
  );
}
