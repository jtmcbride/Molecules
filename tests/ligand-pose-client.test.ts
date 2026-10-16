import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LigandPoseClient } from "../src/comparison/ligandPoseClient";
import {
  POSE_WORKER_TIMEOUT_MS,
  type LigandPoseInput,
} from "../src/domain/ligandPose";

// A controlled Worker substitute makes queued late events and timer races deterministic.
class ControlledWorker {
  static created: ControlledWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  posted: LigandPoseInput | null = null;
  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    ControlledWorker.created.push(this);
  }
  postMessage(message: { input: LigandPoseInput }, transfer: Transferable[]) {
    this.posted = structuredClone(message.input, { transfer });
  }
  send(
    inputKey: string,
    result: unknown = {
      status: "not_evaluated",
      code: "missing_ligand",
      reason: "fixture",
    },
  ) {
    this.onmessage?.({ data: { type: "result", inputKey, result } });
  }
}
const request = (key = "one") => {
  // Client does transport only; scientific validation is independently tested in the worker calculator.
  const ligand = { positions: new Float64Array([1, 2, 3]) };
  return {
    inputKey: key,
    reference: ligand,
    comparison: ligand,
  } as LigandPoseInput;
};
beforeEach(() => {
  vi.useFakeTimers();
  ControlledWorker.created = [];
  vi.stubGlobal("Worker", ControlledWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("transfers distinct owned coordinate copies even when both sides share a source buffer", async () => {
  const client = new LigandPoseClient(),
    i = request(),
    p = client.run(i),
    w = ControlledWorker.created[0];
  expect(w.options.type).toBe("module");
  expect(w.url.pathname).toMatch(/ligandPoseWorker.ts$/);
  expect(i.reference.positions.byteLength).toBe(24);
  expect(i.comparison.positions.byteLength).toBe(24);
  expect(w.posted!.reference.positions).toEqual(i.reference.positions);
  expect(w.posted!.reference.positions.buffer).not.toBe(
    w.posted!.comparison.positions.buffer,
  );
  w.send("one");
  await expect(p).resolves.toMatchObject({ status: "not_evaluated" });
  expect(w.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("terminates superseded work and ignores queued old/mismatched responses", async () => {
  const client = new LigandPoseClient(),
    old = client.run(request()),
    oldWorker = ControlledWorker.created[0];
  const aborted = expect(old).rejects.toMatchObject({ name: "AbortError" });
  const next = client.run(request("two")),
    worker = ControlledWorker.created[1];
  await aborted;
  expect(oldWorker.terminate).toHaveBeenCalledOnce();
  oldWorker.send("one");
  worker.send("one");
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.send("two");
  await expect(next).resolves.toMatchObject({ status: "not_evaluated" });
  oldWorker.onerror?.({ message: "late error" });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("aborts before startup and during execution without leaking a watchdog", async () => {
  const client = new LigandPoseClient(),
    abort = new AbortController();
  abort.abort();
  await expect(client.run(request(), abort.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(ControlledWorker.created).toHaveLength(0);
  const live = new AbortController(),
    p = client.run(request(), live.signal),
    check = expect(p).rejects.toMatchObject({ name: "AbortError" });
  live.abort();
  await check;
  expect(ControlledWorker.created[0].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("times out as an operation error and ignores the subsequent score", async () => {
  const client = new LigandPoseClient(),
    p = client.run(request()),
    check = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(POSE_WORKER_TIMEOUT_MS);
  await check;
  const w = ControlledWorker.created[0];
  w.send("one", { status: "evaluated", rmsdAngstrom: 0 });
  expect(w.terminate).toHaveBeenCalledOnce();
});
it("isolates two comparison clients and handles worker and serialization errors", async () => {
  const a = new LigandPoseClient(),
    b = new LigandPoseClient(),
    pa = a.run(request()),
    pb = b.run(request("two"));
  const ac = expect(pa).rejects.toMatchObject({ name: "AbortError" });
  a.cancel();
  await ac;
  const bc = expect(pb).rejects.toThrow("crashed");
  ControlledWorker.created[1].onerror?.({ message: "crashed" });
  await bc;
  const broken = request();
  Object.assign(broken, { uncloneable: () => {} });
  await expect(a.run(broken)).rejects.toBeInstanceOf(Error);
  expect(ControlledWorker.created[2].terminate).toHaveBeenCalledOnce();
  const malformed = a.run(request()),
    mc = expect(malformed).rejects.toThrow("decoded");
  ControlledWorker.created[3].onmessageerror?.();
  await mc;
  expect(vi.getTimerCount()).toBe(0);
});
