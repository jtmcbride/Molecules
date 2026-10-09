import { useExplorer } from "../state/explorer";
import { summarizeBindingSite } from "../biology/projection";
import { analysisEvidence } from "../biology/evidence";
import { FUNCTIONAL_SITE_TYPES } from "../domain/biology";
export function BindingSiteSummary() {
  const s = useExplorer();
  if (
    !s.analysis ||
    !s.interpretation ||
    s.analysis.snapshotId !== s.interpretation.snapshotId
  )
    return null;
  const summary = summarizeBindingSite(s.interpretation, s.analysis),
    visible = summary.overlaps.filter((o) =>
      FUNCTIONAL_SITE_TYPES.includes(o.type),
    );
  const annotated = new Set(visible.flatMap((o) => o.residueIds));
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
        <strong>
          {annotated.size} / {summary.mappedCount}
        </strong>{" "}
        mapped residues overlap functional features.
      </p>
      <p className="small muted">
        {summary.ambiguousCount} ambiguous · {summary.unmappedCount} unmapped.
        Counts use polymer contact residues; waters and ligands are excluded
        from the denominator.
      </p>
      <div className="biology-tags">
        <span>{summary.proximityResidueCount} proximity</span>
        <span>{summary.chemicalResidueCount} chemical</span>
        <span>{summary.clashResidueCount} overlap/clash</span>
      </div>
      {visible.map((o) => (
        <div className="binding-overlap" key={o.type}>
          <strong>{o.type}</strong>
          <span>{o.residueIds.length} residues</span>
          <button
            className="biology-link"
            onClick={() =>
              useExplorer.setState({
                evidenceIds: [
                  ...new Set(
                    o.annotationIds.flatMap(
                      (id) =>
                        s.interpretation!.annotations.find((a) => a.id === id)
                          ?.evidenceIds ?? [],
                    ),
                  ),
                ],
              })
            }
          >
            Sources
          </button>
        </div>
      ))}
      <p className="small muted">
        Functional counts cover active sites, binding sites, domains, regions
        and sites. Annotation overlap and contact counts do not establish
        functional importance, affinity or mutation effects.
      </p>
    </section>
  );
}
