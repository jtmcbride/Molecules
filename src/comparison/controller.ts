import { AnalysisClient } from "../analysis/client";
import { analysisKey } from "../analysis/engine";
import { loadInterpretation } from "../biology/load";
import { loadChemicalDefinitions } from "../data/chemistry";
import { loadLocalFile, loadPdb, normalizeAccession } from "../data/provider";
import {
  cacheSource,
  database,
  getSourceByHash,
  saveAnalysis,
} from "../data/repository";
import type { AnalysisRequest } from "../domain/analysis";
import {
  MAX_COMPARISON_STRUCTURES,
  type ChainPairingOverride,
  type ComparisonMemberDescriptor,
  type RigidTransform,
} from "../domain/comparison";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import { getSlot, patchSlot, useComparison } from "../state/comparison";
import type { ComparisonSlot } from "../state/comparison";
import { useExplorer } from "../state/explorer";
import type { MolecularViewer } from "../structure/adapter";
import { slotCorrespondence } from "./derived";

const COLORS = [
  "#f2a65a",
  "#c792ea",
  "#7fdbca",
  "#f78c6c",
  "#82aaff",
  "#ffcb6b",
  "#ff7a93",
];

type Enqueue = <T>(job: () => Promise<T>) => Promise<T>;

/** A ligand residue ID, or `group:<id>` for a multi-residue ligand group. */
function ligandChoice(snapshot: StructureSnapshot, value: string | null) {
  if (!value) return { targetLigandId: null, ligandGroupId: null };
  const group = value.startsWith("group:")
    ? snapshot.ligandGroups?.find((g) => g.id === value.slice(6))
    : undefined;
  if (group)
    return { targetLigandId: group.residueIds[0], ligandGroupId: group.id };
  return snapshot.ligands.some((l) => l.residueId === value)
    ? { targetLigandId: value, ligandGroupId: null }
    : { targetLigandId: null, ligandGroupId: null };
}

/**
 * Default comparison ligand: an instance of the reference target's component when present,
 * otherwise the first non-ion ligand. It is a starting choice the user can change.
 */
function defaultLigand(snapshot: StructureSnapshot) {
  const reference = useExplorer.getState();
  const component = reference.snapshot?.residues.find(
    (r) => r.id === reference.targetLigandId,
  )?.componentId;
  const residues = new Map(snapshot.residues.map((r) => [r.id, r]));
  return (
    snapshot.ligands.find(
      (l) => component && residues.get(l.residueId)?.componentId === component,
    )?.residueId ??
    snapshot.ligands.find((l) => l.kind === "ligand")?.residueId ??
    null
  );
}

/**
 * Loads and analyzes comparison structures. Each slot has its own generation and abort
 * controller: cancelling, failing or removing one never touches another slot or the
 * reference. Analyses run one at a time. Viewer changes go through the reference
 * controller's queue so scene updates stay serialized.
 */
export class ComparisonController {
  private epoch = 0;
  private generations = new Map<string, number>();
  private aborts = new Map<string, AbortController>();
  private analysisClient = new AnalysisClient();
  private analysisQueue: Promise<unknown> = Promise.resolve();
  private analyzing: string | null = null;
  private analysisGenerations = new Map<string, number>();
  constructor(
    private readonly viewer: MolecularViewer,
    private readonly enqueue: Enqueue,
  ) {}

  /** Content hashes of loaded comparison sources (protected from cache eviction). */
  openHashes() {
    return useComparison
      .getState()
      .slots.flatMap((s) => (s.source ? [s.source.contentHash] : []));
  }
  descriptors(): ComparisonMemberDescriptor[] {
    return useComparison.getState().slots.flatMap((s) =>
      s.phase === "ready" && s.source
        ? [
            {
              sourceHash: s.source.contentHash,
              modelIndex: s.modelIndex,
              assemblyId: s.assemblyId,
              targetLigandId: s.targetLigandId,
              ligandGroupId: s.ligandGroupId,
              analysisCacheKey: s.analysis?.cacheKey,
              interpretationId: s.interpretation?.id,
              visible: s.visible,
              ...(s.transform ? { transform: s.transform } : {}),
              ...(s.pairingOverrides.length
                ? { pairingOverrides: s.pairingOverrides }
                : {}),
            },
          ]
        : [],
    );
  }
  private bump(id: string) {
    const next = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, next);
    return next;
  }
  private alive(id: string, generation: number, epoch: number) {
    return (
      epoch === this.epoch &&
      this.generations.get(id) === generation &&
      !!getSlot(id)
    );
  }
  /**
   * Removes every comparison structure. `fromViewer` is false when the reference reload is
   * about to clear the whole scene anyway.
   */
  clear(notice: string | null = null, fromViewer = true) {
    const slots = useComparison.getState().slots;
    ++this.epoch;
    this.aborts.forEach((a) => a.abort());
    this.aborts.clear();
    this.generations.clear();
    if (this.analyzing) this.analysisClient.cancel();
    this.analyzing = null;
    useComparison.setState({
      slots: [],
      notice: slots.length ? notice : null,
    });
    if (fromViewer)
      for (const slot of slots)
        void this.enqueue(() => this.viewer.removeMember(slot.id));
  }
  addPdb(input: string) {
    const id = normalizeAccession(input);
    return this.add(id, (signal) => loadPdb(id, signal));
  }
  addFile(file: File) {
    return this.add(file.name, () => loadLocalFile(file));
  }
  restore(descriptors: ComparisonMemberDescriptor[]) {
    for (const descriptor of descriptors.slice(0, MAX_COMPARISON_STRUCTURES))
      void this.add(
        "Saved structure",
        async () => {
          const source = await getSourceByHash(descriptor.sourceHash).catch(
            () => undefined,
          );
          if (!source)
            throw new Error(
              "This saved comparison structure is no longer in browser storage.",
            );
          return source;
        },
        descriptor,
      );
  }
  private async add(
    label: string,
    fetchSource: (signal: AbortSignal) => Promise<StructureSource>,
    restore?: ComparisonMemberDescriptor,
  ) {
    const reference = useExplorer.getState();
    if (reference.phase !== "ready" || !reference.snapshot)
      throw new Error("Load a reference structure first.");
    const slots = useComparison.getState().slots;
    if (slots.length >= MAX_COMPARISON_STRUCTURES)
      throw new Error(
        `At most ${MAX_COMPARISON_STRUCTURES} comparison structures can be open.`,
      );
    const id = crypto.randomUUID(),
      epoch = this.epoch,
      generation = this.bump(id),
      abort = new AbortController();
    this.aborts.set(id, abort);
    const used = new Set(slots.map((s) => s.color));
    const slot: ComparisonSlot = {
      id,
      label,
      color: COLORS.find((c) => !used.has(c)) ?? COLORS[0],
      visible: restore?.visible ?? true,
      phase: "loading",
      status: "Loading coordinates",
      error: null,
      source: null,
      snapshot: null,
      modelIndex: restore?.modelIndex ?? 0,
      assemblyId: restore?.assemblyId ?? "",
      interpretation: null,
      biologyPhase: "idle",
      biologyStatus: "",
      biologyMode: null,
      analysis: null,
      analysisPhase: "idle",
      analysisStatus: "",
      analysisError: null,
      analysisCached: false,
      targetLigandId: null,
      ligandGroupId: null,
      transform: restore?.transform ?? null,
      pairingOverrides: restore?.pairingOverrides ?? [],
    };
    useComparison.setState((s) => ({
      slots: [...s.slots, slot],
      notice: null,
    }));
    try {
      const source = await fetchSource(abort.signal);
      if (!this.alive(id, generation, epoch)) return;
      patchSlot(id, {
        label: source.kind === "local" ? source.name : source.id,
        status: "Building molecular scene",
      });
      const result = await this.enqueue(async () => {
        if (!this.alive(id, generation, epoch)) return null;
        const added = await this.viewer.addMember(
          id,
          source,
          slot.modelIndex,
          slot.assemblyId,
          slot.color,
        );
        if (!this.alive(id, generation, epoch)) {
          await this.viewer.removeMember(id);
          return null;
        }
        if (!slot.visible) await this.viewer.setMemberVisibility(id, false);
        if (slot.transform)
          await this.viewer.setMemberTransform(id, slot.transform);
        return added;
      });
      if (!result || !this.alive(id, generation, epoch)) return;
      const choice = restore
        ? ligandChoice(
            result.snapshot,
            restore.ligandGroupId
              ? `group:${restore.ligandGroupId}`
              : restore.targetLigandId,
          )
        : ligandChoice(result.snapshot, defaultLigand(result.snapshot));
      patchSlot(id, {
        phase: "ready",
        status: result.title,
        source: {
          ...source,
          metadata: source.metadata ?? { title: result.title },
        },
        snapshot: result.snapshot,
        ...choice,
      });
      void cacheSource(source, [
        ...this.openHashes(),
        ...(useExplorer.getState().source
          ? [useExplorer.getState().source!.contentHash]
          : []),
      ]).catch(() => {});
      void this.initializeBiology(id, generation, epoch, restore);
      if (restore?.analysisCacheKey)
        void this.restoreAnalysis(id, restore.analysisCacheKey, epoch);
    } catch (error) {
      if (!this.alive(id, generation, epoch)) return;
      patchSlot(id, {
        phase: "error",
        status: "Unable to load structure",
        error:
          error instanceof Error
            ? error.message
            : "The structure could not be loaded.",
      });
    }
  }
  remove(id: string) {
    if (!getSlot(id)) return;
    this.bump(id);
    this.aborts.get(id)?.abort();
    this.aborts.delete(id);
    if (this.analyzing === id) {
      this.analysisClient.cancel();
      this.analyzing = null;
    }
    useComparison.setState((s) => ({
      slots: s.slots.filter((slot) => slot.id !== id),
    }));
    void this.enqueue(() => this.viewer.removeMember(id));
  }
  setVisible(id: string, visible: boolean) {
    patchSlot(id, { visible });
    void this.enqueue(() => this.viewer.setMemberVisibility(id, visible));
  }
  setTransform(id: string, transform: RigidTransform | null) {
    patchSlot(id, { transform });
    void this.enqueue(() => this.viewer.setMemberTransform(id, transform));
  }
  /** Overrides the comparison partner of one reference chain (null: leave it unpaired). */
  setPairing(id: string, override: ChainPairingOverride) {
    const slot = getSlot(id);
    if (!slot) return;
    this.invalidateAnalysis(id);
    patchSlot(id, {
      pairingOverrides: [
        ...slot.pairingOverrides.filter(
          (o) =>
            o.accession !== override.accession ||
            o.referenceChainId !== override.referenceChainId,
        ),
        override,
      ],
    });
  }
  resetPairings(id: string) {
    if (!getSlot(id)?.pairingOverrides.length) return;
    this.invalidateAnalysis(id);
    patchSlot(id, { pairingOverrides: [] });
  }
  setLigand(id: string, value: string) {
    const slot = getSlot(id);
    if (!slot?.snapshot) return;
    this.invalidateAnalysis(id);
    patchSlot(id, ligandChoice(slot.snapshot, value));
  }
  private invalidateAnalysis(id: string) {
    if (this.analyzing === id) {
      this.analysisClient.cancel();
      this.analyzing = null;
    }
    this.analysisGenerations.set(
      id,
      (this.analysisGenerations.get(id) ?? 0) + 1,
    );
    patchSlot(id, {
      analysis: null,
      analysisPhase: "idle",
      analysisStatus: "",
      analysisError: null,
      analysisCached: false,
    });
  }
  private async initializeBiology(
    id: string,
    generation: number,
    epoch: number,
    restore?: ComparisonMemberDescriptor,
  ) {
    if (restore) {
      // Pinned rule: a restored session never refetches biological sources.
      const interpretation = restore.interpretationId
        ? await database.interpretations
            .get(restore.interpretationId)
            .catch(() => undefined)
        : undefined;
      if (!this.alive(id, generation, epoch)) return;
      const snapshot = getSlot(id)?.snapshot;
      if (interpretation && interpretation.snapshotId === snapshot?.id)
        patchSlot(id, {
          interpretation,
          biologyPhase: "ready",
          biologyStatus: "Restored pinned interpretation",
          biologyMode: "pinned",
        });
      else
        patchSlot(id, {
          biologyPhase: restore.interpretationId ? "error" : "idle",
          biologyStatus: restore.interpretationId
            ? "The saved interpretation is unavailable. Load annotations to create a new one."
            : "",
        });
      return;
    }
    await this.loadBiology(id);
  }
  /** Loads (or refreshes) SIFTS/UniProt interpretation for one comparison structure. */
  async loadBiology(id: string, refresh = false) {
    const slot = getSlot(id);
    if (!slot?.source || !slot.snapshot) return;
    if (slot.source.kind === "local") {
      patchSlot(id, {
        biologyStatus:
          "No validated protein mapping for a local file, so it cannot be paired with the reference.",
      });
      return;
    }
    const epoch = this.epoch,
      generation = this.generations.get(id)!,
      signal = this.aborts.get(id)!.signal,
      source = slot.source,
      snapshot = slot.snapshot;
    patchSlot(id, {
      biologyPhase: "loading",
      biologyStatus: "Loading residue correspondence",
    });
    try {
      const result = await loadInterpretation(
        source,
        snapshot,
        source.id.toUpperCase(),
        signal,
        refresh,
        (message) => {
          if (this.alive(id, generation, epoch))
            patchSlot(id, { biologyStatus: message });
        },
      );
      if (!this.alive(id, generation, epoch)) return;
      patchSlot(id, {
        interpretation: result.interpretation,
        biologyPhase: "ready",
        biologyStatus: "Residue correspondence ready",
        biologyMode: result.mode as "fresh" | "cached" | "stale",
      });
    } catch (error) {
      if (!this.alive(id, generation, epoch) || signal.aborted) return;
      patchSlot(id, {
        biologyPhase: "error",
        biologyStatus:
          error instanceof Error ? error.message : "Annotations unavailable",
      });
    }
  }
  private async restoreAnalysis(id: string, key: string, epoch: number) {
    const analysisGeneration = this.analysisGenerations.get(id) ?? 0;
    const run = await database.analyses.get(key).catch(() => undefined);
    const slot = getSlot(id);
    if (
      epoch !== this.epoch ||
      !slot ||
      (this.analysisGenerations.get(id) ?? 0) !== analysisGeneration ||
      run?.snapshotId !== slot.snapshot?.id
    )
      return;
    patchSlot(id, {
      analysis: run,
      analysisPhase: "ready",
      analysisStatus: "Analysis ready",
      analysisCached: true,
    });
  }
  /**
   * The comparison request: the slot's ligand, the reference's current parameters, and as
   * receptor the comparison chains paired with the reference's receptor chains. Without a
   * residue correspondence every polymer chain is the receptor. The run records the choice.
   */
  request(slot: ComparisonSlot): AnalysisRequest | null {
    if (!slot.snapshot || !slot.targetLigandId) return null;
    const group = slot.snapshot.ligandGroups?.find(
      (g) => g.id === slot.ligandGroupId,
    );
    const reference = useExplorer.getState();
    const receptor = new Set(reference.receptorChainIds);
    const paired = [
      ...new Set(
        slotCorrespondence(reference, slot)
          ?.pairings.filter((p) => receptor.has(p.referenceChainId))
          .map((p) => p.comparisonChainId) ?? [],
      ),
    ];
    return {
      ligandResidueId: slot.targetLigandId,
      ...(group ? { ligandResidueIds: [...group.residueIds] } : {}),
      receptorChainIds: paired.length
        ? slot.snapshot.chains
            .filter((c) => paired.includes(c.id))
            .map((c) => c.id)
        : slot.snapshot.chains
            .filter((c) => c.type === "polymer")
            .map((c) => c.id),
      parameters: { ...useExplorer.getState().analysisParameters },
    };
  }
  analyze(id: string) {
    const slot = getSlot(id);
    if (!slot || slot.phase !== "ready" || !this.request(slot)) return;
    this.invalidateAnalysis(id);
    const epoch = this.epoch,
      analysisGeneration = this.analysisGenerations.get(id)!;
    patchSlot(id, { analysisPhase: "queued", analysisStatus: "Queued" });
    const job = () => this.runAnalysis(id, epoch, analysisGeneration);
    this.analysisQueue = this.analysisQueue.then(job, job);
    return this.analysisQueue;
  }
  analyzeAll() {
    for (const slot of useComparison.getState().slots)
      if (slot.phase === "ready" && slot.targetLigandId) this.analyze(slot.id);
  }
  private async runAnalysis(
    id: string,
    epoch: number,
    analysisGeneration: number,
  ) {
    const current = () =>
      epoch === this.epoch &&
      this.analysisGenerations.get(id) === analysisGeneration &&
      !!getSlot(id);
    const slot = getSlot(id);
    const request = slot && this.request(slot);
    if (!current() || !slot?.source || !slot.snapshot || !request) return;
    const signal = this.aborts.get(id)!.signal,
      snapshot = slot.snapshot,
      source = slot.source;
    this.analyzing = id;
    patchSlot(id, {
      analysisPhase: "running",
      analysisStatus: "Preparing chemical definitions",
    });
    try {
      const definitions = await loadChemicalDefinitions(
        snapshot,
        request,
        signal,
      );
      if (!current()) return;
      const key = analysisKey(snapshot, request, definitions);
      const cached = await database.analyses.get(key).catch(() => undefined);
      if (!current()) return;
      const run =
        cached ??
        (await this.analysisClient.run(
          source,
          slot.modelIndex,
          slot.assemblyId,
          request,
          definitions,
          (message) => {
            if (current()) patchSlot(id, { analysisStatus: message });
          },
        ));
      if (!current()) return;
      if (run.snapshotId !== snapshot.id)
        throw new Error(
          "Analysis coordinates do not match the comparison structure.",
        );
      if (!cached) await saveAnalysis(run, definitions).catch(() => {});
      if (!current()) return;
      patchSlot(id, {
        analysis: run,
        analysisPhase: "ready",
        analysisStatus: "Analysis ready",
        analysisCached: !!cached,
      });
    } catch (error) {
      if (!current()) return;
      patchSlot(id, {
        analysisPhase: "error",
        analysisStatus: "Analysis failed",
        analysisError:
          error instanceof Error
            ? error.message
            : "Analysis could not be completed.",
      });
    } finally {
      if (this.analyzing === id) this.analyzing = null;
    }
  }
  dispose() {
    ++this.epoch;
    this.aborts.forEach((a) => a.abort());
    this.analysisClient.cancel();
  }
}
