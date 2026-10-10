import type {
  SessionDescriptor,
  StructureSnapshot,
  StructureSource,
} from "../domain/types";
import { useExplorer } from "../state/explorer";
import { database } from "../data/repository";
import { loadInterpretation } from "./load";
export class BiologyController {
  private generation = 0;
  private abort: AbortController | null = null;
  cancel(clear = true) {
    ++this.generation;
    this.abort?.abort();
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
    useExplorer.setState({
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
}
