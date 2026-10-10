import { create } from "zustand";
import type { AnalysisRun } from "../domain/analysis";
import type { InterpretationSnapshot } from "../domain/biology";
import type {
  ChainPairingOverride,
  RigidTransform,
} from "../domain/comparison";
import type { StructureSnapshot, StructureSource } from "../domain/types";

/**
 * One comparison structure. Its source, snapshot, interpretation and analysis are its own:
 * nothing is shared with the reference or with other slots.
 */
export interface ComparisonSlot {
  id: string;
  /** PDB ID or file name as entered. */
  label: string;
  color: string;
  visible: boolean;
  phase: "loading" | "ready" | "error";
  status: string;
  error: string | null;
  source: StructureSource | null;
  snapshot: StructureSnapshot | null;
  modelIndex: number;
  assemblyId: string;
  interpretation: InterpretationSnapshot | null;
  biologyPhase: "idle" | "loading" | "ready" | "error";
  biologyStatus: string;
  biologyMode: "fresh" | "cached" | "stale" | "pinned" | null;
  analysis: AnalysisRun | null;
  analysisPhase: "idle" | "queued" | "running" | "ready" | "error";
  analysisStatus: string;
  analysisError: string | null;
  analysisCached: boolean;
  targetLigandId: string | null;
  ligandGroupId: string | null;
  transform: RigidTransform | null;
  pairingOverrides: ChainPairingOverride[];
}

interface ComparisonState {
  slots: ComparisonSlot[];
  notice: string | null;
}

export const useComparison = create<ComparisonState>(() => ({
  slots: [],
  notice: null,
}));

/** Merges `patch` into slot `id` if it still exists. */
export function patchSlot(id: string, patch: Partial<ComparisonSlot>) {
  useComparison.setState((s) => ({
    slots: s.slots.map((slot) =>
      slot.id === id ? { ...slot, ...patch } : slot,
    ),
  }));
}
export function getSlot(id: string) {
  return useComparison.getState().slots.find((s) => s.id === id);
}
