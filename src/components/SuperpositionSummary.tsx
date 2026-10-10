import { useEffect } from "react";
import { useExplorer } from "../state/explorer";
import type { ComparisonSlot } from "../state/comparison";
import type { SuperpositionScope } from "../domain/comparison";
import type { ExplorerController } from "../structure/controller";

/** Scope selector and fit statistics; refits whenever the fit's inputs change. */
export function SuperpositionSummary({
  slot,
  controller,
}: {
  slot: ComparisonSlot;
  controller: ExplorerController | null;
}) {
  const interpretation = useExplorer((s) => s.interpretation),
    target = useExplorer((s) => s.targetLigandId),
    group = useExplorer((s) => s.ligandGroupId);
  useEffect(() => {
    controller?.comparison.ensureSuperposition(slot.id);
  }, [
    controller,
    slot.id,
    slot.phase,
    slot.interpretation,
    slot.pairingOverrides,
    slot.superpositionScope,
    interpretation,
    target,
    group,
  ]);
  const fit = slot.superposition;
  return (
    <div className="comparison-superposition">
      <label className="comparison-ligand">
        Superposition
        <select
          aria-label={`Superposition of ${slot.label}`}
          value={slot.superpositionScope}
          onChange={(e) =>
            controller?.comparison.setSuperpositionScope(
              slot.id,
              e.target.value as SuperpositionScope,
            )
          }
        >
          <option value="global">All paired residues (Cα)</option>
          <option value="binding_site">
            Binding site: within 8 Å of the reference ligand
          </option>
          <option value="none">None: deposited coordinates</option>
        </select>
      </label>
      <p className="comparison-analysis-status" data-testid="comparison-fit">
        {slot.superpositionError
          ? slot.superpositionError
          : fit
            ? `Core RMSD ${fit.rmsdCore.toFixed(2)} Å over ${fit.fitted} of ${fit.total} Cα (${fit.cycles} rejection cycle${fit.cycles === 1 ? "" : "s"}) · all pairs ${fit.rmsdAll.toFixed(2)} Å`
            : slot.superpositionScope === "none"
              ? "Shown in its deposited coordinate frame."
              : slot.transform
                ? "Saved superposition shown; it is recomputed once residues are paired."
                : "Superposes once residues are paired."}
      </p>
    </div>
  );
}
