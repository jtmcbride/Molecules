import { useEffect, useState } from "react";
import { useExplorer } from "../state/explorer";
import type { ExplorerController } from "../structure/controller";
export function AnnotationTracks({
  controller,
  accession,
}: {
  controller: ExplorerController | null;
  accession: string;
}) {
  const s = useExplorer(),
    chain = s.snapshot?.chains.find((c) => c.id === s.activeChainId),
    interpretation = s.interpretation;
  const [window, setWindow] = useState(0);
  useEffect(() => setWindow(0), [chain?.id]);
  useEffect(() => {
    const index =
      chain?.sequence.findIndex(
        (p) => p.labelSeqId === s.biologySelectedLabel,
      ) ?? -1;
    if (index >= 0) setWindow(Math.floor(index / 120));
  }, [s.biologySelectedLabel, chain?.id]);
  if (!chain || !interpretation) return null;
  const mappings = interpretation.mappings.filter(
      (m) => m.chainInstanceId === chain.id && m.accession === accession,
    ),
    features = interpretation.annotations.filter(
      (a) =>
        a.proteinId ===
          interpretation.proteins.find((p) => p.accession === accession)?.id &&
        s.annotationCategories.includes(a.type),
    );
  const positions = chain.sequence.slice(window * 120, (window + 1) * 120),
    types = [...new Set(features.map((a) => a.type))];
  return (
    <div className="annotation-tracks">
      <div className="biology-section-heading">
        <h3>Sequence annotation tracks</h3>
        <span>
          PDB label positions {positions[0]?.labelSeqId}–
          {positions.at(-1)?.labelSeqId}
        </span>
      </div>
      <div className="annotation-track-scroll">
        <div className="annotation-track-row">
          <span className="track-label">Mapping</span>
          {positions.map((p) => {
            const rows = mappings.filter((m) => m.labelSeqId === p.labelSeqId),
              exact = rows.length === 1 && rows[0].status === "exact";
            return (
              <button
                key={p.labelSeqId}
                className={`annotation-cell ${exact ? "mapped" : "unmapped"} ${!p.residueIds.length ? "unobserved" : ""} ${s.biologySelectedLabel === p.labelSeqId ? "selected" : ""}`}
                aria-label={`Mapped position label ${p.labelSeqId}${exact ? ` UniProt ${rows[0].uniprotPosition}` : " unavailable or ambiguous"}`}
                title={`PDB label ${p.labelSeqId} → ${exact ? `${accession}:${rows[0].uniprotPosition}` : "unmapped/ambiguous"}${p.residueIds.length ? "" : " · no coordinates"}`}
                onClick={() => controller?.selectBiologyPosition(p.labelSeqId)}
              >
                {p.code}
              </button>
            );
          })}
        </div>
        {types.map((type) => (
          <div className="annotation-track-row" key={type}>
            <span className="track-label">{type}</span>
            {positions.map((p) => {
              const rows = mappings.filter(
                  (m) => m.labelSeqId === p.labelSeqId,
                ),
                overlap = features.filter(
                  (a) =>
                    a.type === type &&
                    a.valid &&
                    a.start.position !== undefined &&
                    a.end.position !== undefined &&
                    rows.some(
                      (m) =>
                        m.uniprotPosition >= a.start.position! &&
                        m.uniprotPosition <= a.end.position!,
                    ),
                ),
                uncertain =
                  overlap.some(
                    (a) =>
                      a.start.modifier !== "exact" ||
                      a.end.modifier !== "exact",
                  ) || rows.some((m) => m.status !== "exact");
              return (
                <button
                  key={p.labelSeqId}
                  className={`annotation-cell ${overlap.length ? "annotated" : ""} ${uncertain ? "uncertain" : ""} ${!p.residueIds.length ? "unobserved" : ""}`}
                  disabled={!overlap.length}
                  aria-label={`${type} at label ${p.labelSeqId}`}
                  title={`${type} · PDB label ${p.labelSeqId}${uncertain ? " · uncertain correspondence/boundary" : ""}`}
                  onClick={() => {
                    if (uncertain) controller?.select(null);
                    else controller?.selectBiologyPosition(p.labelSeqId);
                    useExplorer.setState({
                      selectedAnnotationId: overlap[0].id,
                      biologySelectedLabel: p.labelSeqId,
                    });
                  }}
                >
                  •
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="small muted">
        Tracks use deposited label positions; tooltips show exact UniProt
        correspondence. Hatched cells have no coordinates; outlined cells
        indicate uncertainty.
      </p>
      {chain.sequence.length > 120 && (
        <div className="table-pagination">
          <button disabled={window === 0} onClick={() => setWindow(window - 1)}>
            Previous positions
          </button>
          <span>
            {window + 1} / {Math.ceil(chain.sequence.length / 120)}
          </span>
          <button
            disabled={(window + 1) * 120 >= chain.sequence.length}
            onClick={() => setWindow(window + 1)}
          >
            Next positions
          </button>
        </div>
      )}
    </div>
  );
}
