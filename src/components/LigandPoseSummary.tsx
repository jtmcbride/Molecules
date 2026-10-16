import { downloadWorkspaceComparison } from "../comparison/download";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { DEFAULT_POSE_OPTIONS } from "../domain/ligandPose";
import { poseAlternates, poseResidues } from "../comparison/poseContext";
import type { ComparisonSlot } from "../state/comparison";
import { useExplorer } from "../state/explorer";
import type { ExplorerController } from "../structure/controller";

/** A measurement in the selected protein frame, with its inspectable atom correspondence. */
export function LigandPoseSummary({
  slot,
  controller,
}: {
  slot: ComparisonSlot;
  controller: ExplorerController | null;
}) {
  const snapshot = useExplorer((s) => s.snapshot),
    target = useExplorer((s) => s.targetLigandId),
    group = useExplorer((s) => s.ligandGroupId),
    minimumOccupancy = useExplorer(
      (s) => s.analysisParameters.minimumOccupancy,
    );
  const [mapOpen, setMapOpen] = useState(false);
  const pose = slot.pose,
    options = pose?.options ?? DEFAULT_POSE_OPTIONS,
    client = controller?.comparison.pose;
  const referenceAlts = poseAlternates(
      snapshot,
      poseResidues(snapshot, target, group),
    ),
    comparisonAlts = poseAlternates(
      slot.snapshot,
      poseResidues(slot.snapshot, slot.targetLigandId, slot.ligandGroupId),
    );
  const busy =
    pose?.phase === "preparing" ||
    pose?.phase === "running" ||
    pose?.phase === "restoring";
  const result =
    pose?.phase === "ready" && pose.result?.status === "evaluated"
      ? pose.result
      : null;
  const conformer = (which: "reference" | "comparison", labels: string[]) => {
    const field =
      which === "reference" ? "referenceConformerId" : "comparisonConformerId";
    return (
      <label className="comparison-ligand">
        {which === "reference" ? "Reference conformer" : "Comparison conformer"}
        <select
          aria-label={`${which === "reference" ? "Reference" : "Comparison"} pose conformer for ${slot.label}`}
          value={options[field] ?? ""}
          disabled={!labels.length || pose?.phase === "restoring"}
          onChange={(e) =>
            client?.setOptions(slot.id, { [field]: e.target.value || null })
          }
        >
          <option value="">
            {labels.length ? "Choose one alternate" : "Shared atoms"}
          </option>
          {labels.map((label) => (
            <option key={label} value={label}>
              Shared + {label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <section
      className="ligand-pose"
      aria-label={`Ligand pose for ${slot.label}`}
      data-testid="ligand-pose"
      data-phase={pose?.phase ?? "idle"}
    >
      <div className="pose-heading">
        <h3>Ligand pose</h3>
        <span className="small muted">Heavy atoms · protein frame</span>
      </div>
      <div className="pose-conformers">
        {conformer("reference", referenceAlts)}
        {conformer("comparison", comparisonAlts)}
      </div>
      <p className="small muted">
        Occupancy &gt; {minimumOccupancy}. Uses the reference minimum-occupancy
        setting and the selected protein fit.
      </p>
      <div className="pose-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void client?.calculate(slot.id)}
        >
          {pose && pose.phase !== "idle"
            ? "Recalculate pose"
            : "Calculate pose"}
        </button>
        {busy && (
          <button
            className="button secondary"
            onClick={() => client?.cancel(slot.id)}
          >
            Cancel pose
          </button>
        )}
        {pose?.result && (
          <button
            className="button secondary"
            onClick={() => void downloadWorkspaceComparison()}
          >
            Export pose JSON
          </button>
        )}
      </div>
      <div role="status" className="pose-status">
        {busy && <LoaderCircle size={13} className="spin" />}
        {result ? (
          <>
            <p className="pose-score" data-testid="pose-rmsd">
              <strong>
                {result.rmsdAngstrom.toFixed(3)} <span>Å</span>
              </strong>
              <span>Symmetry-corrected RMSD</span>
            </p>
            <p className="small">
              {result.matchedAtoms} heavy atoms ·{" "}
              {result.fit.scope === "binding_site" ? "binding-site" : "global"}{" "}
              Cα fit · {result.admissibleMaps} permitted atom maps
            </p>
            <p className="small muted">
              Name-matched RMSD{" "}
              {result.nameMatchedRmsdAngstrom?.toFixed(3) ?? "unavailable"} Å.
              No additional ligand alignment.
            </p>
            <p className="small muted" data-testid="pose-mode">
              {pose?.mode === "pinned"
                ? "Restored exact saved result"
                : pose?.mode === "cached"
                  ? "Reused exact cached result"
                  : pose?.message}
            </p>
          </>
        ) : (
          <p className="small" data-testid="pose-status">
            {pose?.result?.status === "not_evaluated"
              ? `Not evaluated: ${pose.result.reason}`
              : (pose?.message ??
                "Calculate the selected ligands’ pose after choosing a protein superposition. Interaction analysis is optional.")}
          </p>
        )}
      </div>
      {result && (
        <>
          <details
            className="pose-map"
            onToggle={(e) => setMapOpen(e.currentTarget.open)}
          >
            <summary>Inspect {result.matchedAtoms} atom pairs</summary>
            {mapOpen && (
              <ol className="pose-pairs">
                {result.pairs.map((pair) => (
                  <li key={pair.referenceAtomId}>
                    <button
                      aria-label={`Inspect ${pair.referenceAtomName} to ${pair.comparisonAtomName}: ${pair.distanceAngstrom.toFixed(3)} angstrom`}
                      onClick={() =>
                        controller?.investigation.investigate(
                          {
                            kind: "pose_atom",
                            slotId: slot.id,
                            inputKey: result.inputKey,
                            referenceAtomId: pair.referenceAtomId,
                          },
                          { focus: true },
                        )
                      }
                    >
                      <span className="pose-reference-atom">
                        {pair.referenceAtomName}
                      </span>
                      <span aria-hidden="true">→</span>
                      <span className="pose-comparison-atom">
                        {pair.comparisonAtomName}
                      </span>
                      <strong>{pair.distanceAngstrom.toFixed(3)} Å</strong>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </details>
          <details className="pose-provenance">
            <summary>Chemistry and method</summary>
            <p className="small">
              Permitted atom swaps preserve the pinned definition’s charges,
              bond labels and stereochemistry. Resonance-equivalent
              terminal-group swaps are excluded.
            </p>
            <p className="small muted">
              Reference chemistry{" "}
              <code title={result.reference.chemistryHash}>
                {result.reference.chemistryHash.slice(0, 12)}
              </code>{" "}
              · comparison{" "}
              <code title={result.comparison.chemistryHash}>
                {result.comparison.chemistryHash.slice(0, 12)}
              </code>
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void client?.calculate(slot.id, true)}
            >
              Refresh chemistry and recalculate
            </button>
          </details>
        </>
      )}
    </section>
  );
}
