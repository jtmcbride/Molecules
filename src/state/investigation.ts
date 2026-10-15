import { create } from "zustand";
import type { DrawnInteractions } from "../comparison/selection";
import type { InvestigationResult, ResidueTarget } from "../domain/selection";

/**
 * The persistent investigation (what the user selected, resolved against the workspace),
 * the interaction drawn on each side of a comparison investigation, and the transient
 * hover. The reference's `selectedResidueId` is a projection of the resolved reference
 * side; only the investigation controller writes any of these.
 */
interface InvestigationState {
  result: InvestigationResult | null;
  drawn: DrawnInteractions;
  hovered: ResidueTarget | null;
}

export const useInvestigation = create<InvestigationState>(() => ({
  result: null,
  drawn: { reference: null, comparison: null },
  hovered: null,
}));
