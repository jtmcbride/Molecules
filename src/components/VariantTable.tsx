import { Fragment, useMemo, useState } from "react";
import { useExplorer } from "../state/explorer";
import type { ExplorerController } from "../structure/controller";
import type { InterpretationSnapshot, ProteinRecord } from "../domain/biology";
import {
  filterVariants,
  variantBounds,
  variantTable,
  type VariantFilters,
} from "../biology/variantTable";
import { variantLabel } from "../biology/variants";
import { VariantCarrierList } from "./VariantCarrierList";

const PAGE_SIZE = 10;
const INITIAL: VariantFilters = {
  type: "",
  text: "",
  observed: "all",
  contact: "all",
};
const CONTACT_LABEL = {
  proximity: "proximity",
  chemical: "chemical contacts",
  clash: "clashes",
};
const STATE_LABEL = {
  carries: "carries the replacement",
  original: "deposited residue is the original",
  other: "deposited residue is neither the original nor the replacement",
  not_evaluated: "not evaluated",
};

/** Protein-wide discovery, independent of the optional sequence-track categories. */
export function VariantTable({
  interpretation,
  protein,
  controller,
}: {
  interpretation: InterpretationSnapshot;
  protein: ProteinRecord;
  controller: ExplorerController | null;
}) {
  const analysis = useExplorer((s) => s.analysis);
  const snapshot = useExplorer((s) => s.snapshot);
  const [filters, setFilters] = useState(INITIAL);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const model = useMemo(
    () => variantTable(interpretation, protein.id, analysis),
    [interpretation, protein.id, analysis],
  );
  const filtered = useMemo(
    () => filterVariants(model, filters),
    [model, filters],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const change = (next: Partial<VariantFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(0);
  };
  return (
    <section
      className="variant-table"
      aria-label="Protein variants"
      data-testid="variant-table"
    >
      <h3>
        Protein variants <small>{protein.accession}</small>
      </h3>
      <p className="small muted">
        Source features across this protein; chain copies do not multiply the
        record count. Sorted by UniProt position, then feature ID.
      </p>
      <p className="small" data-testid="variant-type-counts">
        {
          model.rows.filter((r) => r.annotation.type === "Natural variant")
            .length
        }{" "}
        Natural variant ·{" "}
        {model.rows.filter((r) => r.annotation.type === "Mutagenesis").length}{" "}
        Mutagenesis
      </p>
      {!model.rows.length ? (
        <p>
          UniProt {protein.accession} lists no natural variant or mutagenesis
          records.
        </p>
      ) : (
        <>
          <div className="variant-filters">
            <label>
              Search records
              <input
                type="search"
                value={filters.text}
                onChange={(e) => change({ text: e.target.value })}
                placeholder="Substitution, description or source ID"
              />
            </label>
            <label>
              Feature type
              <select
                value={filters.type}
                onChange={(e) => change({ type: e.target.value })}
              >
                <option value="">All types</option>
                <option>Natural variant</option>
                <option>Mutagenesis</option>
              </select>
            </label>
            <label>
              Observed mapping
              <select
                value={filters.observed}
                onChange={(e) =>
                  change({
                    observed: e.target.value as VariantFilters["observed"],
                  })
                }
              >
                <option value="all">All records</option>
                <option value="observed">
                  At least one exact observed position
                </option>
                <option value="unobserved">No exact observed positions</option>
              </select>
            </label>
            <label>
              Contact membership
              <select
                disabled={!model.contactsAvailable}
                value={model.contactsAvailable ? filters.contact : "all"}
                onChange={(e) =>
                  change({
                    contact: e.target.value as VariantFilters["contact"],
                  })
                }
              >
                <option value="all">All records</option>
                <option value="proximity">Proximity contacts</option>
                <option value="chemical">Chemical contacts</option>
                <option value="clash">Steric clashes</option>
              </select>
            </label>
          </div>
          <p className="small muted">
            {model.contactsAvailable
              ? "Contact filters use receptor residues in the current ligand analysis, across all mapped chain instances. Location is not evidence of an effect on binding."
              : "Contact filtering unavailable: run an analysis for these coordinates."}
          </p>
          <p className="small" role="status">
            {filtered.length} of {model.rows.length} source features ·{" "}
            {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–
            {Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} shown
          </p>
          <div className="variant-table-scroll">
            <table>
              <caption>Curated variants for {protein.accession}</caption>
              <thead>
                <tr>
                  <th scope="col">Source feature</th>
                  <th scope="col">Quoted UniProt record</th>
                  <th scope="col">Coverage / details</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                  .map(({ annotation: a, chains }) => (
                    <Fragment key={a.id}>
                      <tr>
                        <th scope="row">
                          <strong>{variantLabel(a)}</strong>
                          <small>{a.type}</small>
                          <small>UniProt {variantBounds(a)}</small>
                        </th>
                        <td>
                          {a.description ? (
                            <q>{a.description}</q>
                          ) : (
                            <span className="muted">
                              No description supplied.
                            </span>
                          )}
                          <small>{a.sourceFeatureId ?? a.id}</small>
                          {a.crossReferences?.length ? (
                            <small>
                              {a.crossReferences
                                .map((x) => `${x.database}:${x.id}`)
                                .join(" · ")}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <span>
                            {chains.filter((c) => c.residueIds.length).length} /{" "}
                            {chains.length} chain instances with exact observed
                            positions
                          </span>
                          <button
                            className="biology-link"
                            aria-expanded={expanded === a.id}
                            onClick={() =>
                              setExpanded(expanded === a.id ? null : a.id)
                            }
                          >
                            {" "}
                            {expanded === a.id ? "Hide" : "Show"} details for{" "}
                            {variantLabel(a)}
                          </button>
                        </td>
                      </tr>
                      {expanded === a.id && (
                        <tr>
                          <td colSpan={3} className="variant-details">
                            {!chains.length && (
                              <p>
                                No deposited chain mapping is available for this
                                protein.
                              </p>
                            )}
                            {chains.map((c) => {
                              const chain = snapshot?.chains.find(
                                (x) => x.id === c.chainInstanceId,
                              );
                              const name = chain
                                ? `${chain.authAsymId} · ${chain.operatorId}`
                                : c.chainInstanceId;
                              return (
                                <article
                                  key={c.chainInstanceId}
                                  className="variant-chain"
                                >
                                  <strong>Chain {name}</strong>
                                  <p>
                                    {c.observedPositions.length} exact observed
                                    · {c.unobservedPositions.length} without
                                    coordinates · {c.ambiguousPositions.length}{" "}
                                    ambiguous
                                    {c.outsideCount !== null
                                      ? ` · ${c.outsideCount} outside deposited mapping`
                                      : " · uncertain or invalid bounds"}
                                  </p>
                                  {c.observedPositions.length > 0 && (
                                    <p>
                                      Observed UniProt positions:{" "}
                                      {c.observedPositions.join(", ")}
                                    </p>
                                  )}
                                  <p
                                    className={`variant-state variant-${c.state.state}`}
                                  >
                                    {STATE_LABEL[c.state.state]}
                                    {c.state.state === "not_evaluated"
                                      ? `: ${c.state.reason}`
                                      : ` (${c.state.deposited})`}
                                  </p>
                                  {model.contactsAvailable && (
                                    <p>
                                      Current analysis:{" "}
                                      {c.contacts
                                        .map((k) => CONTACT_LABEL[k])
                                        .join(" · ") ||
                                        "no recorded receptor contacts at exact observed positions"}
                                    </p>
                                  )}
                                  <button
                                    className="biology-link"
                                    disabled={
                                      !controller || !c.residueIds.length
                                    }
                                    onClick={() =>
                                      controller?.selectAnnotation(
                                        a.id,
                                        c.chainInstanceId,
                                      )
                                    }
                                  >
                                    Inspect {variantLabel(a)} in chain {name}
                                  </button>
                                </article>
                              );
                            })}
                            {a.qualityFlags.map((flag) => (
                              <p className="small muted" key={flag}>
                                {flag}
                              </p>
                            ))}
                            <button
                              className="biology-link"
                              onClick={() =>
                                useExplorer.setState({
                                  evidenceIds: a.evidenceIds,
                                })
                              }
                            >
                              Variant evidence
                            </button>
                            <VariantCarrierList
                              key={a.id}
                              variants={[a]}
                              controller={controller}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <p>No source features match these filters.</p>}
          <nav className="variant-pagination" aria-label="Variant pages">
            <button
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous variants
            </button>
            <span>
              Page {currentPage + 1} of {pages}
            </span>
            <button
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next variants
            </button>
          </nav>
        </>
      )}
      <p className="small muted">
        Database records, not a clinical interpretation or prediction of effect.
        The interpretation JSON/CSV exports below contain the complete records,
        regardless of these filters.
      </p>
    </section>
  );
}
