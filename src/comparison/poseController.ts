import {
  DEFAULT_POSE_OPTIONS,
  poseUnavailable,
  type PoseOptions,
  type PoseSlotState,
  type SavedPoseSelection,
  type StoredLigandPose,
} from "../domain/ligandPose";
import { prepareLigandPose } from "../data/ligandChemistry";
import { storedPose, savePose } from "../data/poseResults";
import { preparePoseInput } from "./ligandPoseInput";
import { comparisonFitKey } from "./fitContext";
import { LigandPoseClient } from "./ligandPoseClient";
import {
  poseContextKey,
  poseResidues,
  currentPoseOptions,
} from "./poseContext";
import { getSlot, patchSlot, useComparison } from "../state/comparison";
import { useExplorer } from "../state/explorer";

/** Owns pose operations only. No interaction analysis, viewer mutation or biological requests. */
export class PoseController {
  private disposed = false;
  private refreshing = false;
  private operations = new Map<
    string,
    { abort: AbortController; client: LigandPoseClient }
  >();
  private unsubscribe: (() => void)[];
  constructor(private clientFactory = () => new LigandPoseClient()) {
    const refresh = () => this.refresh();
    this.unsubscribe = [
      useExplorer.subscribe(refresh),
      useComparison.subscribe(refresh),
    ];
  }
  private stop(id: string) {
    const op = this.operations.get(id);
    this.operations.delete(id);
    op?.abort.abort();
    op?.client.cancel();
  }
  private refresh() {
    if (this.disposed || this.refreshing) return;
    this.refreshing = true;
    try {
      for (const id of this.operations.keys()) if (!getSlot(id)) this.stop(id);
      for (const slot of useComparison.getState().slots) {
        const pose = slot.pose;
        if (!pose || pose.phase === "restoring") continue;
        const reference = useExplorer.getState(),
          options = currentPoseOptions(reference, slot, pose.options),
          key = poseContextKey(reference, slot, options);
        if (
          key === pose.contextKey &&
          JSON.stringify(options) === JSON.stringify(pose.options)
        )
          continue;
        this.stop(slot.id);
        patchSlot(slot.id, {
          pose: {
            ...pose,
            options,
            contextKey: key,
            result: null,
            record: null,
            savedKey: undefined,
            mode: null,
            ...(pose.enabled
              ? {
                  phase: "preparing" as const,
                  message: "Pose inputs changed; recalculating.",
                }
              : {}),
          },
        });
        if (pose.enabled)
          queueMicrotask(() => {
            const current = getSlot(slot.id)?.pose;
            if (
              current?.enabled &&
              current.contextKey === key &&
              current.phase === "preparing"
            )
              void this.calculate(slot.id);
          });
      }
    } finally {
      this.refreshing = false;
    }
  }

  setOptions(id: string, options: Partial<PoseOptions>) {
    const slot = getSlot(id);
    if (!slot) return;
    const pose = slot.pose;
    const next = { ...DEFAULT_POSE_OPTIONS, ...pose?.options, ...options };
    if (!pose)
      patchSlot(id, {
        pose: {
          options: next,
          enabled: false,
          phase: "idle",
          contextKey: poseContextKey(useExplorer.getState(), slot, next),
          result: null,
          record: null,
          mode: null,
          message: "Choose conformers, then calculate the pose.",
        },
      });
    else patchSlot(id, { pose: { ...pose, options: next } });
  }
  cancel(id: string) {
    this.stop(id);
    const pose = getSlot(id)?.pose;
    if (pose)
      patchSlot(id, {
        pose: {
          ...pose,
          enabled: false,
          phase: "cancelled",
          result: null,
          record: null,
          savedKey: undefined,
          mode: null,
          message: "Pose calculation cancelled.",
        },
      });
  }
  async calculate(id: string, refreshChemistry = false) {
    if (this.disposed) return;
    const slot = getSlot(id),
      reference = useExplorer.getState();
    if (
      !slot?.snapshot ||
      !slot.source ||
      !reference.snapshot ||
      !reference.source
    )
      return;
    this.stop(id);
    const options = currentPoseOptions(reference, slot, {
        ...DEFAULT_POSE_OPTIONS,
        ...slot.pose?.options,
      }),
      key = poseContextKey(reference, slot, options);
    const state: PoseSlotState = {
      options,
      enabled: true,
      phase: "preparing",
      contextKey: key,
      result: null,
      record: null,
      mode: null,
      message: "Preparing pinned ligand chemistry.",
    };
    const op = { abort: new AbortController(), client: this.clientFactory() };
    this.operations.set(id, op);
    const current = () =>
      this.operations.get(id) === op &&
      getSlot(id)?.pose?.contextKey === key &&
      !op.abort.signal.aborted;
    const update = (patch: Partial<PoseSlotState>) => {
      if (current())
        patchSlot(id, { pose: { ...getSlot(id)!.pose!, ...patch } });
    };
    patchSlot(id, { pose: state });
    try {
      if (
        !slot.superposition ||
        slot.superpositionKey !== comparisonFitKey(reference, slot) ||
        slot.superposition.scope !== slot.superpositionScope ||
        JSON.stringify(slot.transform) !==
          JSON.stringify(slot.superposition.transform)
      ) {
        update({
          phase: "unavailable",
          result: poseUnavailable(
            "missing_fit",
            "Select a protein superposition before calculating the ligand pose.",
          ),
          message: "A protein superposition is required.",
        });
        return;
      }
      const [a, b] = await Promise.all([
        prepareLigandPose({
          source: reference.source,
          snapshot: reference.snapshot,
          residueIds: poseResidues(
            reference.snapshot,
            reference.targetLigandId,
            reference.ligandGroupId,
          ),
          signal: op.abort.signal,
          conformerId: options.referenceConformerId,
          minimumOccupancy: reference.analysisParameters.minimumOccupancy,
          refresh: refreshChemistry,
        }),
        prepareLigandPose({
          source: slot.source,
          snapshot: slot.snapshot,
          residueIds: poseResidues(
            slot.snapshot,
            slot.targetLigandId,
            slot.ligandGroupId,
          ),
          signal: op.abort.signal,
          conformerId: options.comparisonConformerId,
          minimumOccupancy: reference.analysisParameters.minimumOccupancy,
          refresh: refreshChemistry,
        }),
      ]);
      if (!current()) return;
      const refusal =
        a.status !== "prepared" ? a : b.status !== "prepared" ? b : null;
      if (refusal) {
        update({
          phase: "unavailable",
          result: refusal,
          message: refusal.reason,
        });
        return;
      }
      if (a.status !== "prepared" || b.status !== "prepared") return;
      const prepared = await preparePoseInput(
        a.ligand,
        b.ligand,
        slot.superposition,
        slot.superpositionKey ?? "",
      );
      if (!current()) return;
      if (prepared.status !== "prepared") {
        update({
          phase: "unavailable",
          result: prepared,
          message: prepared.reason,
        });
        return;
      }
      const cached = refreshChemistry
        ? null
        : await storedPose(prepared.input.inputKey).catch(() => null);
      if (!current()) return;
      if (cached) {
        update({
          phase: "ready",
          record: cached,
          result: cached.result,
          savedKey: cached.inputKey,
          mode: "cached",
          message: "Reused the exact saved pose inputs.",
        });
        return;
      }
      update({
        phase: "running",
        message: "Finding all permitted atom mappings.",
      });
      const result = await op.client.run(prepared.input, op.abort.signal);
      if (!current()) return;
      if (result.status !== "evaluated") {
        update({ phase: "unavailable", result, message: result.reason });
        return;
      }
      let record: StoredLigandPose = {
          inputKey: prepared.input.inputKey,
          input: prepared.input,
          result,
          createdAt: new Date().toISOString(),
        },
        saved = false;
      try {
        record = await savePose(prepared.input, result);
        saved = true;
      } catch {
        /* A valid measurement remains usable when storage is unavailable. */
      }
      update({
        phase: "ready",
        record,
        result,
        savedKey: saved ? record.inputKey : undefined,
        mode: "fresh",
        message: saved
          ? "Calculated and saved in this browser."
          : "Calculated; browser storage could not save this result.",
      });
    } catch (error) {
      if (current())
        update({
          phase: "error",
          message:
            error instanceof Error ? error.message : "Pose calculation failed.",
        });
    } finally {
      if (this.operations.get(id) === op) this.operations.delete(id);
    }
  }
  /** No calculation or network fallback. Re-prepare with exact pinned chemistry and require
   * the recreated full input key to identify the saved result before presenting it. */
  async restore(id: string, saved: SavedPoseSelection) {
    if (this.disposed) return;
    const slot = getSlot(id),
      reference = useExplorer.getState();
    if (
      !slot?.snapshot ||
      !slot.source ||
      !reference.snapshot ||
      !reference.source
    )
      return;
    this.stop(id);
    const options = { ...DEFAULT_POSE_OPTIONS, ...saved.options },
      key = poseContextKey(reference, slot, options);
    const op = { abort: new AbortController(), client: this.clientFactory() };
    this.operations.set(id, op);
    patchSlot(id, {
      pose: {
        options,
        enabled: false,
        phase: "restoring",
        contextKey: key,
        result: null,
        record: null,
        mode: null,
        savedKey: saved.resultKey,
        message: "Restoring exact saved pose.",
      },
    });
    const current = () =>
      this.operations.get(id) === op &&
      poseContextKey(useExplorer.getState(), getSlot(id)!, options) === key;
    try {
      if (slot.superpositionKey !== comparisonFitKey(reference, slot))
        throw Error(
          "The selected protein fit is not current. Recalculate after updating the fit.",
        );
      const row = saved.resultKey ? await storedPose(saved.resultKey) : null;
      if (!row)
        throw Error(
          "The saved pose result is missing, incompatible or damaged. Recalculate explicitly to create a new result.",
        );
      const [a, b] = await Promise.all([
        prepareLigandPose({
          source: reference.source,
          snapshot: reference.snapshot,
          residueIds: poseResidues(
            reference.snapshot,
            reference.targetLigandId,
            reference.ligandGroupId,
          ),
          conformerId: options.referenceConformerId,
          minimumOccupancy: reference.analysisParameters.minimumOccupancy,
          pinnedChemistryId: row.input.reference.chemistryId,
          signal: op.abort.signal,
        }),
        prepareLigandPose({
          source: slot.source,
          snapshot: slot.snapshot,
          residueIds: poseResidues(
            slot.snapshot,
            slot.targetLigandId,
            slot.ligandGroupId,
          ),
          conformerId: options.comparisonConformerId,
          minimumOccupancy: reference.analysisParameters.minimumOccupancy,
          pinnedChemistryId: row.input.comparison.chemistryId,
          signal: op.abort.signal,
        }),
      ]);
      if (a.status !== "prepared" || b.status !== "prepared")
        throw Error(
          a.status !== "prepared"
            ? a.reason
            : b.status !== "prepared"
              ? b.reason
              : "Saved chemistry unavailable.",
        );
      const prepared = await preparePoseInput(
        a.ligand,
        b.ligand,
        slot.superposition,
        slot.superpositionKey ?? "",
      );
      if (
        prepared.status !== "prepared" ||
        prepared.input.inputKey !== saved.resultKey
      )
        throw Error(
          "Saved pose inputs do not match the current ligands, conformers, occupancy or protein fit. Recalculate explicitly.",
        );
      if (current())
        patchSlot(id, {
          pose: {
            ...getSlot(id)!.pose!,
            enabled: true,
            phase: "ready",
            record: row,
            result: row.result,
            mode: "pinned",
            message:
              "Restored the exact saved result and chemistry without requests.",
          },
        });
    } catch (error) {
      if (current()) {
        const message =
          error instanceof Error ? error.message : "Saved pose unavailable.";
        patchSlot(id, {
          pose: {
            ...getSlot(id)!.pose!,
            enabled: false,
            phase: "unavailable",
            result: poseUnavailable("pinned_result_missing", message),
            message,
          },
        });
      }
    } finally {
      if (this.operations.get(id) === op) {
        this.operations.delete(id);
        const pose = getSlot(id)?.pose;
        if (pose?.phase === "restoring")
          patchSlot(id, {
            pose: {
              ...pose,
              enabled: false,
              phase: "unavailable",
              result: poseUnavailable(
                "pinned_result_missing",
                "Pose inputs changed during restoration. Recalculate explicitly.",
              ),
              message: "Pose inputs changed during restoration.",
            },
          });
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe.forEach((u) => u());
    for (const id of this.operations.keys()) this.stop(id);
  }
}
