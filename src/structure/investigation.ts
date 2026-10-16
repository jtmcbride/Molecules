import {
  drawnInteractions,
  refreshInvestigation,
  resolveInvestigation,
  type DrawnInteractions,
  type InvestigationWorkspace,
} from "../comparison/selection";
import type { MolecularInteraction } from "../domain/analysis";
import type {
  InvestigationRequest,
  InvestigationResult,
  ResidueTarget,
} from "../domain/selection";
import { useComparison } from "../state/comparison";
import { useExplorer } from "../state/explorer";
import { useInvestigation } from "../state/investigation";
import type { MolecularViewer, SelectionGroup } from "./adapter";

function workspace(): InvestigationWorkspace {
  const s = useExplorer.getState();
  return {
    reference: {
      snapshot: s.snapshot,
      interpretation: s.interpretation,
      analysis: s.analysis,
      targetLigandId: s.targetLigandId,
      ligandGroupId: s.ligandGroupId,
    },
    slots: useComparison.getState().slots,
  };
}

/** Residues of a result to select in the scene, per structure; hidden slots are left out. */
function groups(result: InvestigationResult | null): SelectionGroup[] {
  if (result?.status !== "resolved") return [];
  const hidden = new Set(
    useComparison
      .getState()
      .slots.filter((s) => !s.visible)
      .map((s) => s.id),
  );
  return [result.view.reference, result.view.comparison].flatMap((side) =>
    side?.residueIds.length &&
    !(side.structure.kind === "comparison" && hidden.has(side.structure.slotId))
      ? [
          {
            structure: side.structure,
            residueIds: side.residueIds,
            ...(side.atomIds ? { atomIds: side.atomIds } : {}),
          },
        ]
      : [],
  );
}

const NOT_CHEMICAL = new Set(["proximity_contact", "steric_clash"]);
/** Whether an interaction ID of either side's current analysis is a chemical interaction. */
function chemical(id: string) {
  const runs = [
    useExplorer.getState().analysis,
    ...useComparison.getState().slots.map((s) => s.analysis),
  ];
  for (const run of runs) {
    const interaction = run?.interactions.find((i) => i.id === id);
    if (interaction) return !NOT_CHEMICAL.has(interaction.type);
  }
  return false;
}

/** The chosen interactions of a comparison investigation, on visible structures only. */
function drawable(
  result: InvestigationResult | null,
  drawn: DrawnInteractions,
) {
  if (result?.status !== "resolved" || !result.view.slotId) return [];
  const slot = useComparison
    .getState()
    .slots.find((s) => s.id === result.view.slotId);
  const sides = [
    [result.view.reference, drawn.reference, useExplorer.getState().analysis],
    [result.view.comparison, drawn.comparison, slot?.analysis ?? null],
  ] as const;
  return sides.flatMap(([side, id, run]) => {
    if (!side || !id || side.interactions.status !== "evaluated") return [];
    if (side.structure.kind === "comparison" && !slot?.visible) return [];
    if (run?.cacheKey !== side.interactions.analysisCacheKey) return [];
    const interaction = run.interactions.find(
      (i: MolecularInteraction) => i.id === id,
    );
    return interaction ? [{ interaction, structure: side.structure }] : [];
  });
}

/** Visibility of the slot a result involves; a change re-applies the scene selection. */
function visibility(result: InvestigationResult | null) {
  const slotId = result?.status === "resolved" ? result.view.slotId : null;
  return slotId
    ? useComparison.getState().slots.find((s) => s.id === slotId)?.visible
    : undefined;
}

/**
 * The single writer of the persistent selection. Requests are resolved against the current
 * workspace; a workspace change re-resolves the installed request, or clears it when its
 * structure is gone. Inspecting a comparison never changes
 * the reference's ligand, receptor or analysis settings.
 */
export class InvestigationController {
  private visible: boolean | undefined;
  private pending = false;
  /** The interaction lines in the scene were drawn by this controller. */
  private drawing = false;
  private unsubscribe: (() => void)[] = [];
  constructor(private readonly viewer: MolecularViewer) {
    const refresh = () => this.refresh();
    this.unsubscribe.push(
      useExplorer.subscribe(refresh),
      useComparison.subscribe(refresh),
    );
  }
  investigate(
    request: InvestigationRequest,
    { focus = false, highlight = true } = {},
  ) {
    this.install(resolveInvestigation(request, workspace()), focus, highlight);
  }
  /** Selects a reference residue, or clears the investigation for null. */
  selectReference(residueId: string | null, focus = false, highlight = true) {
    const snapshot = useExplorer.getState().snapshot;
    if (!residueId || !snapshot) return this.clear();
    this.investigate(
      {
        kind: "residue",
        target: {
          structure: { kind: "reference", snapshotId: snapshot.id },
          residueId,
        },
      },
      { focus, highlight },
    );
  }
  selectTarget(target: ResidueTarget | null) {
    if (!target) return this.clear();
    this.investigate({ kind: "residue", target });
  }
  hover(target: ResidueTarget | null) {
    useInvestigation.setState({ hovered: target });
  }
  /** Draws another listed interaction of one side of the current comparison investigation. */
  chooseInteraction(side: keyof DrawnInteractions, id: string) {
    const { result, drawn } = useInvestigation.getState();
    const next = drawnInteractions(result, { ...drawn, [side]: id }, chemical);
    if (next[side] !== id) return;
    useInvestigation.setState({ drawn: next });
    this.draw();
  }
  clear() {
    useInvestigation.setState({
      result: null,
      drawn: drawnInteractions(null),
    });
    useExplorer.getState().selectResidue(null);
    this.viewer.select([]);
    this.draw();
  }
  /** Re-applies the current selection in the scene (after a visibility or display change). */
  reapply(focus = false) {
    this.viewer.select(groups(useInvestigation.getState().result), focus);
    this.draw();
  }
  /**
   * Draws the chosen interactions of a comparison investigation. Lines this controller did
   * not draw (an interaction selected in the analysis panel) are left alone.
   */
  private draw() {
    const { result, drawn } = useInvestigation.getState();
    if (
      result?.status === "resolved" &&
      result.view.posePair &&
      result.view.reference &&
      result.view.comparison
    ) {
      this.drawing = true;
      const slot = useComparison
        .getState()
        .slots.find((s) => s.id === result.view.slotId);
      if (slot?.visible)
        void this.viewer.drawPosePair(
          result.view.reference.structure,
          result.view.comparison.structure,
          result.view.posePair,
        );
      else this.viewer.clearInteractionLine();
      return;
    }
    const items = drawable(result, drawn);
    if (items.length) {
      this.drawing = true;
      void this.viewer.drawInteractions(items);
    } else if (this.drawing) {
      this.drawing = false;
      this.viewer.clearInteractionLine();
    }
  }
  private install(
    result: InvestigationResult,
    focus: boolean,
    highlight: boolean,
    keepDrawn = false,
  ) {
    // A refreshed result keeps the user's choice of drawn interactions where still listed.
    const drawn = drawnInteractions(
      result,
      keepDrawn ? useInvestigation.getState().drawn : null,
      chemical,
    );
    useInvestigation.setState({ result, drawn });
    this.visible = visibility(result);
    const reference =
      result.status === "resolved"
        ? (result.view.reference?.residueIds[0] ?? null)
        : null;
    if (useExplorer.getState().selectedResidueId !== reference)
      useExplorer.getState().selectResidue(reference);
    if (highlight) this.viewer.select(groups(result), focus);
    // Redrawn on every install: a refit moves the lines without changing residues.
    this.draw();
  }
  /**
   * Store notifications are coalesced into one deferred pass (a store update must not write
   * another store from inside its notification), which resolves against the latest state.
   */
  private refresh() {
    if (this.pending || !useInvestigation.getState().result) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      const current = useInvestigation.getState().result;
      if (!current) return;
      const next = refreshInvestigation(current, workspace());
      if (!next) return this.clear();
      if (next === current) {
        if (visibility(current) !== this.visible) {
          this.visible = visibility(current);
          this.reapply();
        }
        return;
      }
      // Re-select in the scene only when the resolved residues changed.
      const changed =
        JSON.stringify(groups(next)) !== JSON.stringify(groups(current)) ||
        visibility(next) !== this.visible;
      this.install(next, false, changed, true);
    });
  }
  dispose() {
    this.unsubscribe.forEach((u) => u());
  }
}
