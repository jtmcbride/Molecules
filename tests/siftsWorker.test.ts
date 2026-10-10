import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSifts } from "../src/data/sifts";
import { parseSiftsOffThread } from "../src/biology/siftsClient";
// Stand-in for a browser module Worker: structuredClone applies the real transfer
// semantics, and the handler runs the same readSifts entry point as siftsWorker.ts.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  constructor(readonly url: URL) {
    FakeWorker.instances.push(this);
  }
  postMessage(
    data: { bytes: Uint8Array; entryId: string },
    transfer: Transferable[],
  ) {
    const owned = structuredClone(data, { transfer });
    setTimeout(async () => {
      if (this.terminated) return;
      try {
        const result = await readSifts(owned.bytes, owned.entryId);
        if (!this.terminated)
          this.onmessage?.({ data: { type: "result", ...result } });
      } catch (error) {
        if (!this.terminated)
          this.onmessage?.({
            data: { type: "error", message: (error as Error).message },
          });
      }
    });
  }
  terminate() {
    this.terminated = true;
  }
}
const fixture = () =>
  readFile("tests/fixtures/biology/3ptb-sifts.xml.gz").then(
    (b) => new Uint8Array(b),
  );
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});
describe("off-thread SIFTS parsing", () => {
  it("returns the same rows as inline parsing and never detaches the cached bytes", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const bytes = await fixture(),
      length = bytes.byteLength;
    const result = await parseSiftsOffThread(
      bytes,
      "3PTB",
      new AbortController().signal,
    );
    expect(result).toEqual(await readSifts(bytes, "3PTB"));
    expect(bytes.byteLength).toBe(length);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].url.pathname).toMatch(/siftsWorker\.ts$/);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
  it("terminates the worker and rejects when the load is cancelled", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const pending = parseSiftsOffThread(
      await fixture(),
      "3PTB",
      controller.signal,
    );
    controller.abort(new DOMException("Superseded.", "AbortError"));
    await expect(pending).rejects.toThrow("Superseded.");
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
  it("rejects an already-cancelled request without starting a worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled.", "AbortError"));
    await expect(
      parseSiftsOffThread(await fixture(), "3PTB", controller.signal),
    ).rejects.toThrow("Cancelled.");
    expect(FakeWorker.instances).toHaveLength(0);
  });
  it("keeps the actionable validation messages from the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const signal = new AbortController().signal;
    await expect(
      parseSiftsOffThread(new Uint8Array([1, 2]), "3PTB", signal),
    ).rejects.toThrow("Expected a gzip SIFTS residue file.");
    await expect(
      parseSiftsOffThread(await fixture(), "4HHB", signal),
    ).rejects.toThrow("did not match");
  });
});
