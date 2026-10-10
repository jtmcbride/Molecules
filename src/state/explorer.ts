import {
  DEFAULT_ANNOTATION_TYPES,
  type InterpretationSnapshot,
} from "../domain/biology";
import {
  DEFAULT_PARAMETERS,
  type AnalysisParameters,
  type AnalysisRun,
} from "../domain/analysis";
import { create } from "zustand";
import type {
  Representation,
  StructureOptions,
  StructureSnapshot,
  StructureSource,
} from "../domain/types";

interface ExplorerState {
  interpretation: InterpretationSnapshot | null;
  biologyPhase: "idle" | "loading" | "ready" | "error";
  biologyStatus: string;
  biologyError: string | null;
  biologyMode: "fresh" | "cached" | "stale" | "pinned" | null;
  biologyAssociation: string | null;
  selectedProteinAccession: string | null;
  annotationCategories: string[];
  selectedAnnotationId: string | null;
  biologySelectedLabel: number | null;
  evidenceIds: string[];
  source: StructureSource | null;
  snapshot: StructureSnapshot | null;
  options: StructureOptions;
  chainColors: Record<string, string>;
  selectedResidueId: string | null;
  activeChainId: string | null;
  modelIndex: number;
  assemblyId: string;
  representation: Representation;
  showWater: boolean;
  phase: "idle" | "fetching" | "parsing" | "ready" | "error";
  status: string;
  error: string | null;
  notice: string | null;
  analysis: AnalysisRun | null;
  analysisPhase: "idle" | "running" | "ready" | "error";
  analysisStatus: string;
  analysisError: string | null;
  analysisCached: boolean;
  targetLigandId: string | null;
  /** Ligand group analyzed as one ligand (glycan, BIRD, covalently linked residues). */
  ligandGroupId: string | null;
  /** Non-polymer residues (cofactors, ions) included as receptor endpoints. */
  receptorComponentIds: string[];
  receptorChainIds: string[];
  analysisParameters: AnalysisParameters;
  selectedInteractionId: string | null;
  selectResidue: (id: string | null) => void;
}
export const useExplorer = create<ExplorerState>((set, get) => ({
  interpretation: null,
  biologyPhase: "idle",
  biologyStatus: "",
  biologyError: null,
  biologyMode: null,
  biologyAssociation: null,
  selectedProteinAccession: null,
  annotationCategories: [...DEFAULT_ANNOTATION_TYPES],
  selectedAnnotationId: null,
  biologySelectedLabel: null,
  evidenceIds: [],
  analysis: null,
  analysisPhase: "idle",
  analysisStatus: "",
  analysisError: null,
  analysisCached: false,
  targetLigandId: null,
  ligandGroupId: null,
  receptorComponentIds: [],
  receptorChainIds: [],
  analysisParameters: { ...DEFAULT_PARAMETERS },
  selectedInteractionId: null,
  source: null,
  snapshot: null,
  options: { models: [], assemblies: [] },
  chainColors: {},
  selectedResidueId: null,
  activeChainId: null,
  modelIndex: 0,
  assemblyId: "",
  representation: "cartoon",
  showWater: false,
  phase: "idle",
  status: "Preparing workspace",
  error: null,
  notice: null,
  selectResidue: (id) => {
    const residue = get().snapshot?.residues.find((r) => r.id === id);
    const chain = get().snapshot?.chains.find((c) => c.id === residue?.chainId);
    set({
      selectedResidueId: id,
      biologySelectedLabel: residue?.labelSeqId ?? null,
      ...(chain?.type === "polymer" ? { activeChainId: chain.id } : {}),
    });
  },
}));
