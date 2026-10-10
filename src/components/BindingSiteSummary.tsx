import { useExplorer } from "../state/explorer";
import { analyzedComponent, summarizeBindingSite } from "../biology/projection";
import { analysisEvidence } from "../biology/evidence";
import type { LigandRelation } from "../domain/biology";

const percent = (n: number, d: number) =>
  d ? `${Math.round((100 * n) / d)}%` : "–";
const RELATION_LABEL: Record<LigandRelation, string> = {
  same: "same ChEBI entity",
  different: "different ChEBI entity",
  unresolved: "relation unresolved",
};

export function BindingSiteSummary() {
  const s = useExplorer();
  if (
    !s.analysis ||
    !s.interpretation ||
    !s.snapshot ||
    s.analysis.snapshotId !== s.interpretation.snapshotId
  )
    return null;
  const summary = summarizeBindingSite(
    s.interpretation,
    s.analysis,
    analyzedComponent(s.snapshot, s.analysis),
  );
  const sites = summary.overlaps.filter((o) => o.category === "site"),
    context = summary.overlaps.filter((o) => o.category === "context");
  const showSources = (annotationIds: string[]) =>
    useExplorer.setState({
      evidenceIds: [
        ...new Set(
          annotationIds.flatMap(
            (id) =>
              s.interpretation!.annotations.find((a) => a.id === id)
                ?.evidenceIds ?? [],
          ),
        ),
      ],
    });
  const featureRange = (annotationId: string) => {
    const a = s.interpretation!.annotations.find((x) => x.id === annotationId);
    const start = a?.start.position,
      end = a?.end.position;
    return start === undefined
      ? "UniProt ?"
      : `UniProt ${start}${end !== undefined && end !== start ? `–${end}` : ""}`;
  };
  const row = (o: (typeof summary.overlaps)[number]) => (
    <div className="binding-overlap" key={o.type}>
      <strong>{o.type}</strong>
      <span title="Binding-site residues with this feature / mapped binding-site residues">
        {o.residueIds.length} / {summary.mappedCount}
      </span>
      <span title="Chain background: mapped observed residues with this feature / all mapped observed residues in the same chains">
        chain {o.background.annotated} / {o.background.total}
      </span>
      <button
        className="biology-link"
        onClick={() => showSources(o.annotationIds)}
      >
        Sources
      </button>
    </div>
  );
  return (
    <section className="binding-biology" data-testid="binding-site-summary">
      <div className="biology-section-heading">
        <h3>Binding-site interpretation</h3>
        <button
          className="biology-link"
          onClick={() =>
            useExplorer.setState({
              evidenceIds: [analysisEvidence(s.analysis!).id],
            })
          }
        >
          Geometry evidence
        </button>
      </div>
      <p>
        <strong>
          {summary.mappedCount} / {summary.contactCount}
        </strong>{" "}
        contact residues mapped;{" "}
        <strong data-testid="site-overlap">
          {summary.siteAnnotatedCount} / {summary.mappedCount}
        </strong>{" "}
        mapped residues carry site-level features (
        {percent(summary.siteAnnotatedCount, summary.mappedCount)}), against a
        chain background of{" "}
        <strong data-testid="site-background">
          {summary.siteBackground.annotated} / {summary.siteBackground.total}
        </strong>{" "}
        (
        {percent(
          summary.siteBackground.annotated,
          summary.siteBackground.total,
        )}
        ).
      </p>
      <p className="small muted">
        {summary.ambiguousCount} ambiguous · {summary.unmappedCount} unmapped.
        Counts use polymer contact residues; waters and ligands are excluded
        from the denominator.
      </p>
      {(() => {
        const all = new Set<string>(),
          partial = new Set<string>();
        for (const i of s.analysis!.interactions)
          if (i.conformerPresence)
            (i.conformerPresence === "all" ? all : partial).add(
              i.receptor.residueId,
            );
        const onlyPartial = [...partial].filter((id) => !all.has(id));
        return onlyPartial.length ? (
          <p className="small muted" data-testid="partial-conformer-residues">
            {onlyPartial.length} contact residue
            {onlyPartial.length === 1 ? "" : "s"} contact the ligand in only
            some alternate conformers.
          </p>
        ) : null;
      })()}
      {summary.cofactorContactIds.length > 0 && (
        <p className="small muted" data-testid="cofactor-contacts">
          Cofactor/ion receptor contacts (not in polymer counts):{" "}
          {summary.cofactorContactIds
            .map((id) => {
              const r = s.snapshot!.residues.find((x) => x.id === id);
              return r ? `${r.componentId} ${r.authSeqId ?? "?"}` : id;
            })
            .join(", ")}
          .
        </p>
      )}
      <div className="biology-tags">
        <span>{summary.proximityResidueCount} proximity</span>
        <span>{summary.chemicalResidueCount} chemical</span>
        <span>{summary.clashResidueCount} overlap/clash</span>
      </div>
      {sites.map(row)}
      {summary.ligandSites.length > 0 && (
        <div className="ligand-sites" data-testid="ligand-sites">
          <h4>
            Binding-site ligands vs {summary.analyzedLigand.componentId}
            {summary.analyzedLigand.chebiIds.length
              ? ` (${summary.analyzedLigand.chebiIds.join(", ")})`
              : ""}
          </h4>
          {summary.ligandSites.map((site) => (
            <div className="ligand-site" key={site.annotationId}>
              <span>
                {featureRange(site.annotationId)} ·{" "}
                {site.ligandName ?? "Unnamed ligand"}
                {site.ligandId ? ` · ${site.ligandId}` : ""}
              </span>
              <span
                className={`relation relation-${site.relation}`}
                title={site.reason}
              >
                {RELATION_LABEL[site.relation]}
              </span>
              <small className="muted">{site.reason}</small>
            </div>
          ))}
        </div>
      )}
      <StructureEvidence />
      {context.length > 0 && (
        <div className="binding-context">
          <h4>Context: domains and regions</h4>
          {context.map(row)}
          <p className="small muted">
            Domains and regions often span most of a chain. They give context
            and are not counted as functional overlap.
          </p>
        </div>
      )}
      <p className="small muted">
        Site-level features are active sites, binding sites and sites. Feature
        overlap and contact counts do not establish functional importance,
        affinity or mutation effects.
      </p>
    </section>
  );
}

const fixed = (x: number | undefined, digits: number, unit = "") =>
  x === undefined ? "not deposited" : `${x.toFixed(digits)}${unit}`;

/** Experimental quality of the coordinates and the analyzed ligand's fit to density. */
function StructureEvidence() {
  const s = useExplorer();
  if (!s.snapshot || !s.analysis || !s.interpretation) return null;
  const quality = s.snapshot.quality,
    residue = s.snapshot.residues.find(
      (r) => r.id === s.analysis!.request.ligandResidueId,
    ),
    chain = s.snapshot.chains.find((c) => c.id === residue?.chainId),
    fit = s.interpretation.ligandFits?.find(
      (f) => f.labelAsymId === chain?.labelAsymId,
    );
  return (
    <div className="structure-evidence" data-testid="structure-evidence">
      <h4>Structure and ligand evidence</h4>
      <dl>
        <dt>Method</dt>
        <dd>{quality?.method ?? "not recorded"}</dd>
        <dt>Resolution</dt>
        <dd>{fixed(quality?.resolutionAngstrom, 2, " Å")}</dd>
        <dt>R-free</dt>
        <dd>{fixed(quality?.rFree, 3)}</dd>
        <dt>Coordinate error</dt>
        <dd data-testid="coordinate-error">
          {quality?.coordinateErrorAngstrom === undefined
            ? "not estimable (refinement statistics missing)"
            : `${quality.coordinateErrorAngstrom.toFixed(2)} Å (${
                quality.coordinateErrorSource === "deposited_esu_r_free"
                  ? "deposited ESU"
                  : "Cruickshank DPI"
              })`}
        </dd>
        <dt>{residue?.componentId ?? "Ligand"} fit</dt>
        <dd data-testid="ligand-fit">
          {!fit
            ? "validation scores not loaded"
            : fit.rscc === undefined
              ? "no density fit scores (structure factors not deposited)"
              : `RSCC ${fit.rscc.toFixed(3)} · RSR ${fixed(fit.rsr, 3)}${
                  fit.completeness !== undefined
                    ? ` · ${Math.round(fit.completeness * 100)}% modeled`
                    : ""
                }`}
        </dd>
      </dl>
      {fit && (
        <button
          className="biology-link"
          onClick={() => useExplorer.setState({ evidenceIds: fit.evidenceIds })}
        >
          Validation source
        </button>
      )}
      <p className="small muted">
        Ligand fit is the main caveat for any contact claim: weak density
        support (RSCC below about 0.8) makes the modeled pose uncertain.
        Coordinate error describes an atom with average B factor.
      </p>
    </div>
  );
}
