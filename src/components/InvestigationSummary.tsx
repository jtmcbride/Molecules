import { EyeOff } from "lucide-react";
import type { InvestigationSide } from "../domain/selection";
import type { StructureSnapshot } from "../domain/types";
import { useComparison } from "../state/comparison";
import { useExplorer } from "../state/explorer";
import { useInvestigation } from "../state/investigation";

function residueLabel(snapshot: StructureSnapshot, residueId: string) {
  const residue = snapshot.residues.find((r) => r.id === residueId);
  const chain = snapshot.chains.find((c) => c.id === residue?.chainId);
  if (!residue || !chain) return "?";
  return `${residue.componentId} ${residue.authSeqId ?? "—"}${residue.insertionCode ?? ""} · chain ${chain.authAsymId}${snapshot.assemblyId ? ` · ${chain.operatorId}` : ""}`;
}

function SideFacts({
  side,
  snapshot,
}: {
  side: InvestigationSide;
  snapshot: StructureSnapshot;
}) {
  return (
    <dd>
      {side.residueIds.length
        ? side.residueIds.map((id) => residueLabel(snapshot, id)).join("; ")
        : side.unavailable}
      <small>
        {side.interactions.status === "evaluated"
          ? `${side.interactions.ids.length} interactions in the current analysis`
          : side.interactions.reason}
      </small>
    </dd>
  );
}

/**
 * The current selection when it involves a comparison structure: its residue, the exactly
 * corresponding reference residue (or why there is none), and their analyses.
 */
export function InvestigationSummary() {
  const result = useInvestigation((s) => s.result);
  const slots = useComparison((s) => s.slots);
  const reference = useExplorer((s) => s.snapshot);
  if (!result) return null;
  if (result.status === "unavailable")
    return (
      <div className="investigation" data-testid="investigation">
        <p className="small muted">{result.reason}</p>
      </div>
    );
  const { view } = result;
  const slot = slots.find((s) => s.id === view.slotId);
  if (!slot?.snapshot || !reference || !view.comparison) return null;
  const c = view.correspondence;
  return (
    <div className="investigation" data-testid="investigation">
      <div className="eyebrow">
        <span
          className="comparison-swatch"
          style={{ background: slot.color }}
          aria-hidden="true"
        />{" "}
        COMPARISON · {slot.label}
      </div>
      {!slot.visible && (
        <p className="quality-note">
          <EyeOff size={13} /> {slot.label} is hidden, so its residues are not
          highlighted in the 3D view.
        </p>
      )}
      <dl className="property-list">
        <dt>{slot.label}</dt>
        <SideFacts side={view.comparison} snapshot={slot.snapshot} />
        <dt>Reference</dt>
        {view.reference && (
          <SideFacts side={view.reference} snapshot={reference} />
        )}
        <dt>Correspondence</dt>
        <dd>
          {c
            ? `${c.accession} ${c.uniprotPosition} · ${c.status.replaceAll("_", " ")} · exact SIFTS${c.residueChange ? ` · ${c.residueChange.reference} → ${c.residueChange.comparison}` : ""}`
            : (view.correspondenceUnavailable ?? "None")}
        </dd>
      </dl>
    </div>
  );
}
