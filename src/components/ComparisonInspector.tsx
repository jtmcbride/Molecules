import { ArrowUpRight, Crosshair, EyeOff } from "lucide-react";
import { slotCorrespondence } from "../comparison/derived";
import { pairedSequenceStrip } from "../comparison/sequenceStrip";
import type { DrawnInteractions } from "../comparison/selection";
import {
  cutoffMargin,
  distanceUncertainty,
  isBorderline,
} from "../analysis/uncertainty";
import {
  INTERACTION_COLORS,
  INTERACTION_LABELS,
  type AnalysisRun,
} from "../domain/analysis";
import {
  FINGERPRINT_MARGIN_ANGSTROM,
  type FingerprintCell,
  type FingerprintType,
} from "../domain/comparison";
import type { InvestigationSide, InvestigationView } from "../domain/selection";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import { useComparison } from "../state/comparison";
import { useExplorer } from "../state/explorer";
import { useInvestigation } from "../state/investigation";
import type { ExplorerController } from "../structure/controller";

const CELL: Record<FingerprintCell, string> = {
  present: "present",
  absent: "absent",
  not_evaluated: "not evaluated",
  not_observed: "not observed",
  not_comparable: "not comparable",
};
const SIGNIFICANCE = {
  within_coordinate_error: "within coordinate error",
  exceeds_coordinate_error: "beyond 2σ coordinate error",
  not_assessable: "not assessable (coordinate error unknown)",
} as const;

function residueText(snapshot: StructureSnapshot, residueId: string) {
  const residue = snapshot.residues.find((r) => r.id === residueId);
  const chain = snapshot.chains.find((c) => c.id === residue?.chainId);
  if (!residue || !chain) return "?";
  return `${residue.componentId} ${residue.authSeqId ?? "—"}${residue.insertionCode ?? ""} · chain ${chain.authAsymId}${snapshot.assemblyId ? ` · ${chain.operatorId}` : ""}`;
}

function shortResidue(snapshot: StructureSnapshot, residueId: string) {
  const residue = snapshot.residues.find((r) => r.id === residueId);
  const chain = snapshot.chains.find((c) => c.id === residue?.chainId);
  return residue
    ? `${residue.componentId} ${chain?.authAsymId ?? "?"}:${residue.authSeqId ?? "?"}${residue.insertionCode ?? ""}`
    : "?";
}

function sourceLabel(source: StructureSource | null | undefined) {
  return source?.kind === "local" ? source.name : (source?.id ?? "?");
}

/** Fingerprint state of one side, with how far a gained or lost cell is from its cutoff. */
function cellText(side: InvestigationSide) {
  if (!side.cell) return null;
  const change = side.change;
  const margins = [
    side.cell === "present" && change?.presentMarginAngstrom !== undefined
      ? `${change.presentMarginAngstrom.toFixed(2)} Å inside the cutoff`
      : null,
    side.cell === "absent" && change?.absentExcessAngstrom !== undefined
      ? `closest candidate atoms ${change.absentExcessAngstrom.toFixed(2)} Å beyond the cutoff`
      : null,
    change?.marginal
      ? `a change within ${FINGERPRINT_MARGIN_ANGSTROM} Å of the cutoff`
      : null,
  ].filter(Boolean);
  return `${CELL[side.cell]}${margins.length ? ` · ${margins.join(" · ")}` : ""}`;
}

/** The present side of a gained/lost cell carries the margins; copy them to the absent side. */
function withChange(
  side: InvestigationSide | null,
  other: InvestigationSide | null,
) {
  return side && !side.change && other?.change
    ? { ...side, change: other.change }
    : side;
}

function Side({
  title,
  side,
  snapshot,
  run,
  drawn,
  onChoose,
}: {
  title: string;
  side: InvestigationSide | null;
  snapshot: StructureSnapshot | null | undefined;
  run: AnalysisRun | null | undefined;
  drawn: string | null;
  onChoose: (id: string) => void;
}) {
  if (!side || !snapshot) return null;
  const interactions =
    side.interactions.status === "evaluated" &&
    run?.cacheKey === side.interactions.analysisCacheKey
      ? side.interactions.ids.flatMap((id) => {
          const i = run.interactions.find((x) => x.id === id);
          return i ? [i] : [];
        })
      : [];
  const sigma = distanceUncertainty(snapshot.quality);
  const cell = cellText(side);
  const atoms = (indices: number[]) =>
    indices.map((i) => snapshot.atoms[i].name).join(", ");
  return (
    <section className="investigation-side" aria-label={title}>
      <div className="field-label">{title}</div>
      <p className="investigation-residues">
        {side.residueIds.length
          ? side.residueIds.map((id) => residueText(snapshot, id)).join("; ")
          : side.unavailable}
      </p>
      {cell && (
        <p className="small" data-testid="investigation-cell">
          Fingerprint: {cell}
        </p>
      )}
      {side.interactions.status === "not_available" ? (
        <p className="small muted">{side.interactions.reason}</p>
      ) : !interactions.length ? (
        <p className="small muted">
          {side.cell
            ? "No interaction of this type in the current analysis; nothing is drawn."
            : "No interactions of this residue in the current analysis."}
        </p>
      ) : (
        <ul className="investigation-interactions">
          {interactions.map((i) => {
            const margin = run && cutoffMargin(i, run.request.parameters);
            return (
              <li key={i.id}>
                <button
                  className={`investigation-interaction${drawn === i.id ? " drawn" : ""}`}
                  aria-pressed={drawn === i.id}
                  onClick={() => onChoose(i.id)}
                >
                  <span
                    className="interaction-swatch"
                    style={{ background: INTERACTION_COLORS[i.type] }}
                    aria-hidden="true"
                  />
                  <strong>
                    {INTERACTION_LABELS[i.type]} ·{" "}
                    {i.distanceAngstrom.toFixed(2)} Å
                  </strong>
                  {drawn === i.id && <span className="drawn-tag">drawn</span>}
                  <small>
                    {shortResidue(snapshot, i.ligand.residueId)} (
                    {atoms(i.ligand.atomIndices)}) ↔{" "}
                    {shortResidue(snapshot, i.receptor.residueId)} (
                    {atoms(i.receptor.atomIndices)})
                    {i.mediator &&
                      ` · via ${shortResidue(snapshot, i.mediator.residueId)}`}
                  </small>
                  {margin !== undefined && margin !== null && (
                    <small>
                      {margin.toFixed(2)} Å inside its cutoff
                      {sigma !== undefined &&
                        isBorderline(i, run!.request.parameters, sigma) &&
                        ` · borderline (±${sigma.toFixed(2)} Å)`}
                    </small>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function rowType(view: InvestigationView): FingerprintType | null {
  if (view.request.kind !== "fingerprint") return null;
  try {
    const key = JSON.parse(view.request.rowKey) as unknown[];
    return key.at(-1) as FingerprintType;
  } catch {
    return null;
  }
}

/**
 * The current investigation when it involves a comparison structure: both sides' residues
 * and numbering, their exact SIFTS correspondence (or why there is none), the measured
 * differences and each side's interactions from its own current analysis. One interaction
 * per side is drawn (the nearest unless another is chosen); a missing bond is never drawn.
 */
export function ComparisonInspector({
  controller,
}: {
  controller: ExplorerController | null;
}) {
  const result = useInvestigation((s) => s.result),
    drawn = useInvestigation((s) => s.drawn);
  const slots = useComparison((s) => s.slots);
  const reference = useExplorer((s) => s.snapshot),
    referenceSource = useExplorer((s) => s.source),
    referenceRun = useExplorer((s) => s.analysis),
    interpretation = useExplorer((s) => s.interpretation);
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
  const correspondence =
    c && slotCorrespondence({ snapshot: reference, interpretation }, slot);
  const strip =
    c &&
    correspondence &&
    pairedSequenceStrip(correspondence, c, reference, slot.snapshot);
  const type = rowType(view);
  const choose = (side: keyof DrawnInteractions) => (id: string) =>
    controller?.investigation.chooseInteraction(side, id);
  const site = view.siteDifference;
  const f = (x?: number) => (x === undefined ? "–" : `${x.toFixed(2)} Å`);
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
      <h3 className="investigation-title">
        {view.request.kind === "fingerprint"
          ? `Fingerprint · ${type ? INTERACTION_LABELS[type] : "row"}`
          : view.request.kind === "site_difference"
            ? "Binding-site residue"
            : "Residue"}
      </h3>
      {!slot.visible && (
        <p className="quality-note">
          <EyeOff size={13} /> {slot.label} is hidden, so its residues are not
          highlighted in the 3D view.
        </p>
      )}
      {view.instanceAmbiguous && (
        <p className="quality-note">
          This row is keyed by component ID, which has several deposited
          instances. Every instance is listed and highlighted; none is singled
          out.
        </p>
      )}
      <dl className="property-list">
        <dt>Correspondence</dt>
        <dd>
          {c
            ? `${c.accession} ${c.uniprotPosition} · ${c.status.replaceAll("_", " ")} · exact SIFTS${c.residueChange ? ` · ${c.residueChange.reference} → ${c.residueChange.comparison}` : ""}`
            : (view.correspondenceUnavailable ?? "None")}
        </dd>
        {c?.reason && (
          <>
            <dt>Reason</dt>
            <dd>{c.reason}</dd>
          </>
        )}
      </dl>
      {strip && (
        <div
          className="sequence-strip"
          role="img"
          aria-label={`Deposited residues around UniProt ${c!.accession} ${c!.uniprotPosition}: reference ${strip.columns.map((x) => x.reference ?? "-").join("")}, ${slot.label} ${strip.columns.map((x) => x.comparison ?? "-").join("")}`}
          data-testid="sequence-strip"
        >
          {(["reference", "comparison"] as const).map((which) => (
            <div className="sequence-strip-row" key={which}>
              <span className="sequence-strip-label">
                {which === "reference"
                  ? sourceLabel(referenceSource)
                  : slot.label}
              </span>
              {strip.columns.map((col) => (
                <span
                  key={col.uniprotPosition}
                  className={`sequence-strip-cell ${col.status}${col.selected ? " selected" : ""}${col.differs ? " differs" : ""}`}
                  title={`UniProt ${col.uniprotPosition} · ${col.status.replaceAll("_", " ")}`}
                >
                  {col[which] ?? "-"}
                </span>
              ))}
            </div>
          ))}
          <small className="muted">
            UniProt {strip.columns[0].uniprotPosition}–
            {strip.columns.at(-1)!.uniprotPosition} · exact SIFTS mappings only;
            - has no observed residue
          </small>
        </div>
      )}
      {site && (
        <dl className="property-list" data-testid="investigation-site">
          <dt>Cα shift</dt>
          <dd>{f(site.caDisplacementAngstrom)}</dd>
          <dt>Side chain RMSD</dt>
          <dd>
            {f(site.sideChainRmsdAngstrom)} · {site.matchedSideChainAtoms}{" "}
            matched atoms
          </dd>
          <dt>Δχ</dt>
          <dd>
            {site.chi.length
              ? site.chi
                  .map((x) => `χ${x.index} ${x.delta.toFixed(0)}°`)
                  .join(" · ")
              : "–"}
            {site.rotamerChange ? " · rotamer change" : ""}
          </dd>
          <dt>Shift</dt>
          <dd>{SIGNIFICANCE[site.significance]}</dd>
        </dl>
      )}
      <Side
        title={`Reference · ${sourceLabel(referenceSource)}`}
        side={withChange(view.reference, view.comparison)}
        snapshot={reference}
        run={referenceRun}
        drawn={drawn.reference}
        onChoose={choose("reference")}
      />
      <Side
        title={slot.label}
        side={view.comparison}
        snapshot={slot.snapshot}
        run={slot.analysis}
        drawn={drawn.comparison}
        onChoose={choose("comparison")}
      />
      <div className="investigation-actions">
        <button
          className="button secondary"
          onClick={() => controller?.investigation.reapply(true)}
          disabled={!slot.visible && !view.reference?.residueIds.length}
        >
          <Crosshair size={14} /> Focus in 3D
        </button>
        {c && (
          <a
            className="source-link"
            href={`https://www.uniprot.org/uniprotkb/${c.accession}/entry`}
            target="_blank"
            rel="noreferrer"
          >
            UniProt {c.accession} <ArrowUpRight size={13} />
          </a>
        )}
        {slot.source?.kind !== "local" && (
          <a
            className="source-link"
            href={`https://www.rcsb.org/structure/${slot.label}`}
            target="_blank"
            rel="noreferrer"
          >
            {slot.label} at RCSB PDB <ArrowUpRight size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
