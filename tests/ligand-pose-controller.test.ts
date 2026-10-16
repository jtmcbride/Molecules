import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { comparisonFitKey } from "../src/comparison/fitContext";
import { PoseController } from "../src/comparison/poseController";
import { LigandPoseClient } from "../src/comparison/ligandPoseClient";
import { calculateLigandPose } from "../src/comparison/ligandPose";
import { poseContextKey } from "../src/comparison/poseContext";
import { storedPose, savePose } from "../src/data/poseResults";
import { database, getLastSession, saveSession } from "../src/data/repository";
import { useExplorer } from "../src/state/explorer";
import {
  useComparison,
  getSlot,
  patchSlot,
  type ComparisonSlot,
} from "../src/state/comparison";
import { comparisonJson } from "../src/comparison/export";
import {
  resolveInvestigation,
  refreshInvestigation,
} from "../src/comparison/selection";
import { benChemistry, poseFixture } from "./helpers/ligandPose";
import { poseDisplacementPoint } from "../src/structure/poseDisplacement";
import { input } from "./helpers/poseCalculation";
import reference from "./fixtures/ligand-pose/reference.json";
import type {
  LigandPoseInput,
  LigandPoseResult,
} from "../src/domain/ligandPose";
let a: Awaited<ReturnType<typeof poseFixture>>,
  b: typeof a,
  ben: Awaited<ReturnType<typeof benChemistry>>,
  controller: PoseController;
let run: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn>;
let factory: ReturnType<typeof vi.fn<() => LigandPoseClient>>;
const initial = useExplorer.getInitialState();
const fit = input(
  reference.cases.find((c) => c.name === "3PTB-1S0R-global")!,
).fit;
const ready = () => expect(getSlot("slot")?.pose?.phase).toBe("ready");
const workspace = () => ({
  reference: useExplorer.getState(),
  slots: useComparison.getState().slots,
});
beforeAll(async () => {
  [a, b, ben] = await Promise.all([
    poseFixture(),
    poseFixture("tests/fixtures/biology/1S0R.cif.gz"),
    benChemistry(),
  ]);
});
beforeEach(async () => {
  await database.delete();
  await database.open();
  useExplorer.setState({
    ...initial,
    phase: "ready",
    source: a.source,
    snapshot: a.snapshot,
    targetLigandId: a.residue.id,
  });
  useComparison.setState({
    slots: [
      {
        id: "slot",
        label: "1S0R",
        color: "#aaa",
        phase: "ready",
        status: "",
        error: null,
        modelIndex: 0,
        assemblyId: "",
        biologyPhase: "idle",
        biologyStatus: "",
        biologyMode: null,
        analysisPhase: "idle",
        analysisStatus: "",
        analysisError: null,
        analysisCached: false,
        superpositionError: null,
        source: b.source,
        snapshot: b.snapshot,
        targetLigandId: b.residue.id,
        ligandGroupId: null,
        visible: true,
        superpositionScope: "global",
        superposition: structuredClone(fit),
        superpositionKey: "frozen-fit",
        transform: [...fit.transform],
        pairingOverrides: [],
        analysis: null,
        interpretation: null,
      } as ComparisonSlot,
    ],
    notice: null,
  });
  patchSlot("slot", {
    superpositionKey: comparisonFitKey(
      useExplorer.getState(),
      getSlot("slot")!,
    ),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(ben.bytes.slice())),
  );
  run = vi.fn(async (i: LigandPoseInput) => calculateLigandPose(i));
  cancel = vi.fn();
  factory = vi.fn(() => ({ run, cancel }) as unknown as LigandPoseClient);
  controller = new PoseController(factory);
});
afterEach(async () => {
  controller.dispose();
  useComparison.setState({ slots: [] });
  vi.unstubAllGlobals();
  await database.delete();
});
it("calculates without interaction analysis, persists exact inputs, and reuses the cached revision", async () => {
  await controller.calculate("slot");
  ready();
  const pose = getSlot("slot")!.pose!,
    record = pose.record!;
  expect(pose.mode).toBe("fresh");
  expect(record.result).toMatchObject({ status: "evaluated", matchedAtoms: 9 });
  expect(await storedPose(record.inputKey)).not.toBeNull();
  expect(await database.analyses.count()).toBe(0);
  expect(await database.poseChemistry.count()).toBe(1);
  expect(run).toHaveBeenCalledOnce();
  await controller.calculate("slot");
  ready();
  expect(getSlot("slot")!.pose!.mode).toBe("cached");
  expect(run).toHaveBeenCalledOnce();
});
it("invalidates a score immediately on occupancy/fit/conformer changes, while unrelated filters and visibility preserve it", async () => {
  await controller.calculate("slot");
  const old = getSlot("slot")!.pose!.result;
  useExplorer.setState({ selectedInteractionId: "filter" });
  patchSlot("slot", { visible: false });
  expect(getSlot("slot")!.pose!.result).toBe(old);
  useExplorer.setState({
    analysisParameters: {
      ...useExplorer.getState().analysisParameters,
      minimumOccupancy: 0.2,
    },
  });
  expect(getSlot("slot")!.pose!.result).toBeNull();
  await vi.waitFor(ready);
  const after = getSlot("slot")!.pose!.record!;
  expect(after.input.reference.minimumOccupancy).toBe(0.2);
  expect(after.input.comparison.minimumOccupancy).toBe(0.2);
  patchSlot("slot", {
    superpositionScope: "none",
    superposition: null,
    transform: null,
  });
  expect(getSlot("slot")!.pose!.result).toBeNull();
  await vi.waitFor(() =>
    expect(getSlot("slot")!.pose!.phase).toBe("unavailable"),
  );
  expect(getSlot("slot")!.pose!.result).toMatchObject({ code: "missing_fit" });
});
it("refuses ambiguous alternate selections and includes explicit conformer choices in invalidation", async () => {
  const snapshot = structuredClone(a.snapshot);
  snapshot.atoms[a.residue.atomIndices[0]].altId = "A";
  useExplorer.setState({ snapshot });
  await controller.calculate("slot");
  expect(getSlot("slot")!.pose!.result).toMatchObject({
    code: "conformer_required",
  });
  controller.setOptions("slot", { referenceConformerId: "A" });
  expect(getSlot("slot")!.pose!.result).toBeNull();
  await vi.waitFor(ready);
  expect(getSlot("slot")!.pose!.record!.input.reference.conformerId).toBe("A");
});
it("cancels removed, replaced and disposed operations, rejecting late success", async () => {
  let complete!: (r: LigandPoseResult) => void;
  let pendingInput!: LigandPoseInput;
  run.mockImplementation((i: LigandPoseInput) => {
    pendingInput = i;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const work = controller.calculate("slot");
  await vi.waitFor(() => expect(getSlot("slot")!.pose!.phase).toBe("running"));
  controller.cancel("slot");
  expect(cancel).toHaveBeenCalled();
  complete(calculateLigandPose(pendingInput));
  await work;
  expect(getSlot("slot")!.pose!.phase).toBe("cancelled");
  const removed = controller.calculate("slot");
  await vi.waitFor(() => expect(getSlot("slot")!.pose!.phase).toBe("running"));
  useComparison.setState({ slots: [] });
  complete(calculateLigandPose(pendingInput));
  await removed;
  expect(await database.ligandPoses.count()).toBe(0);
});
it("restores exact pinned results offline and refuses missing results, damaged records, and missing chemistry without requests", async () => {
  await controller.calculate("slot");
  const saved = {
    options: getSlot("slot")!.pose!.options,
    resultKey: getSlot("slot")!.pose!.savedKey,
  };
  vi.mocked(fetch).mockClear();
  run.mockClear();
  await controller.restore("slot", saved);
  ready();
  expect(getSlot("slot")!.pose!.mode).toBe("pinned");
  expect(fetch).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  const row = (await storedPose(saved.resultKey!))!;
  await database.poseChemistry.delete(row.input.reference.chemistryId);
  await controller.restore("slot", saved);
  expect(getSlot("slot")!.pose!.result).toMatchObject({
    code: "pinned_result_missing",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  await database.ligandPoses.update(saved.resultKey!, {
    result: {
      status: "not_evaluated",
      code: "invalid_input",
      reason: "synthetic corruption",
    },
  });
  await controller.restore("slot", saved);
  expect(getSlot("slot")!.pose!.phase).toBe("unavailable");
  await database.ligandPoses.clear();
  await controller.restore("slot", saved);
  expect(getSlot("slot")!.pose!.phase).toBe("unavailable");
  expect(fetch).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("does not relabel a saved result after the current occupancy or fit has changed", async () => {
  await controller.calculate("slot");
  const saved = {
    options: getSlot("slot")!.pose!.options,
    resultKey: getSlot("slot")!.pose!.savedKey,
  };
  controller.cancel("slot");
  useExplorer.setState({
    analysisParameters: {
      ...initial.analysisParameters,
      minimumOccupancy: 0.3,
    },
  });
  vi.mocked(fetch).mockClear();
  await controller.restore("slot", saved);
  expect(getSlot("slot")!.pose!.result).toMatchObject({
    code: "pinned_result_missing",
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("exports schema 2 complete typed coordinate arrays, maps and chemistry provenance, even without an interaction analysis", async () => {
  await controller.calculate("slot");
  const slot = getSlot("slot")!,
    chem = await database.poseChemistry.toArray();
  const json = JSON.parse(
    comparisonJson(
      { source: a.source, snapshot: a.snapshot },
      [slot],
      new Map(),
      null,
      new Map(),
      new Map(chem.map((c) => [c.id, c])),
    ),
  );
  expect(json.schemaVersion).toBe(2);
  expect(json.comparisonVersion).toBe("comparison-1.2.0");
  const pose = json.structures[0].pose;
  expect(pose.result.pairs).toHaveLength(9);
  expect(pose.input.reference.positions).toHaveLength(27);
  expect(pose.chemistry[0]).toMatchObject({
    contentHash: ben.contentHash,
    origin: "ccd",
    available: true,
  });
  expect(pose.chemistry[0]).not.toHaveProperty("bytes");
  expect(json.fingerprint).toBeNull();
});
it("resolves pose atoms by structure-qualified IDs and clears the investigation when the result changes", async () => {
  await controller.calculate("slot");
  const result = getSlot("slot")!.pose!.result!;
  if (result.status !== "evaluated") throw Error("not evaluated");
  const request = {
    kind: "pose_atom" as const,
    slotId: "slot",
    inputKey: result.inputKey,
    referenceAtomId: result.pairs[0].referenceAtomId,
  };
  const selected = resolveInvestigation(request, workspace());
  expect(selected.status).toBe("resolved");
  if (selected.status !== "resolved") throw Error("unresolved");
  expect(selected.view.reference!.atomIds).toEqual([
    result.pairs[0].referenceAtomId,
  ]);
  expect(selected.view.comparison!.atomIds).toEqual([
    result.pairs[0].comparisonAtomId,
  ]);
  expect(selected.view.comparison!.structure).toEqual({
    kind: "comparison",
    slotId: "slot",
    snapshotId: b.snapshot.id,
  });
  controller.cancel("slot");
  expect(refreshInvestigation(selected, workspace())).toBeNull();
});
it("accepts saved session schemas 1 through 4 and keeps source pins", async () => {
  await database.sources.put(a.source);
  for (const schemaVersion of [1, 2, 3, 4] as const) {
    await saveSession({
      schemaVersion,
      sourceHash: a.source.contentHash,
      modelIndex: 0,
      assemblyId: "",
      selectedResidueId: null,
      activeChainId: null,
      representation: "cartoon",
      showWater: false,
      savedAt: "fixture",
    });
    expect((await getLastSession())!.descriptor.schemaVersion).toBe(
      schemaVersion,
    );
  }
});

it("draws pose displacement endpoints in the measured frame without double-transforming assembly coordinates", async () => {
  await controller.calculate("slot");
  const result = getSlot("slot")!.pose!.result!;
  if (result.status !== "evaluated") throw Error("not evaluated");
  const beforeA = a.snapshot.atomBuffer.positions.slice(),
    beforeB = b.snapshot.atomBuffer.positions.slice();
  for (const pair of result.pairs) {
    const x = poseDisplacementPoint(a.snapshot, pair.referenceAtomId, null)!,
      y = poseDisplacementPoint(
        b.snapshot,
        pair.comparisonAtomId,
        fit.transform,
      )!;
    expect(Math.hypot(...x.map((v, i) => v - y[i]))).toBeCloseTo(
      pair.distanceAngstrom,
      12,
    );
  }
  const id = a.snapshot.atoms[0].id,
    p = a.snapshot.atomBuffer.positions;
  const t = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1];
  expect(poseDisplacementPoint(a.snapshot, id, t)).toEqual([
    3 - p[1],
    4 + p[0],
    5 + p[2],
  ]);
  expect(a.snapshot.atomBuffer.positions).toEqual(beforeA);
  expect(b.snapshot.atomBuffer.positions).toEqual(beforeB);
});

it("explicit recalculation repairs a damaged result whose original integrity hash was left in place", async () => {
  await controller.calculate("slot");
  const key = getSlot("slot")!.pose!.savedKey!;
  await database.ligandPoses.update(key, {
    result: {
      status: "not_evaluated",
      code: "invalid_input",
      reason: "synthetic corruption",
    },
  });
  expect(await storedPose(key)).toBeNull();
  await controller.calculate("slot");
  ready();
  expect((await storedPose(key))!.result).toMatchObject({
    status: "evaluated",
    matchedAtoms: 9,
  });
  expect(getSlot("slot")!.pose!.record!.result).toMatchObject({
    status: "evaluated",
    matchedAtoms: 9,
  });
});

it("does not start a queued replacement after the controller is disposed", async () => {
  await controller.calculate("slot");
  run.mockClear();
  useExplorer.setState({
    analysisParameters: {
      ...initial.analysisParameters,
      minimumOccupancy: 0.2,
    },
  });
  expect(getSlot("slot")!.pose!.result).toBeNull();
  controller.dispose();
  await Promise.resolve();
  await Promise.resolve();
  expect(run).not.toHaveBeenCalled();
});
it("cancelling one slot leaves another slot's preparation and result intact", async () => {
  useComparison.setState((s) => ({
    slots: [...s.slots, { ...s.slots[0], id: "second" }],
  }));
  const first = controller.calculate("slot");
  controller.cancel("slot");
  await controller.calculate("second");
  await first;
  expect(getSlot("slot")!.pose!.phase).toBe("cancelled");
  expect(getSlot("second")!.pose!.phase).toBe("ready");
});

it("retains a valid immutable result if the same input key is presented with a conflicting score", async () => {
  await controller.calculate("slot");
  const original = getSlot("slot")!.pose!.record!;
  if (original.result.status !== "evaluated") throw Error("not evaluated");
  await expect(
    savePose(original.input, {
      ...original.result,
      rmsdAngstrom: original.result.rmsdAngstrom + 1,
    }),
  ).rejects.toThrow("original saved revision was retained");
  expect(await storedPose(original.inputKey)).toEqual(original);
});

it("schedules each active slot once when a shared reference input invalidates both", async () => {
  useComparison.setState((s) => ({
    slots: [...s.slots, { ...s.slots[0], id: "second" }],
  }));
  await controller.calculate("slot");
  await controller.calculate("second");
  factory.mockClear();
  useExplorer.setState({
    analysisParameters: {
      ...initial.analysisParameters,
      minimumOccupancy: 0.2,
    },
  });
  expect(getSlot("slot")!.pose!.result).toBeNull();
  expect(getSlot("second")!.pose!.result).toBeNull();
  await vi.waitFor(() => {
    expect(getSlot("slot")!.pose!.phase).toBe("ready");
    expect(getSlot("second")!.pose!.phase).toBe("ready");
  });
  expect(factory).toHaveBeenCalledTimes(2);
});

it("drops an obsolete conformer choice when switching to a ligand with shared atoms", async () => {
  // Artificial alternate and residue instance isolate a ligand-change transition.
  const alternate = structuredClone(b.snapshot);
  alternate.atoms[b.residue.atomIndices[0]].altId = "A";
  patchSlot("slot", { snapshot: alternate });
  controller.setOptions("slot", { comparisonConformerId: "A" });
  await controller.calculate("slot");
  ready();
  const shared = structuredClone(b.snapshot),
    residue = {
      ...structuredClone(b.residue),
      id: b.residue.id + ":synthetic-shared",
    };
  shared.residues.push(residue);
  patchSlot("slot", { snapshot: shared, targetLigandId: residue.id });
  expect(getSlot("slot")!.pose!.options.comparisonConformerId).toBeNull();
  await vi.waitFor(ready);
  expect(
    getSlot("slot")!.pose!.record!.input.comparison.conformerId,
  ).toBeNull();
});

it("invalidates immediately and waits for a fit produced from the current pairing inputs", async () => {
  await controller.calculate("slot");
  const oldKey = getSlot("slot")!.superpositionKey;
  patchSlot("slot", {
    pairingOverrides: [
      { accession: "SYNTHETIC", referenceChainId: "A", comparisonChainId: "B" },
    ],
  });
  expect(getSlot("slot")!.pose!.result).toBeNull();
  await vi.waitFor(() =>
    expect(getSlot("slot")!.pose!.result).toMatchObject({
      code: "missing_fit",
    }),
  );
  expect(getSlot("slot")!.superpositionKey).toBe(oldKey);
  patchSlot("slot", {
    superpositionKey: comparisonFitKey(
      useExplorer.getState(),
      getSlot("slot")!,
    ),
  });
  await vi.waitFor(ready);
});
