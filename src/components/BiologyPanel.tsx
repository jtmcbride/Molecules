import { useState } from "react";
import { BookOpen, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useExplorer } from "../state/explorer";
import type { ExplorerController } from "../structure/controller";
import { AnnotationTracks } from "./AnnotationTracks";
import { BindingSiteSummary } from "./BindingSiteSummary";
import { downloadInterpretation } from "../biology/export";
import { DEFAULT_ANNOTATION_TYPES } from "../domain/biology";
import { BIOLOGY_FRESHNESS_MS } from "../data/biologyResources";
export function BiologyPanel({
  controller,
}: {
  controller: ExplorerController | null;
}) {
  const s = useExplorer(),
    [association, setAssociation] = useState(""),
    interpretation = s.interpretation;
  if (!s.snapshot) return null;
  const chain = s.snapshot.chains.find((c) => c.id === s.activeChainId),
    coverage = interpretation?.coverage.find(
      (c) => c.chainInstanceId === chain?.id,
    ),
    available = coverage?.accessions ?? [];
  const accession = available.includes(s.selectedProteinAccession ?? "")
    ? s.selectedProteinAccession
    : available.length === 1
      ? available[0]
      : null;
  const protein = interpretation?.proteins.find(
    (p) => p.accession === accession,
  );
  const features =
    interpretation?.annotations.filter(
      (a) =>
        a.proteinId === protein?.id && s.annotationCategories.includes(a.type),
    ) ?? [];
  const projections =
    interpretation?.projections.filter(
      (p) => p.chainInstanceId === chain?.id,
    ) ?? [];
  const selected = interpretation?.annotations.find(
    (a) => a.id === s.selectedAnnotationId,
  );
  const stale = interpretation?.resourceRefs.some(
    (r) => Date.now() - Date.parse(r.retrievedAt) > BIOLOGY_FRESHNESS_MS,
  );
  const range = (a: (typeof features)[number]) =>
    `${a.start.modifier === "exact" ? "" : "~"}${a.start.position ?? "?"}${a.end.position !== a.start.position ? `–${a.end.modifier === "exact" ? "" : "~"}${a.end.position ?? "?"}` : ""}`;
  return (
    <section
      className="biology-panel panel"
      aria-label="Functional interpretation"
    >
      <div className="panel-heading">
        <span>
          <BookOpen size={16} /> Functional interpretation
        </span>
        <small>SIFTS · UNIPROT</small>
      </div>
      <div className="biology-content">
        <div className="biology-toolbar">
          <span className="biology-status" role="status">
            {s.biologyPhase === "loading" && (
              <LoaderCircle size={14} className="spin" />
            )}
            <span>{s.biologyStatus || "Load protein annotations"}</span>
            {s.biologyMode && (
              <span className="biology-badge">
                {s.biologyMode}
                {stale ? " · stale" : ""}
              </span>
            )}
          </span>
          {s.source?.kind !== "local" && (
            <button
              className="button secondary"
              disabled={s.biologyPhase === "loading"}
              onClick={() =>
                void controller?.biology.load(undefined, !!interpretation)
              }
            >
              <RefreshCw size={14} />
              {interpretation ? "Refresh annotations" : "Load annotations"}
            </button>
          )}
          {s.biologyPhase === "loading" && (
            <button
              className="biology-link"
              onClick={() => controller?.biology.cancel(false)}
            >
              Cancel annotation loading
            </button>
          )}
        </div>
        {s.source?.kind === "local" && (
          <form
            className="biology-association"
            onSubmit={(e) => {
              e.preventDefault();
              void controller?.biology.load(
                association || s.biologyAssociation || "",
                !!interpretation,
              );
            }}
          >
            <label>
              Associate local structure with PDB
              <input
                aria-label="Annotation PDB association"
                placeholder="e.g. 3PTB"
                value={association}
                onChange={(e) => setAssociation(e.target.value)}
                maxLength={4}
              />
            </label>
            <button
              className="button secondary"
              disabled={s.biologyPhase === "loading"}
            >
              {interpretation ? "Refresh association" : "Validate & load"}
            </button>
            <p className="small muted">
              Only the accession is requested. Local coordinates stay on this
              device; sequence and numbering must agree.
            </p>
          </form>
        )}
        {s.biologyError && (
          <p className="quality-note" role="alert">
            {s.biologyError}
            {interpretation
              ? " The previous interpretation remains available."
              : ""}
          </p>
        )}
        {interpretation && (
          <>
            <div className="protein-strip">
              <div>
                <div className="field-label">PROTEIN IDENTITY</div>
                {protein ? (
                  <>
                    <h2>{protein.name}</h2>
                    <p>
                      {protein.organism.name} ·{" "}
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${protein.accession}/entry`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {protein.accession}
                      </a>{" "}
                      · {protein.sequence.length} residues
                    </p>
                    <p className="small muted">
                      Sequence version{" "}
                      {protein.sequenceVersion ?? "unavailable"} · Entry version{" "}
                      {protein.entryVersion ?? "unavailable"} ·{" "}
                      {protein.reviewed
                        ? "Reviewed record"
                        : "Unreviewed record"}
                    </p>
                  </>
                ) : (
                  <p>
                    {available.length > 1
                      ? "Choose the protein accession for this chain."
                      : "No protein record is available for this chain."}
                  </p>
                )}
              </div>
              {available.length > 1 && (
                <label>
                  Protein accession
                  <select
                    aria-label="Protein accession"
                    value={accession ?? ""}
                    onChange={(e) =>
                      useExplorer.setState({
                        selectedProteinAccession: e.target.value || null,
                        selectedAnnotationId: null,
                      })
                    }
                  >
                    <option value="">Choose protein</option>
                    {available.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {coverage && (
              <div className="mapping-coverage" data-testid="mapping-coverage">
                <strong>
                  {coverage.exact} / {coverage.total}
                </strong>{" "}
                deposited positions mapped exactly{" "}
                <span>
                  · {coverage.ambiguous} ambiguous/conflicting ·{" "}
                  {coverage.unmapped} unmapped
                </span>
              </div>
            )}
            {protein && (
              <>
                <div className="annotation-categories">
                  {DEFAULT_ANNOTATION_TYPES.map((type) => (
                    <label key={type}>
                      <input
                        type="checkbox"
                        checked={s.annotationCategories.includes(type)}
                        onChange={(e) =>
                          useExplorer.setState({
                            annotationCategories: e.target.checked
                              ? [...s.annotationCategories, type]
                              : s.annotationCategories.filter(
                                  (t) => t !== type,
                                ),
                          })
                        }
                      />
                      {type}
                    </label>
                  ))}
                </div>
                <AnnotationTracks
                  controller={controller}
                  accession={protein.accession}
                />
                <div className="feature-list">
                  <h3>
                    Functional features <small>{features.length}</small>
                  </h3>
                  {features.map((a) => {
                    const projection = projections.find(
                      (p) => p.annotationId === a.id,
                    );
                    return (
                      <article
                        key={a.id}
                        className={`functional-feature ${s.selectedAnnotationId === a.id ? "selected" : ""}`}
                      >
                        <button
                          className="feature-select"
                          disabled={!projection}
                          aria-label={`Inspect ${a.type} UniProt ${range(a)}`}
                          onClick={() => controller?.selectAnnotation(a.id)}
                        >
                          <strong>{a.type}</strong>
                          <span>UniProt {range(a)}</span>
                          <small>
                            {a.description ||
                              a.ligand?.name ||
                              "Database annotation"}
                          </small>
                        </button>
                        <div className="feature-availability">
                          {!a.valid
                            ? "Invalid feature boundaries"
                            : !projection
                              ? "Outside mapped chain"
                              : projection.uncertain
                                ? "Uncertain boundary; no exact 3D projection"
                                : `${projection.residueIds.length} observed · ${projection.unobservedPositions.length} without coordinates · ${projection.ambiguousPositions.length} ambiguous`}
                        </div>
                        <button
                          className="biology-link"
                          aria-label={`Evidence for ${a.type} UniProt ${range(a)}`}
                          onClick={() =>
                            useExplorer.setState({ evidenceIds: a.evidenceIds })
                          }
                        >
                          Evidence
                        </button>
                      </article>
                    );
                  })}
                  {!features.length && (
                    <p className="small muted">
                      No features in these displayed categories.
                    </p>
                  )}
                </div>
                {selected && (
                  <div
                    className="quality-note"
                    data-testid="selected-annotation"
                  >
                    {selected.type} · UniProt {range(selected)} ·{" "}
                    {selected.description ||
                      selected.ligand?.name ||
                      "Database feature"}
                    {projections.find((p) => p.annotationId === selected.id)
                      ?.unobservedPositions.length
                      ? " · Includes positions without coordinates"
                      : ""}
                  </div>
                )}
                {protein.notes.length > 0 && (
                  <details className="protein-notes">
                    <summary>Protein function and catalytic notes</summary>
                    {protein.notes.map((n, i) => (
                      <article key={i}>
                        <strong>{n.type.replaceAll("_", " ")}</strong>
                        <p>{n.description}</p>
                        <button
                          className="biology-link"
                          onClick={() =>
                            useExplorer.setState({ evidenceIds: n.evidenceIds })
                          }
                        >
                          Statement evidence
                        </button>
                      </article>
                    ))}
                  </details>
                )}
              </>
            )}
            <BindingSiteSummary />
            {interpretation.qualityFlags.length > 0 && (
              <details className="biology-quality">
                <summary>
                  {interpretation.qualityFlags.length} annotation quality notes
                </summary>
                {interpretation.qualityFlags.map((q, i) => (
                  <p className="quality-note" key={i}>
                    {q}
                  </p>
                ))}
              </details>
            )}
            <p className="small muted">
              Sources retrieved{" "}
              {new Date(
                interpretation.resourceRefs[0]?.retrievedAt ??
                  interpretation.createdAt,
              ).toLocaleString()}
              . Saved interpretations retain their original revisions until
              explicitly refreshed.
            </p>
            <div className="biology-exports">
              <button
                className="button secondary"
                onClick={() =>
                  s.source &&
                  downloadInterpretation(
                    interpretation,
                    s.snapshot!,
                    s.source,
                    s.analysis,
                    "json",
                  )
                }
              >
                <Download size={14} /> Interpretation JSON
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  s.source &&
                  downloadInterpretation(
                    interpretation,
                    s.snapshot!,
                    s.source,
                    s.analysis,
                    "csv",
                  )
                }
              >
                <Download size={14} /> Residue annotations CSV
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
