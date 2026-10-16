import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BiologyController } from "../src/biology/controller";
import { useExplorer } from "../src/state/explorer";
import { biologyResource } from "../src/data/biologyResources";
import type { InterpretationSnapshot } from "../src/domain/biology";

vi.mock("../src/data/biologyResources", async (original) => ({
  ...(await original<typeof import("../src/data/biologyResources")>()),
  biologyResource: vi.fn(),
}));
vi.mock("../src/data/repository", () => ({
  database: { biologyResources: { put: vi.fn(async () => undefined) } },
}));
vi.mock("../src/data/variantCarriers", () => ({
  parseCarriers: vi.fn(() => ({ accession: "P68871", entities: [] })),
}));
let controller: BiologyController;
const pending: {
  signal: AbortSignal;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}[] = [];
const result = {
  resource: { bytes: new TextEncoder().encode("{}") },
  mode: "fresh",
};
beforeEach(() => {
  pending.length = 0;
  vi.mocked(biologyResource)
    .mockReset()
    .mockImplementation(
      (_request, signal) =>
        new Promise((resolve, reject) =>
          pending.push({ signal, resolve, reject }),
        ),
    );
  controller = new BiologyController();
  // Synthetic interpretation: these tests isolate request lifecycle, not response parsing.
  useExplorer.setState({
    interpretation: {
      id: "pinned",
      proteins: [
        { accession: "P68871", sequence: "A" },
        { accession: "P69905", sequence: "A" },
      ],
    } as InterpretationSnapshot,
    carrierLookups: {},
  });
});
afterEach(() => controller.cancel());
it("deduplicates in-flight requests and reuses ready/pinned lookups", async () => {
  const first = controller.lookupCarriers("P68871");
  await controller.lookupCarriers("P68871");
  expect(biologyResource).toHaveBeenCalledTimes(1);
  expect(pending[0].signal.aborted).toBe(false);
  pending[0].resolve(result);
  await first;
  await controller.lookupCarriers("P68871");
  expect(biologyResource).toHaveBeenCalledTimes(1);
  expect(useExplorer.getState().carrierLookups.P68871.phase).toBe("ready");
  const state = useExplorer.getState().carrierLookups.P68871;
  if (state.phase === "ready")
    useExplorer.setState({
      carrierLookups: { P68871: { ...state, mode: "pinned" } },
    });
  await controller.lookupCarriers("P68871");
  expect(biologyResource).toHaveBeenCalledTimes(1);
});
it("cancels one accession and rejects its late result while a retry succeeds", async () => {
  const first = controller.lookupCarriers("P68871");
  controller.cancelCarriers("P68871");
  expect(pending[0].signal.aborted).toBe(true);
  expect(useExplorer.getState().carrierLookups.P68871).toBeUndefined();
  const retry = controller.lookupCarriers("P68871");
  pending[0].resolve(result);
  await first;
  expect(useExplorer.getState().carrierLookups.P68871.phase).toBe("loading");
  pending[1].resolve(result);
  await retry;
  expect(useExplorer.getState().carrierLookups.P68871.phase).toBe("ready");
});
it("isolates failures per accession and does not leave cancelled requests loading", async () => {
  const interpretation = useExplorer.getState().interpretation;
  const first = controller.lookupCarriers("P68871");
  const second = controller.lookupCarriers("P69905");
  pending[0].reject(Error("service unavailable"));
  await first;
  expect(useExplorer.getState().carrierLookups.P68871).toEqual({
    phase: "error",
    message: "service unavailable",
  });
  expect(useExplorer.getState().carrierLookups.P69905.phase).toBe("loading");
  controller.cancel(false);
  pending[1].resolve(result);
  await second;
  expect(useExplorer.getState().carrierLookups.P69905).toBeUndefined();
  expect(useExplorer.getState().interpretation).toBe(interpretation);
});
