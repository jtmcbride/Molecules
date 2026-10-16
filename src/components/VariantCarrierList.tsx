import { useState } from "react";
import { useExplorer } from "../state/explorer";
import type { ExplorerController } from "../structure/controller";
import type { FunctionalAnnotation } from "../domain/biology";
import { variantCarriers } from "../biology/carriers";
import { variantLabel } from "../biology/variants";

/**
 * Deposited PDB entries whose entity sequence has a variant's stated replacement. Looked up on
 * request per protein (the accession is the only thing sent) and pinned with the session.
 */
export function VariantCarrierList({
  variants,
  controller,
}: {
  variants: FunctionalAnnotation[];
  controller: ExplorerController | null;
}) {
  const s = useExplorer(),
    [error, setError] = useState<string | null>(null);
  const interpretation = s.interpretation!;
  const accessions = [
    ...new Set(
      variants
        .filter((a) => a.substitution)
        .flatMap(
          (a) =>
            interpretation.proteins.find((p) => p.id === a.proteinId)
              ?.accession ?? [],
        ),
    ),
  ];
  if (!accessions.length) return null;
  const open = (entryId: string) => {
    setError(null);
    controller?.comparison
      .addPdb(entryId)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  };
  return (
    <div className="variant-carriers" data-testid="variant-carriers">
      {accessions.map((accession) => {
        const state = s.carrierLookups[accession];
        const protein = interpretation.proteins.find(
          (p) => p.accession === accession,
        )!;
        if (!state || state.phase === "error")
          return (
            <div key={accession}>
              <button
                className="biology-link"
                disabled={!controller}
                onClick={() =>
                  void controller?.biology.lookupCarriers(accession)
                }
              >
                Find deposited structures with these replacements
              </button>
              <small className="muted variant-references">
                Sends {accession} to RCSB&apos;s sequence-coordinates service.
              </small>
              {state?.phase === "error" && (
                <p className="comparison-error" role="alert">
                  {state.message}
                </p>
              )}
            </div>
          );
        if (state.phase === "loading")
          return (
            <p className="small muted" key={accession}>
              Looking up deposited {accession} sequences…{" "}
              <button
                className="biology-link"
                onClick={() => controller?.biology.cancelCarriers(accession)}
              >
                Cancel lookup
              </button>
            </p>
          );
        const { lookup, mode } = state;
        return (
          <div key={accession}>
            {variants
              .filter((a) => a.proteinId === protein.id)
              .flatMap((a) => variantCarriers(a, lookup))
              .map((c) => {
                const annotation = variants.find(
                  (a) => a.id === c.annotationId,
                )!;
                const label = variantLabel({
                  ...annotation,
                  substitution: {
                    ...annotation.substitution!,
                    alternatives: [c.replacement],
                  },
                });
                return (
                  <div
                    className="carrier-row"
                    key={`${c.annotationId}:${c.replacement}`}
                  >
                    <strong>{label}</strong>{" "}
                    {c.status === "not_evaluated" ? (
                      <span className="muted">{c.reason}</span>
                    ) : c.carriers.length ? (
                      <>
                        <span className="muted">
                          {c.carriers.length} deposited{" "}
                          {c.carriers.length === 1 ? "entry" : "entries"}:
                        </span>
                        <span className="carrier-entries">
                          {c.carriers.map((entry) =>
                            entry.entryId === interpretation.entryId ? (
                              <span
                                key={entry.entryId}
                                className="carrier-current"
                              >
                                {entry.entryId} (open)
                              </span>
                            ) : (
                              <button
                                key={entry.entryId}
                                className="biology-link"
                                aria-label={`Compare ${entry.entryId}`}
                                onClick={() => open(entry.entryId)}
                              >
                                {entry.entryId}
                              </button>
                            ),
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="muted">
                        no deposited entity sequence among {c.total}
                      </span>
                    )}
                  </div>
                );
              })}
            <p className="small muted">
              Deposited entity sequences from RCSB&apos;s SIFTS-derived
              alignments ({mode}, retrieved{" "}
              {lookup.resourceRef.retrievedAt.slice(0, 10)}). Whether the
              residue is observed, and how SIFTS labels it, is shown when an
              entry opens as a comparison structure.
              {lookup.computedModelIds.length > 0 &&
                " Computed models in the response are not listed."}
            </p>
          </div>
        );
      })}
      {error && (
        <p className="comparison-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
