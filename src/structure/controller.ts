import { DEFAULT_PARAMETERS } from "../domain/analysis";
import { BiologyController } from "../biology/controller";
import { AnalysisClient } from "../analysis/client";
import { analysisKey } from "../analysis/engine";
import { loadChemicalDefinitions } from "../data/chemistry";
import { database } from "../data/repository";
import type { AnalysisParameters } from "../domain/analysis";
import { useExplorer } from "../state/explorer";
import type {
  Representation,
  SessionDescriptor,
  StructureSource,
} from "../domain/types";
import {
  cacheSource,
  getMetadata,
  loadLocalFile,
  loadPdb,
} from "../data/provider";
import { getLastSession, saveSession } from "../data/repository";
import type { MolecularViewer } from "./adapter";

export class ExplorerController {
  readonly biology = new BiologyController();
  private analysisGeneration = 0;
  private analysisAbort: AbortController | null = null;
  private analysisClient = new AnalysisClient();
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
      useExplorer.setState({
        representation: saved.descriptor.representation,
        showWater: saved.descriptor.showWater,
      });
      await this.load(() => Promise.resolve(saved.source), saved.descriptor);
    } else await this.openPdb("3PTB");
  }
  openPdb(id: string) {
    return this.load((signal) => loadPdb(id, signal));
  }
  openFile(file: File) {
    return this.load(() => loadLocalFile(file));
  }
  async setContext(modelIndex: number, assemblyId: string) {
    const source = useExplorer.getState().source;
    if (source)
      await this.load(() => Promise.resolve(source), {
        modelIndex,
        assemblyId,
      });
  }
  private async load(
    fetchSource: (signal: AbortSignal) => Promise<StructureSource>,
    restore?: Partial<SessionDescriptor>,
  ) {
    this.invalidateAnalysis();
    this.biology.cancel();
    const current = ++this.generation;
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    useExplorer.setState({
      phase: "fetching",
      status: "Loading coordinates",
      error: null,
      notice: null,
      snapshot: null,
      selectedResidueId: null,
      activeChainId: null,
    });
    try {
      let source = await fetchSource(signal);
      if (current !== this.generation) return;
      useExplorer.setState({
        phase: "parsing",
        status: "Building molecular scene",
      });
      const modelIndex = restore?.modelIndex ?? 0,
        assemblyId = restore?.assemblyId ?? "";
      const result = await this.enqueue(async () => {
        if (current !== this.generation) return null;
        const state = useExplorer.getState();
        return this.viewer.load(
          source,
          modelIndex,
          assemblyId,
          state.representation,
          state.showWater,
        );
      });
      if (current !== this.generation || !result) return;
      source = { ...source, metadata: source.metadata ?? result.metadata };
      const activeChainId = result.snapshot.chains.some(
        (c) => c.id === restore?.activeChainId,
      )
        ? restore!.activeChainId!
        : (result.snapshot.chains.find((c) => c.type === "polymer")?.id ??
          null);
      const selectedResidueId = result.snapshot.residues.some(
        (r) => r.id === restore?.selectedResidueId,
      )
        ? restore!.selectedResidueId!
        : null;
      useExplorer.setState({
        source,
        snapshot: result.snapshot,
        options: result.options,
        chainColors: result.chainColors,
        modelIndex,
        assemblyId,
        activeChainId,
        selectedResidueId,
        biologySelectedLabel:
          result.snapshot.residues.find((r) => r.id === selectedResidueId)
            ?.labelSeqId ?? null,
        targetLigandId:
          result.snapshot.ligands.find((l) => l.kind === "ligand")?.residueId ??
          result.snapshot.ligands[0]?.residueId ??
          null,
        receptorChainIds: result.snapshot.chains
          .filter((c) => c.type === "polymer")
          .map((c) => c.id),
        phase: "ready",
        status: "Structure ready",
      });
      this.viewer.selectResidue(selectedResidueId);
      void this.biology.initialize(source, result.snapshot, restore);
      const restoredAnalysisGeneration = this.analysisGeneration;
      if (restore?.analysisCacheKey) {
        void database.analyses
          .get(restore.analysisCacheKey)
          .then((run) => {
            if (
              current !== this.generation ||
              restoredAnalysisGeneration !== this.analysisGeneration ||
              run?.snapshotId !== result.snapshot.id
            )
              return;
            useExplorer.setState({
              analysis: run,
              analysisPhase: "ready",
              analysisCached: true,
              // Fields added by later rulesets take current defaults for new runs.
              analysisParameters: {
                ...DEFAULT_PARAMETERS,
                ...run.request.parameters,
              },
              targetLigandId: run.request.ligandResidueId,
              receptorChainIds: run.request.receptorChainIds,
            });
            void this.enqueue(async () => {
              if (
                current !== this.generation ||
                restoredAnalysisGeneration !== this.analysisGeneration
              )
                return;
              await this.viewer.showBindingSite([
                ...run.residues.map((r) => r.residueId),
                ...run.interactions.flatMap((i) =>
                  i.mediator ? [i.mediator.residueId] : [],
                ),
              ]);
            });
          })
          .catch(() => {});
      }
      await cacheSource(source).catch(() =>
        useExplorer.setState({
          notice:
            "Browser storage is unavailable. Exploration still works; this session will not be cached.",
        }),
      );
      if (current !== this.generation) return;
      if (source.kind === "pdb") {
        void getMetadata(source.id, signal)
          .then((metadata) => {
            if (current !== this.generation) return;
            const updated = { ...source, metadata };
            useExplorer.setState({ source: updated });
            void cacheSource(updated).catch(() => {});
          })
          .catch(() => {
            if (current === this.generation && !signal.aborted)
              useExplorer.setState({
                notice:
                  "Coordinates loaded. Remote metadata is unavailable; showing file metadata.",
              });
          });
      }
    } catch (error) {
      if (current !== this.generation) return;
      useExplorer.setState({
        phase: "error",
        status: "Unable to load structure",
        error:
          error instanceof Error
            ? error.message
            : "The structure could not be loaded.",
      });
    }
  }
  cancel() {
    this.biology.cancel();
    this.invalidateAnalysis();
    ++this.generation;
    this.abort?.abort();
    void this.enqueue(async () => {
      await this.viewer.plugin.clear();
    });
    useExplorer.setState({
      phase: "idle",
      status: "Loading cancelled",
      snapshot: null,
      selectedResidueId: null,
    });
  }
  select(id: string | null, focus = false) {
    useExplorer.setState({
      selectedInteractionId: null,
      selectedAnnotationId: null,
    });
    this.viewer.clearInteractionLine();
    useExplorer.getState().selectResidue(id);
    this.viewer.selectResidue(id, focus);
  }
  private invalidateAnalysis() {
    ++this.analysisGeneration;
    this.analysisAbort?.abort();
    this.analysisClient.cancel();
    useExplorer.setState({
      analysis: null,
      analysisPhase: "idle",
      analysisStatus: "",
      analysisError: null,
      analysisCached: false,
      selectedInteractionId: null,
    });
    this.viewer.clearInteractionLine();
    void this.enqueue(async () => {
      this.viewer.clearInteractionLine();
      await this.viewer.showBindingSite([]);
    });
  }
  cancelAnalysis() {
    this.invalidateAnalysis();
    useExplorer.setState({ analysisStatus: "Analysis cancelled." });
  }
  setAnalysisTarget(id: string) {
    this.invalidateAnalysis();
    useExplorer.setState({ targetLigandId: id });
  }
  setAnalysisParameters(parameters: Partial<AnalysisParameters>) {
    this.invalidateAnalysis();
    useExplorer.setState((s) => ({
      analysisParameters: { ...s.analysisParameters, ...parameters },
    }));
  }
  setReceptorChains(ids: string[]) {
    this.invalidateAnalysis();
    useExplorer.setState({ receptorChainIds: ids });
  }
  async runAnalysis() {
    const state = useExplorer.getState();
    if (
      state.phase !== "ready" ||
      !state.source ||
      !state.snapshot ||
      !state.targetLigandId
    )
      return;
    this.invalidateAnalysis();
    const current = this.analysisGeneration;
    const snapshot = state.snapshot,
      source = state.source;
    const request = {
      ligandResidueId: state.targetLigandId,
      receptorChainIds: [...state.receptorChainIds],
      parameters: { ...state.analysisParameters },
    };
    this.analysisAbort = new AbortController();
    const signal = this.analysisAbort.signal;
    const progress = (message: string) => {
      if (current === this.analysisGeneration)
        useExplorer.setState({ analysisStatus: message });
    };
    useExplorer.setState({
      analysisPhase: "running",
      analysisStatus: "Preparing chemical definitions",
      analysisError: null,
    });
    try {
      const definitions = await loadChemicalDefinitions(
        snapshot,
        request,
        signal,
      );
      if (current !== this.analysisGeneration) return;
      const key = analysisKey(snapshot, request, definitions);
      const cached = await database.analyses.get(key).catch(() => undefined);
      if (current !== this.analysisGeneration) return;
      const run =
        cached ??
        (await this.analysisClient.run(
          source,
          state.modelIndex,
          state.assemblyId,
          request,
          definitions,
          progress,
        ));
      if (current !== this.analysisGeneration) return;
      if (run.snapshotId !== snapshot.id)
        throw new Error(
          "Analysis coordinates do not match the displayed structure.",
        );
      if (!cached) {
        await database
          .transaction(
            "rw",
            database.analyses,
            database.chemicalDefinitions,
            async () => {
              await database.analyses.put(run);
              await database.chemicalDefinitions.bulkPut(
                definitions.filter((d) =>
                  run.chemistrySources.some(
                    (c) =>
                      c.source === "ccd" &&
                      c.componentId === d.componentId &&
                      c.contentHash === d.contentHash,
                  ),
                ),
              );
            },
          )
          .catch(() => {
            if (current === this.analysisGeneration)
              useExplorer.setState({
                notice:
                  "Analysis completed. Results could not be cached in browser storage.",
              });
          });
      }
      if (current !== this.analysisGeneration) return;
      useExplorer.setState({
        analysis: run,
        analysisPhase: "ready",
        analysisStatus: "Analysis ready",
        analysisCached: !!cached,
      });
      const sites = [
        ...run.residues.map((r) => r.residueId),
        ...run.interactions.flatMap((i) =>
          i.mediator ? [i.mediator.residueId] : [],
        ),
      ];
      await this.enqueue(async () => {
        if (current === this.analysisGeneration)
          await this.viewer.showBindingSite(sites);
      });
    } catch (error) {
      if (current !== this.analysisGeneration) return;
      useExplorer.setState({
        analysisPhase: "error",
        analysisError:
          error instanceof Error
            ? error.message
            : "Analysis could not be completed.",
        analysisStatus: "Analysis failed",
      });
    }
  }
  selectInteraction(id: string) {
    const interaction = useExplorer
      .getState()
      .analysis?.interactions.find((i) => i.id === id);
    if (!interaction) return;
    useExplorer.getState().selectResidue(interaction.receptor.residueId);
    useExplorer.setState({
      selectedInteractionId: id,
      selectedAnnotationId: null,
    });
    const generation = this.analysisGeneration;
    void this.enqueue(async () => {
      if (
        generation === this.analysisGeneration &&
        useExplorer.getState().selectedInteractionId === id
      )
        await this.viewer.selectInteraction(interaction);
    });
  }
  selectAnnotation(id: string) {
    const s = useExplorer.getState(),
      projection = s.interpretation?.projections.find(
        (p) => p.annotationId === id && p.chainInstanceId === s.activeChainId,
      );
    if (!projection) return;
    this.select(projection.residueIds[0] ?? null, true);
    const mapping = s.interpretation?.mappings.find(
      (m) =>
        m.chainInstanceId === s.activeChainId &&
        m.uniprotPosition === projection.unobservedPositions[0],
    );
    useExplorer.setState({
      selectedAnnotationId: id,
      biologySelectedLabel: projection.residueIds.length
        ? useExplorer.getState().biologySelectedLabel
        : (mapping?.labelSeqId ?? null),
    });
    this.viewer.selectResidues(projection.residueIds, true);
  }
  selectBiologyPosition(label: number) {
    const s = useExplorer.getState(),
      chain = s.snapshot?.chains.find((c) => c.id === s.activeChainId),
      position = chain?.sequence.find((p) => p.labelSeqId === label);
    this.select(position?.residueIds[0] ?? null, true);
    useExplorer.setState({ biologySelectedLabel: label });
  }
  focusSelection() {
    this.viewer.selectResidue(useExplorer.getState().selectedResidueId, true);
  }
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
      await saveSession({
        schemaVersion: 2,
        interpretationId: s.interpretation?.id,
        annotationCategories: s.annotationCategories,
        selectedProteinAccession: s.selectedProteinAccession,
        associationAccession: s.biologyAssociation ?? undefined,
        analysisCacheKey: s.analysis?.cacheKey,
        sourceHash: s.source.contentHash,
        modelIndex: s.modelIndex,
        assemblyId: s.assemblyId,
        selectedResidueId: s.selectedResidueId,
        activeChainId: s.activeChainId,
        representation: s.representation,
        showWater: s.showWater,
        savedAt: new Date().toISOString(),
      });
      useExplorer.setState({
        notice:
          "Session saved in this browser. It will reopen the next time you visit.",
      });
    } catch {
      useExplorer.setState({
        notice:
          "The session could not be saved. Browser storage may be full or disabled.",
      });
    }
  }
  dispose() {
    this.biology.cancel();
    ++this.analysisGeneration;
    this.analysisAbort?.abort();
    this.analysisClient.cancel();
    ++this.generation;
    this.abort?.abort();
    this.viewer.dispose();
  }
}
