import { slotSiteDifferences } from "../comparison/derived";
import { SITE_POLICY } from "../comparison/siteDifferences";
import { useExplorer } from "../state/explorer";
import type { ComparisonSlot } from "../state/comparison";

const SIGNIFICANCE = {
  within_coordinate_error: "within error",
  exceeds_coordinate_error: "beyond 2× DPI error",
  not_assessable: "not assessable",
} as const;

/** Per-residue shifts, torsion changes and site waters of a superposed comparison structure. */
export function SiteDifferencesSummary({ slot }: { slot: ComparisonSlot }) {
  const reference = {
    snapshot: useExplorer((s) => s.snapshot),
    interpretation: useExplorer((s) => s.interpretation),
    targetLigandId: useExplorer((s) => s.targetLigandId),
    ligandGroupId: useExplorer((s) => s.ligandGroupId),
  };
  const result = slotSiteDifferences(reference, slot);
  if (!result || !reference.snapshot || !slot.snapshot) return null;
  const residue = (id: string, inReference: boolean) => {
    const r = (inReference ? reference.snapshot : slot.snapshot)!.residues.find(
      (x) => x.id === id,
    );
    return r ? `${r.componentId} ${r.authSeqId ?? "?"}` : "?";
  };
  const f = (x?: number) => (x === undefined ? "–" : x.toFixed(2));
  const beyond = result.residues.filter(
    (r) => r.significance === "exceeds_coordinate_error",
  ).length;
  const conserved = result.referenceWaters.filter(
    (w) => w.status === "conserved",
  ).length;
  const overlapping = result.comparisonWaters.filter(
    (w) => w.overlapsReferenceLigand,
  ).length;
  const sigma = result.combinedCoordinateErrorAngstrom;
  return (
    <details className="comparison-site" data-testid="comparison-site">
      <summary>
        Binding site: {result.residues.length} paired residues
        {sigma !== undefined
          ? ` · ${beyond} shift beyond 2σ (σ ${sigma.toFixed(3)} Å)`
          : " · significance not assessable (coordinate error unknown)"}
        {` · ${result.residues.filter((r) => r.rotamerChange).length} rotamer changes · ${conserved}/${result.referenceWaters.length} waters conserved`}
      </summary>
      <p className="small muted">
        Residues within {SITE_POLICY.siteRadius} Å of either ligand, after
        superposition. σ combines both structures' Cruickshank DPI. It describes
        an atom with average B and leaves out fit error, so treat small shifts
        beyond 2σ with care. Rotamer change: a χ angle differs by more than{" "}
        {SITE_POLICY.rotamerChangeDegrees}°.
        {overlapping > 0 &&
          ` ${overlapping} comparison waters lie where the reference ligand binds.`}
      </p>
      <table className="comparison-site-table">
        <thead>
          <tr>
            <th>UniProt</th>
            <th>Reference</th>
            <th>Comparison</th>
            <th>Cα Å</th>
            <th>Side chain Å</th>
            <th>Δχ1/Δχ2 °</th>
            <th>Shift</th>
          </tr>
        </thead>
        <tbody>
          {result.residues.map((r) => (
            <tr
              key={r.referenceResidueId}
              className={
                r.significance === "exceeds_coordinate_error" || r.rotamerChange
                  ? "moved"
                  : ""
              }
            >
              <td>{r.uniprotPosition}</td>
              <td>{residue(r.referenceResidueId, true)}</td>
              <td>{residue(r.comparisonResidueId, false)}</td>
              <td>{f(r.caDisplacementAngstrom)}</td>
              <td>{f(r.sideChainRmsdAngstrom)}</td>
              <td>
                {r.chi.length
                  ? r.chi.map((c) => c.delta.toFixed(0)).join("/")
                  : "–"}
                {r.rotamerChange ? " rotamer" : ""}
              </td>
              <td>{SIGNIFICANCE[r.significance]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
