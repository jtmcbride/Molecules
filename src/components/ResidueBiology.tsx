import { useExplorer } from "../state/explorer";
import type { ExplorerController } from "../structure/controller";
import { VariantCarrierList } from "./VariantCarrierList";
import type { ResidueMapping } from "../domain/biology";
import { variantConsequences } from "../biology/consequences";
import {
  consequenceSentences,
  interactionName,
} from "../biology/consequenceText";
import type { VariantConsequence } from "../domain/biology";
import {
  interpretationVariantStates,
  isVariantAnnotation,
  variantLabel,
  type VariantResidueState,
} from "../biology/variants";

const IDENTITY_LABEL: Partial<
  Record<NonNullable<ResidueMapping["identity"]>, string>
> = {
  engineered_mutation: "engineered",
  natural_variant: "natural variant",
  conflict: "sequence conflict",
  unexplained_mismatch: "unexplained mismatch",
};
/** e.g. "S200A (engineered)": UniProt residue, UniProt position, deposited residue. */
export function residueChangeLabel(m: ResidueMapping) {
  if (!m.residueChange) return "";
  const { uniprot, deposited } = m.residueChange;
  const kind = m.identity ? IDENTITY_LABEL[m.identity] : undefined;
  return `${uniprot}${m.uniprotPosition}${deposited}${kind ? ` (${kind})` : ""}`;
}
export function ResidueBiology({
  controller = null,
}: {
  controller?: ExplorerController | null;
} = {}) {
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
              !isVariantAnnotation(a) &&
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
                    {m.residueChange && (
                      <span
                        className={`residue-change identity-${m.identity}`}
                        data-testid="residue-change"
                      >
                        {" · "}
                        {residueChangeLabel(m)}
                      </span>
                    )}
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
          <ResidueVariants residueId={residue.id} controller={controller} />
        </>
      )}
    </section>
  );
}

const STATE_LABEL: Record<VariantResidueState["state"], string> = {
  carries: "this structure carries the replacement",
  original: "deposited residue is the original",
  other: "deposited residue is neither the original nor the replacement",
  not_evaluated: "not evaluated",
};

/** Curated variants at one residue, quoted from their source with evidence. */
function ResidueVariants({
  residueId,
  controller,
}: {
  residueId: string;
  controller: ExplorerController | null;
}) {
  const s = useExplorer(),
    interpretation = s.interpretation;
  if (!interpretation) return null;
  const variants = interpretation.projections
    .filter((p) => p.residueIds.includes(residueId))
    .flatMap((p) =>
      interpretation.annotations.filter(
        (a) => a.id === p.annotationId && isVariantAnnotation(a),
      ),
    );
  if (!variants.length) return null;
  const chainInstanceIds = new Set(
    interpretation.mappings
      .filter((m) => m.residueId === residueId)
      .map((m) => m.chainInstanceId),
  );
  const states = interpretationVariantStates({
    ...interpretation,
    annotations: variants,
  }).filter((x) => chainInstanceIds.has(x.chainInstanceId));
  // Consequences need an analysis of the same coordinates; restricted to this residue.
  const run =
      s.analysis &&
      s.snapshot &&
      s.analysis.snapshotId === interpretation.snapshotId &&
      s.snapshot.id === interpretation.snapshotId
        ? s.analysis
        : null,
    consequences = run
      ? variantConsequences(
          { ...interpretation, annotations: variants },
          {
            ...run,
            interactions: run.interactions.filter(
              (i) => i.receptor.residueId === residueId,
            ),
          },
          s.snapshot!,
        )
      : [];
  return (
    <details className="residue-variants" data-testid="residue-variants">
      <summary>
        Curated variants at this position <small>{variants.length}</small>
      </summary>
      {variants.map((a) => {
        const state = states.find((x) => x.annotationId === a.id);
        return (
          <article className="residue-feature" key={a.id}>
            <strong>
              {variantLabel(a)} <small>{a.type}</small>
            </strong>
            {a.description && <q>{a.description}</q>}
            {state && (
              <p
                className={`variant-state variant-${state.state}`}
                title={state.state === "not_evaluated" ? state.reason : ""}
              >
                {STATE_LABEL[state.state]}
                {state.state === "not_evaluated" ? `: ${state.reason}` : ""}
              </p>
            )}
            <VariantInteractions
              consequences={consequences.filter((c) => c.annotationId === a.id)}
            />
            {a.crossReferences?.length ? (
              <small className="muted variant-references">
                {a.crossReferences
                  .map((x) => `${x.database}:${x.id}`)
                  .join(" · ")}
              </small>
            ) : null}
            <button
              className="biology-link"
              onClick={() =>
                useExplorer.setState({ evidenceIds: a.evidenceIds })
              }
            >
              Variant evidence
            </button>
          </article>
        );
      })}
      <VariantCarrierList variants={variants} controller={controller} />
      <p className="small muted">
        Quoted from UniProt with its evidence. These are database records, not a
        clinical interpretation, and their location here is not evidence of an
        effect on binding.
      </p>
    </details>
  );
}

/** Atom-level facts about the analyzed interactions at a variant position. */
function VariantInteractions({
  consequences,
}: {
  consequences: VariantConsequence[];
}) {
  const s = useExplorer();
  if (!s.analysis || !consequences.length) return null;
  const type = (c: VariantConsequence) =>
    s.analysis!.interactions.find((i) => i.id === c.interactionId)?.type;
  return (
    <div className="variant-interactions" data-testid="variant-interactions">
      {consequences.map((c) => {
        const [headline, ...details] = consequenceSentences(c);
        const kind = type(c);
        return (
          <div
            key={`${c.interactionId}:${c.status === "evaluated" ? c.replacement : ""}`}
            className={`variant-consequence retained-${c.status === "evaluated" ? c.retained : "unknown"}`}
          >
            <strong>
              {kind ? interactionName(kind) : "interaction"}
              {c.status === "evaluated"
                ? ` · ${c.deposited}→${c.replacement}`
                : ""}
            </strong>{" "}
            {headline}
            {details.length > 0 && (
              <ul>
                {details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
