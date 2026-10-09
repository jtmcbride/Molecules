import { useExplorer } from "../state/explorer";
export function ResidueBiology() {
  const s = useExplorer(),
    interpretation = s.interpretation,
    residue = s.snapshot?.residues.find((r) => r.id === s.selectedResidueId);
  if (!residue || residue.kind !== "polymer") return null;
  const mappings =
      interpretation?.mappings.filter((m) => m.residueId === residue.id) ?? [],
    features =
      interpretation?.projections
        .filter((p) => p.residueIds.includes(residue.id))
        .flatMap((p) =>
          interpretation.annotations.filter(
            (a) =>
              a.id === p.annotationId &&
              s.annotationCategories.includes(a.type),
          ),
        ) ?? [];
  return (
    <section className="residue-biology" data-testid="residue-biology">
      <div className="section-rule" />
      <div className="field-label">BIOLOGICAL CONTEXT</div>
      {!interpretation ? (
        <p className="small muted">
          {s.biologyPhase === "loading"
            ? "Loading protein correspondence…"
            : (s.biologyError ?? "No validated protein mapping.")}
        </p>
      ) : (
        <>
          <dl className="property-list">
            {mappings.length ? (
              mappings.map((m) => (
                <div className="mapping-pair" key={m.id}>
                  <dt>UniProt {m.accession}</dt>
                  <dd>
                    {m.uniprotPosition} · {m.status.replaceAll("_", " ")}
                  </dd>
                </div>
              ))
            ) : (
              <>
                <dt>Correspondence</dt>
                <dd>Unmapped</dd>
              </>
            )}
          </dl>
          {mappings.map((m) => (
            <button
              key={m.id}
              className="biology-link"
              onClick={() =>
                useExplorer.setState({ evidenceIds: m.evidenceIds })
              }
            >
              Mapping source · label {m.labelSeqId}
            </button>
          ))}
          {features.map((a) => (
            <article className="residue-feature" key={a.id}>
              <strong>{a.type}</strong>
              <p>{a.description || a.ligand?.name || "Database feature"}</p>
              <button
                className="biology-link"
                onClick={() =>
                  useExplorer.setState({ evidenceIds: a.evidenceIds })
                }
              >
                Feature evidence
              </button>
            </article>
          ))}
          {!features.length && (
            <p className="small muted">
              {mappings.some((m) => m.status === "exact")
                ? "No overlapping features in the displayed categories."
                : "Exact functional projection is unavailable."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
