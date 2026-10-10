import { useState } from "react";
import { Eye, EyeOff, Layers, LoaderCircle, Play, Plus, X } from "lucide-react";
import { useExplorer } from "../state/explorer";
import { useComparison, type ComparisonSlot } from "../state/comparison";
import { MAX_COMPARISON_STRUCTURES } from "../domain/comparison";
import type { StructureSnapshot } from "../domain/types";
import type { ExplorerController } from "../structure/controller";
import { CorrespondenceSummary } from "./CorrespondenceSummary";
import { SuperpositionSummary } from "./SuperpositionSummary";
import { SiteDifferencesSummary } from "./SiteDifferencesSummary";
import { FingerprintMatrix } from "./FingerprintMatrix";

function ligandLabel(snapshot: StructureSnapshot, residueId: string) {
  const residue = snapshot.residues.find((r) => r.id === residueId);
  const chain = snapshot.chains.find((c) => c.id === residue?.chainId);
  return `${residue?.componentId ?? "?"} ${chain?.authAsymId ?? "?"}:${residue?.authSeqId ?? "?"}`;
}

function SlotRow({
  slot,
  controller,
}: {
  slot: ComparisonSlot;
  controller: ExplorerController | null;
}) {
  const comparison = controller?.comparison;
  const snapshot = slot.snapshot;
  const polymers = snapshot?.chains.filter((c) => c.type === "polymer") ?? [];
  const accessions = [
    ...new Set(slot.interpretation?.coverage.flatMap((c) => c.accessions)),
  ];
  const exact =
      slot.interpretation?.coverage.reduce((t, c) => t + c.exact, 0) ?? 0,
    total = slot.interpretation?.coverage.reduce((t, c) => t + c.total, 0) ?? 0;
  const chemical =
    slot.analysis?.interactions.filter(
      (i) => i.type !== "proximity_contact" && i.type !== "steric_clash",
    ).length ?? 0;
  return (
    <li
      className="comparison-slot"
      data-testid="comparison-slot"
      data-phase={slot.phase}
    >
      <div className="comparison-slot-heading">
        <span
          className="comparison-swatch"
          style={{ background: slot.color }}
          aria-hidden="true"
        />
        <strong>{slot.label}</strong>
        <span className="comparison-title">
          {slot.phase === "loading" && (
            <LoaderCircle size={13} className="spin" />
          )}
          {slot.status}
        </span>
        {slot.phase === "ready" && (
          <button
            className="icon-button"
            aria-label={`${slot.visible ? "Hide" : "Show"} ${slot.label}`}
            onClick={() => comparison?.setVisible(slot.id, !slot.visible)}
          >
            {slot.visible ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        )}
        <button
          className="icon-button"
          aria-label={`Remove ${slot.label}`}
          onClick={() => comparison?.remove(slot.id)}
        >
          <X size={15} />
        </button>
      </div>
      {slot.error && (
        <p className="comparison-error" role="alert">
          {slot.error}
        </p>
      )}
      {snapshot && (
        <div className="comparison-slot-body">
          <dl className="comparison-facts">
            <dt>Chains</dt>
            <dd>
              {polymers.map((c) => c.authAsymId).join(", ") || "none"} ·{" "}
              {snapshot.assemblyId
                ? `assembly ${snapshot.assemblyId}`
                : "asymmetric unit"}
            </dd>
            <dt>UniProt</dt>
            <dd data-testid="comparison-mapping">
              {slot.biologyPhase === "loading" && (
                <LoaderCircle size={12} className="spin" />
              )}
              {slot.interpretation
                ? `${accessions.join(", ") || "no accession"} · ${exact}/${total} residues exactly mapped${slot.biologyMode === "pinned" ? " · pinned" : ""}`
                : slot.biologyStatus || "Not loaded"}
            </dd>
          </dl>
          <CorrespondenceSummary slot={slot} controller={controller} />
          <SuperpositionSummary slot={slot} controller={controller} />
          <SiteDifferencesSummary slot={slot} />
          <div className="comparison-analysis">
            <label className="comparison-ligand">
              Ligand
              <select
                aria-label={`Comparison ligand for ${slot.label}`}
                value={
                  slot.ligandGroupId
                    ? `group:${slot.ligandGroupId}`
                    : (slot.targetLigandId ?? "")
                }
                onChange={(e) => comparison?.setLigand(slot.id, e.target.value)}
              >
                <option value="">
                  {snapshot.ligands.length
                    ? "No ligand"
                    : "No ligand available"}
                </option>
                {snapshot.ligands.map((l) => (
                  <option key={l.id} value={l.residueId}>
                    {ligandLabel(snapshot, l.residueId)}
                  </option>
                ))}
                {snapshot.ligandGroups?.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              disabled={
                !slot.targetLigandId ||
                slot.analysisPhase === "running" ||
                slot.analysisPhase === "queued"
              }
              onClick={() => void comparison?.analyze(slot.id)}
            >
              <Play size={13} /> Analyze
            </button>
          </div>
          <p className="comparison-analysis-status" role="status">
            {(slot.analysisPhase === "running" ||
              slot.analysisPhase === "queued") && (
              <LoaderCircle size={12} className="spin" />
            )}
            {slot.analysisPhase === "ready" && slot.analysis
              ? `${chemical} chemical interactions with ${slot.analysis.residues.length} residues · ${slot.analysisCached ? "cached" : "fresh"} · ${slot.analysis.ruleSetVersion}`
              : slot.analysisPhase === "error"
                ? slot.analysisError
                : slot.analysisPhase === "idle"
                  ? slot.targetLigandId
                    ? "Not analyzed. Uses the reference's analysis settings."
                    : "Choose a ligand to analyze, or compare without one."
                  : slot.analysisStatus}
          </p>
        </div>
      )}
    </li>
  );
}

export function ComparisonPanel({
  controller,
}: {
  controller: ExplorerController | null;
}) {
  const reference = {
      phase: useExplorer((s) => s.phase),
      source: useExplorer((s) => s.source),
    },
    slots = useComparison((s) => s.slots),
    notice = useComparison((s) => s.notice);
  const [input, setInput] = useState(""),
    [error, setError] = useState<string | null>(null);
  if (reference.phase !== "ready" && !slots.length) return null;
  const full = slots.length >= MAX_COMPARISON_STRUCTURES;
  const add = () => {
    setError(null);
    controller?.comparison
      .addPdb(input)
      .then(() => setInput(""))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  };
  return (
    <section
      className="comparison-panel panel"
      aria-label="Structure comparison"
    >
      <div className="panel-heading">
        <span>
          <Layers size={16} /> Structure comparison
        </span>
        <small>
          {slots.length}/{MAX_COMPARISON_STRUCTURES} · SIFTS-PAIRED
        </small>
      </div>
      <div className="comparison-content">
        <form
          className="comparison-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            aria-label="Comparison PDB ID"
            placeholder="PDB ID, e.g. 1S0R"
            value={input}
            maxLength={12}
            onChange={(e) => setInput(e.target.value)}
            disabled={full || reference.phase !== "ready"}
          />
          <button
            className="button secondary"
            type="submit"
            disabled={!input.trim() || full || reference.phase !== "ready"}
          >
            <Plus size={13} /> Add structure
          </button>
          {slots.some((s) => s.targetLigandId && s.phase === "ready") && (
            <button
              className="button secondary"
              type="button"
              onClick={() => controller?.comparison.analyzeAll()}
            >
              <Play size={13} /> Analyze all
            </button>
          )}
        </form>
        {error && (
          <p className="comparison-error" role="alert">
            {error}
          </p>
        )}
        {notice && <div className="quality-note">{notice}</div>}
        {!slots.length ? (
          <p className="small muted">
            Add deposited structures of the same protein to compare with{" "}
            {reference.source?.kind === "local"
              ? reference.source.name
              : reference.source?.id}
            . Residues are paired by UniProt position through SIFTS; each
            structure keeps its own coordinates, annotations and analysis.
          </p>
        ) : (
          <ul className="comparison-slots">
            {slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} controller={controller} />
            ))}
          </ul>
        )}
        <FingerprintMatrix />
      </div>
    </section>
  );
}
