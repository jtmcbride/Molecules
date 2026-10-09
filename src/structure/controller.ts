import { useExplorer } from '../state/explorer';
import type { Representation, SessionDescriptor, StructureSource } from '../domain/types';
import { cacheSource, getMetadata, loadLocalFile, loadPdb } from '../data/provider';
import { getLastSession, saveSession } from '../data/repository';
import type { MolecularViewer } from './adapter';

export class ExplorerController {
  private generation = 0;
  private abort: AbortController | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly viewer: MolecularViewer) {}
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(job);
    this.queue = operation.catch(() => {});
    return operation;
  }
  async initialize() {
    const saved = await getLastSession().catch(() => null);
    if (saved) {
      useExplorer.setState({ representation: saved.descriptor.representation, showWater: saved.descriptor.showWater });
      await this.load(() => Promise.resolve(saved.source), saved.descriptor);
    } else await this.openPdb('3PTB');
  }
  openPdb(id: string) { return this.load(signal => loadPdb(id, signal)); }
  openFile(file: File) { return this.load(() => loadLocalFile(file)); }
  async setContext(modelIndex: number, assemblyId: string) {
    const source = useExplorer.getState().source;
    if (source) await this.load(() => Promise.resolve(source), { modelIndex, assemblyId });
  }
  private async load(fetchSource: (signal: AbortSignal) => Promise<StructureSource>, restore?: Partial<SessionDescriptor>) {
    const current = ++this.generation;
    this.abort?.abort(); this.abort = new AbortController();
    const signal = this.abort.signal;
    useExplorer.setState({ phase: 'fetching', status: 'Loading coordinates', error: null, notice: null, snapshot: null, selectedResidueId: null, activeChainId: null });
    try {
      let source = await fetchSource(signal);
      if (current !== this.generation) return;
      useExplorer.setState({ phase: 'parsing', status: 'Building molecular scene' });
      const modelIndex = restore?.modelIndex ?? 0, assemblyId = restore?.assemblyId ?? '';
      const result = await this.enqueue(async () => {
        if (current !== this.generation) return null;
        const state = useExplorer.getState();
        return this.viewer.load(source, modelIndex, assemblyId, state.representation, state.showWater);
      });
      if (current !== this.generation || !result) return;
      source = { ...source, metadata: source.metadata ?? result.metadata };
      const activeChainId = result.snapshot.chains.some(c => c.id === restore?.activeChainId) ? restore!.activeChainId! : result.snapshot.chains.find(c => c.type === 'polymer')?.id ?? null;
      const selectedResidueId = result.snapshot.residues.some(r => r.id === restore?.selectedResidueId) ? restore!.selectedResidueId! : null;
      useExplorer.setState({ source, snapshot: result.snapshot, options: result.options, chainColors: result.chainColors, modelIndex, assemblyId, activeChainId, selectedResidueId, phase: 'ready', status: 'Structure ready' });
      this.viewer.selectResidue(selectedResidueId);
      await cacheSource(source).catch(() => useExplorer.setState({ notice: 'Browser storage is unavailable. Exploration still works; this session will not be cached.' }));
      if (current !== this.generation) return;
      if (source.kind === 'pdb') {
        void getMetadata(source.id, signal).then(metadata => {
          if (current !== this.generation) return;
          const updated = { ...source, metadata };
          useExplorer.setState({ source: updated });
          void cacheSource(updated).catch(() => {});
        }).catch(() => {
          if (current === this.generation && !signal.aborted) useExplorer.setState({ notice: 'Coordinates loaded. Remote metadata is unavailable; showing file metadata.' });
        });
      }
    } catch (error) {
      if (current !== this.generation) return;
      useExplorer.setState({ phase: 'error', status: 'Unable to load structure', error: error instanceof Error ? error.message : 'The structure could not be loaded.' });
    }
  }
  cancel() {
    ++this.generation; this.abort?.abort();
    void this.enqueue(async () => { await this.viewer.plugin.clear(); });
    useExplorer.setState({ phase: 'idle', status: 'Loading cancelled', snapshot: null, selectedResidueId: null });
  }
  select(id: string | null, focus = false) {
    useExplorer.getState().selectResidue(id);
    this.viewer.selectResidue(id, focus);
  }
  focusSelection() { this.viewer.selectResidue(useExplorer.getState().selectedResidueId, true); }
  async setRepresentation(representation: Representation) {
    useExplorer.setState({ representation });
    await this.enqueue(() => this.viewer.setRepresentation(representation));
    this.viewer.selectResidue(useExplorer.getState().selectedResidueId);
  }
  async setWater(showWater: boolean) {
    useExplorer.setState({ showWater });
    await this.enqueue(() => this.viewer.setWater(showWater));
  }
  async save() {
    const s = useExplorer.getState();
    if (!s.snapshot || !s.source) return;
    try {
      await cacheSource(s.source);
      await saveSession({ schemaVersion: 1, sourceHash: s.source.contentHash, modelIndex: s.modelIndex, assemblyId: s.assemblyId, selectedResidueId: s.selectedResidueId, activeChainId: s.activeChainId, representation: s.representation, showWater: s.showWater, savedAt: new Date().toISOString() });
      useExplorer.setState({ notice: 'Session saved in this browser. It will reopen the next time you visit.' });
    } catch { useExplorer.setState({ notice: 'The session could not be saved. Browser storage may be full or disabled.' }); }
  }
  dispose() { ++this.generation; this.abort?.abort(); this.viewer.dispose(); }
}
