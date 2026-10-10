import { readSifts } from "../data/sifts";
import type { SiftsRow } from "../domain/biology";
type SiftsResult = { rows: SiftsRow[]; release?: string };
/**
 * Decompress and parse SIFTS XML off the main thread. Validated files can reach
 * 50 MB / 500,000 rows, which would otherwise block rendering and selection.
 * Environments without module workers (Node tests) parse inline with identical code.
 */
export function parseSiftsOffThread(
  bytes: Uint8Array,
  entryId: string,
  signal: AbortSignal,
): Promise<SiftsResult> {
  if (typeof Worker === "undefined") return readSifts(bytes, entryId);
  return new Promise<SiftsResult>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const worker = new Worker(new URL("./siftsWorker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      finish();
      if (event.data.type === "result")
        resolve({ rows: event.data.rows, release: event.data.release });
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The SIFTS worker could not start."));
    };
    // Transfer an owned copy. The cached resource snapshot keeps its original buffer.
    const copy = new Uint8Array(bytes);
    worker.postMessage({ bytes: copy, entryId }, [copy.buffer]);
  });
}
