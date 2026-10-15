import { create } from "zustand";
import type { InvestigationResult, ResidueTarget } from "../domain/selection";

/**
 * The persistent investigation (what the user selected, resolved against the workspace) and
 * the transient hover. The reference's `selectedResidueId` is a projection of the resolved
 * reference side; only the investigation controller writes either.
 */
interface InvestigationState {
  result: InvestigationResult | null;
  hovered: ResidueTarget | null;
}

export const useInvestigation = create<InvestigationState>(() => ({
  result: null,
  hovered: null,
}));
