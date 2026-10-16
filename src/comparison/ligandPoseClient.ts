import {
  POSE_WORKER_TIMEOUT_MS,
  type LigandPoseInput,
  type LigandPoseResult,
} from "../domain/ligandPose";

/** One client per comparison slot. Starting a replacement or cancelling terminates the old
 * worker. Request ownership guards also ignore already-queued late events.
 */
export class LigandPoseClient {
  private stop: ((reason: Error) => void) | null = null;
  cancel() {
    this.stop?.(new DOMException("Pose calculation cancelled.", "AbortError"));
  }
  run(input: LigandPoseInput, signal?: AbortSignal): Promise<LigandPoseResult> {
    this.cancel();
    if (signal?.aborted)
      return Promise.reject(
        signal.reason ??
          new DOMException("Pose calculation cancelled.", "AbortError"),
      );
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./ligandPoseWorker.ts", import.meta.url),
        { type: "module" },
      );
      let finished = false;
      const finish = (error?: Error, result?: LigandPoseResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        worker.terminate();
        if (this.stop === stop) this.stop = null;
        if (error) reject(error);
        else resolve(result!);
      };
      const stop = (error: Error) => finish(error),
        abort = () =>
          stop(new DOMException("Pose calculation cancelled.", "AbortError"));
      this.stop = stop;
      const timer = setTimeout(
        () =>
          stop(
            new DOMException(
              "Pose calculation exceeded its 5-second worker deadline.",
              "TimeoutError",
            ),
          ),
        POSE_WORKER_TIMEOUT_MS,
      );
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event) => {
        if (
          finished ||
          this.stop !== stop ||
          event.data.inputKey !== input.inputKey
        )
          return;
        if (event.data.type === "result") finish(undefined, event.data.result);
        else
          finish(
            new Error(
              event.data.message || "Pose worker returned an invalid response.",
            ),
          );
      };
      worker.onerror = (event) =>
        finish(new Error(event.message || "Pose worker failed."));
      worker.onmessageerror = () =>
        finish(new Error("Pose worker response could not be decoded."));
      try {
        const copy = structuredClone(input);
        copy.reference = {
          ...copy.reference,
          positions: input.reference.positions.slice(),
        };
        copy.comparison = {
          ...copy.comparison,
          positions: input.comparison.positions.slice(),
        };
        // These are owned copies. The caller's/renderer buffers must remain attached.
        worker.postMessage({ input: copy }, [
          copy.reference.positions.buffer,
          copy.comparison.positions.buffer,
        ]);
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("Pose input could not be sent."),
        );
      }
    });
  }
}
