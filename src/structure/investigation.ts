import {
  refreshInvestigation,
  resolveInvestigation,
  type InvestigationWorkspace,
} from "../comparison/selection";
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
      ? [{ structure: side.structure, residueIds: side.residueIds }]
      : [],
  );
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
  clear() {
    useInvestigation.setState({ result: null });
    useExplorer.getState().selectResidue(null);
    this.viewer.select([]);
  }
  /** Re-applies the current selection in the scene (after a visibility or display change). */
  reapply(focus = false) {
    this.viewer.select(groups(useInvestigation.getState().result), focus);
  }
  private install(
    result: InvestigationResult,
    focus: boolean,
    highlight: boolean,
  ) {
    useInvestigation.setState({ result });
    this.visible = visibility(result);
    const reference =
      result.status === "resolved"
        ? (result.view.reference?.residueIds[0] ?? null)
        : null;
    if (useExplorer.getState().selectedResidueId !== reference)
      useExplorer.getState().selectResidue(reference);
    if (highlight) this.viewer.select(groups(result), focus);
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
      this.install(next, false, changed);
    });
  }
  dispose() {
    this.unsubscribe.forEach((u) => u());
  }
}
