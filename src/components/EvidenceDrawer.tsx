import { useEffect, useRef } from "react";
import { X, ExternalLink } from "lucide-react";
import { useExplorer } from "../state/explorer";
import { analysisEvidence } from "../biology/evidence";
export function EvidenceDrawer() {
  const s = useExplorer(),
    close = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!s.evidenceIds.length) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") useExplorer.setState({ evidenceIds: [] });
      if (e.key === "Tab") {
        const targets = dialog.current?.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, [tabindex="0"]',
        );
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [s.evidenceIds]);
  if (!s.evidenceIds.length) return null;
  const evidence = [
    ...(s.interpretation?.evidence ?? []),
    ...(s.analysis ? [analysisEvidence(s.analysis)] : []),
  ].filter((e) => s.evidenceIds.includes(e.id));
  return (
    <div
      className="modal-backdrop"
      onClick={() => useExplorer.setState({ evidenceIds: [] })}
    >
      <section
        className="evidence-drawer"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-button modal-close"
          ref={close}
          aria-label="Close evidence"
          onClick={() => useExplorer.setState({ evidenceIds: [] })}
        >
          <X size={18} />
        </button>
        <div className="eyebrow">TRACEABLE SOURCES</div>
        <h2 id="evidence-title">Evidence and provenance</h2>
        {evidence.some((e) => e.kind === "database_annotation") &&
          !evidence.some((e) => e.ecoCode) && (
            <p className="quality-note">
              No feature-level ECO evidence is attached to this statement.
              Database provenance is available; a reviewed record does not
              establish experimental support for every feature.
            </p>
          )}
        {evidence.map((e) => (
          <article className="evidence-record" key={e.id}>
            <strong>{e.provider}</strong>
            <span className="biology-badge">{e.kind.replaceAll("_", " ")}</span>
            {e.ecoCode && (
              <p>
                <a
                  href={`https://www.ebi.ac.uk/ols4/ontologies/eco/classes?iri=${encodeURIComponent(`http://purl.obolibrary.org/obo/${e.ecoCode.replace(":", "_")}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.ecoCode}
                </a>
              </p>
            )}
            <p>
              {e.sourceIdentifier}
              {e.algorithmVersion && ` · ${e.algorithmVersion}`}
            </p>
            {e.citationIds?.map((id) => (
              <p key={id}>{id}</p>
            ))}
            {e.retrievedAt && (
              <p>Retrieved {new Date(e.retrievedAt).toLocaleString()}</p>
            )}
            {e.release && <p>Release {e.release}</p>}
            {e.contentHash && (
              <p className="source-hash">SHA-256 {e.contentHash}</p>
            )}
            {e.assumptions?.map((a) => (
              <p key={a}>{a}</p>
            ))}
            {e.url && (
              <a href={e.url} target="_blank" rel="noreferrer">
                Open source <ExternalLink size={12} />
              </a>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
