import { create } from 'zustand';
import type { Representation, StructureOptions, StructureSnapshot, StructureSource } from '../domain/types';

interface ExplorerState {
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
  phase: 'idle' | 'fetching' | 'parsing' | 'ready' | 'error';
  status: string;
  error: string | null;
  notice: string | null;
  selectResidue: (id: string | null) => void;
}
export const useExplorer = create<ExplorerState>((set, get) => ({
  source: null, snapshot: null, options: { models: [], assemblies: [] }, chainColors: {},
  selectedResidueId: null, activeChainId: null, modelIndex: 0, assemblyId: '',
  representation: 'cartoon', showWater: false,
  phase: 'idle', status: 'Preparing workspace', error: null, notice: null,
  selectResidue: id => {
    const residue = get().snapshot?.residues.find(r => r.id === id);
    const chain = get().snapshot?.chains.find(c => c.id === residue?.chainId);
    set({ selectedResidueId: id, ...(chain?.type === 'polymer' ? { activeChainId: chain.id } : {}) });
  },
}));
