import type {
  SessionDescriptor,
  StructureSnapshot,
  StructureSource,
} from "../domain/types";
import { useExplorer, type CarrierLookupState } from "../state/explorer";
import { biologyResource, carrierRequest } from "../data/biologyResources";
import { parseCarriers } from "../data/variantCarriers";
import { database } from "../data/repository";
import { loadInterpretation } from "./load";
export class BiologyController {
  private generation = 0;
  private abort: AbortController | null = null;
  private carrierAborts = new Map<string, AbortController>();
  cancel(clear = true) {
    ++this.generation;
    this.abort?.abort();
    for (const accession of this.carrierAborts.keys())
      this.cancelCarriers(accession);
    if (!clear)
      useExplorer.setState({
        biologyPhase: useExplorer.getState().interpretation ? "ready" : "idle",
        biologyStatus: "Annotation loading cancelled.",
      });
    if (clear)
      useExplorer.setState({
        interpretation: null,
        biologyPhase: "idle",
        biologyStatus: "",
        biologyError: null,
        biologyMode: null,
        selectedAnnotationId: null,
        selectedProteinAccession: null,
        biologyAssociation: null,
        biologySelectedLabel: null,
        evidenceIds: [],
        carrierLookups: {},
      });
  }
  async initialize(
    source: StructureSource,
    snapshot: StructureSnapshot,
    restore?: Partial<SessionDescriptor>,
  ) {
    if (restore && (restore.schemaVersion ?? 1) >= 2) {
      useExplorer.setState({
        annotationCategories:
          restore.annotationCategories ??
          useExplorer.getState().annotationCategories,
        selectedProteinAccession: restore.selectedProteinAccession ?? null,
        biologyAssociation: restore.associationAccession ?? null,
      });
      if (restore.interpretationId) {
        const current = this.generation,
          interpretation = await database.interpretations
            .get(restore.interpretationId)
            .catch(() => undefined);
        if (
          current !== this.generation ||
          useExplorer.getState().snapshot?.id !== snapshot.id
        )
          return;
        if (interpretation?.snapshotId === snapshot.id) {
          useExplorer.setState({
            interpretation,
            biologyPhase: "ready",
            biologyStatus: "Restored pinned interpretation",
            biologyMode: "pinned",
            biologyAssociation: interpretation.entryId,
          });
          await this.restoreCarriers(restore.carrierResourceIds ?? [], current);
          return;
        }
        useExplorer.setState({
          biologyPhase: "error",
          biologyError:
            "The saved biological snapshot is unavailable. Load annotations explicitly to create a new interpretation.",
          biologyStatus: "Saved interpretation unavailable",
        });
        return;
      }
    }
    if (source.kind === "local") {
      useExplorer.setState({
        biologyStatus:
          "No validated protein mapping. Associate this local structure with a PDB entry to load annotations.",
      });
      return;
    }
    await this.load(source.id);
  }
  async load(entryId?: string, refresh = false) {
    const state = useExplorer.getState();
    if (!state.source || !state.snapshot || state.phase !== "ready") return;
    const source = state.source,
      snapshot = state.snapshot,
      id = (entryId ?? state.biologyAssociation ?? source.id)
        .trim()
        .toUpperCase();
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal,
      current = ++this.generation;
    for (const accession of this.carrierAborts.keys())
      this.cancelCarriers(accession);
    useExplorer.setState({
      carrierLookups: {},
      biologyPhase: "loading",
      biologyStatus: refresh
        ? "Refreshing annotation sources"
        : "Loading protein annotations",
      biologyError: null,
    });
    try {
      const result = await loadInterpretation(
        source,
        snapshot,
        id,
        signal,
        refresh,
        (message) => {
          if (current === this.generation)
            useExplorer.setState({ biologyStatus: message });
        },
      );
      if (
        current !== this.generation ||
        snapshot.id !== useExplorer.getState().snapshot?.id
      )
        return;
      useExplorer.setState({
        interpretation: result.interpretation,
        biologyPhase: "ready",
        biologyStatus: "Protein annotations ready",
        biologyError: null,
        biologyMode: result.mode as "fresh" | "cached" | "stale",
        biologyAssociation: id,
        selectedAnnotationId: null,
        evidenceIds: [],
        ...(result.persisted
          ? {}
          : {
              notice:
                "Annotations loaded, but browser storage is unavailable. This interpretation cannot be restored.",
            }),
      });
    } catch (error) {
      if (current !== this.generation || signal.aborted) return;
      useExplorer.setState({
        biologyPhase: "error",
        biologyError: error instanceof Error ? error.message : String(error),
        biologyStatus: "Annotations unavailable",
      });
    }
  }
  /**
   * Deposited entity sequences aligned to one protein of the current interpretation. Sends the
   * accession only. A failure is recorded for that protein and never touches the interpretation,
   * the analysis or the scene.
   */
  async lookupCarriers(accession: string) {
    const state = useExplorer.getState(),
      interpretation = state.interpretation,
      protein = interpretation?.proteins.find((p) => p.accession === accession);
    if (!interpretation || !protein) return;
    if (
      this.carrierAborts.has(accession) ||
      state.carrierLookups[accession]?.phase === "ready"
    )
      return;
    const abort = new AbortController(),
      current = this.generation;
    this.carrierAborts.set(accession, abort);
    const set = (value: CarrierLookupState) =>
      useExplorer.setState((s) => ({
        carrierLookups: { ...s.carrierLookups, [accession]: value },
      }));
    set({ phase: "loading" });
    try {
      const { resource, mode } = await biologyResource(
        carrierRequest(accession),
        abort.signal,
        crypto.randomUUID(),
      );
      const { bytes, ...ref } = resource;
      const lookup = parseCarriers(
        JSON.parse(new TextDecoder().decode(bytes)),
        accession,
        protein.sequence,
        ref,
      );
      await database.biologyResources.put(resource).catch(() => undefined);
      if (
        current !== this.generation ||
        abort.signal.aborted ||
        useExplorer.getState().interpretation?.id !== interpretation.id
      )
        return;
      set({ phase: "ready", lookup, mode });
    } catch (error) {
      if (current !== this.generation || abort.signal.aborted) return;
      set({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.carrierAborts.get(accession) === abort)
        this.carrierAborts.delete(accession);
    }
  }
  /** Cancel only this protein's request. A later explicit request can retry. */
  cancelCarriers(accession: string) {
    const abort = this.carrierAborts.get(accession);
    if (!abort) return;
    abort.abort();
    this.carrierAborts.delete(accession);
    useExplorer.setState((s) => {
      const carrierLookups = { ...s.carrierLookups };
      delete carrierLookups[accession];
      return { carrierLookups };
    });
  }
  /** Pinned lookups of a saved session, from stored bytes only; never refetched. */
  private async restoreCarriers(resourceIds: string[], current: number) {
    for (const id of resourceIds) {
      const resource = await database.biologyResources
        .get(id)
        .catch(() => undefined);
      const interpretation = useExplorer.getState().interpretation;
      if (current !== this.generation || !interpretation) return;
      const accession = resource?.identifier;
      const protein = interpretation.proteins.find(
        (p) => p.accession === accession,
      );
      let value: CarrierLookupState;
      try {
        if (!resource || !protein)
          throw Error(
            "The saved carrier lookup is no longer in browser storage.",
          );
        const { bytes, ...ref } = resource;
        value = {
          phase: "ready",
          mode: "pinned",
          lookup: parseCarriers(
            JSON.parse(new TextDecoder().decode(bytes)),
            protein.accession,
            protein.sequence,
            ref,
          ),
        };
      } catch (error) {
        value = {
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      useExplorer.setState((s) => ({
        carrierLookups: {
          ...s.carrierLookups,
          [accession ?? id]: value,
        },
      }));
    }
  }
}
