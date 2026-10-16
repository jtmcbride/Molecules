import { describe, expect, it } from "vitest";
import { superpose } from "../src/comparison/superposition";
import { correspondence } from "../src/comparison/correspondence";
import {
  drawnInteractions,
  investigationRevision,
  refreshInvestigation,
  resolveInvestigation,
  type InvestigationWorkspace,
} from "../src/comparison/selection";
import type { AnalysisRun } from "../src/domain/analysis";
import type { InterpretationSnapshot } from "../src/domain/biology";
import type {
  InvestigationRequest,
  InvestigationResult,
  InvestigationView,
} from "../src/domain/selection";
import type { ComparisonSlot } from "../src/state/comparison";
import { comparisonSide } from "./helpers/comparison";
import { analyzeLigand } from "./helpers/fingerprint";

type Side = Awaited<ReturnType<typeof comparisonSide>>;

/** Interpretation carrying only what correspondence needs, keyed to the side's snapshot. */
function interpretation(side: Side, id = side.source.id) {
  return {
    id: `interpretation:${id}`,
    snapshotId: side.snapshot.id,
    mappings: side.mappings,
    coverage: side.coverage,
  } as unknown as InterpretationSnapshot;
}

function slot(
  id: string,
  side: Side,
  patch: Partial<ComparisonSlot> = {},
): ComparisonSlot {
  return {
    id,
    label: side.source.id,
    color: "#f2a65a",
    visible: true,
    phase: "ready",
    status: "",
    error: null,
    source: side.source,
    snapshot: side.snapshot,
    modelIndex: 0,
    assemblyId: side.snapshot.assemblyId,
    interpretation: interpretation(side),
    biologyPhase: "ready",
    biologyStatus: "",
    biologyMode: "cached",
    analysis: null,
    analysisPhase: "idle",
    analysisStatus: "",
    analysisError: null,
    analysisCached: false,
    targetLigandId: null,
    ligandGroupId: null,
    transform: null,
    pairingOverrides: [],
    superpositionScope: "global",
    superposition: null,
    superpositionError: null,
    superpositionKey: null,
    ...patch,
  };
}

function workspace(
  ref: Side,
  slots: readonly ComparisonSlot[],
  analysis: AnalysisRun | null = null,
): InvestigationWorkspace {
  return {
    reference: {
      snapshot: ref.snapshot,
      interpretation: interpretation(ref),
      analysis,
      targetLigandId: analysis?.request.ligandResidueId ?? null,
      ligandGroupId: null,
    },
    slots,
  };
}

const view = (result: InvestigationResult): InvestigationView => {
  if (result.status !== "resolved")
    throw new Error(`unavailable: ${result.reason}`);
  return result.view;
};
const residue = (side: Side, id?: string) =>
  side.snapshot.residues.find((r) => r.id === id);
const label = (side: Side, id?: string) => {
  const r = residue(side, id)!;
  const chain = side.snapshot.chains.find((c) => c.id === r.chainId)!;
  return `${chain.authAsymId}:${r.componentId}${r.authSeqId}${r.insertionCode ?? ""}`;
};
/** Comparison residue by author chain, component and author number. */
function find(side: Side, chain: string, component: string, auth: string) {
  const chains = new Map(side.snapshot.chains.map((c) => [c.id, c]));
  return side.snapshot.residues.find(
    (r) =>
      chains.get(r.chainId)?.authAsymId === chain &&
      r.componentId === component &&
      `${r.authSeqId}${r.insertionCode ?? ""}` === auth,
  )!;
}
const residueRequest = (
  slotId: string,
  side: Side,
  residueId: string,
): InvestigationRequest => ({
  kind: "residue",
  target: {
    structure: { kind: "comparison", slotId, snapshotId: side.snapshot.id },
    residueId,
  },
});

describe("structure-qualified investigation", () => {
  it("resolves a comparison residue to its SIFTS partner although author numbering differs", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const corr = correspondence(ref.side, cmp.side);
    const asp = corr.pairs.find((p) => p.uniprotPosition === 194)!;
    const result = view(
      resolveInvestigation(
        residueRequest("s1", cmp, asp.comparisonResidueId!),
        workspace(ref, [slot("s1", cmp)]),
      ),
    );
    expect(result.slotId).toBe("s1");
    expect(label(ref, result.reference!.residueIds[0])).toBe("A:ASP189");
    expect(label(cmp, result.comparison!.residueIds[0])).not.toBe("A:ASP189");
    expect(result.correspondence).toMatchObject({
      basis: "sifts_exact",
      accession: "P00760",
      uniprotPosition: 194,
      status: "paired",
    });
    // Neither structure is analyzed: a typed state, never an empty list.
    expect(result.reference!.interactions).toEqual({
      status: "not_available",
      reason: "Not analyzed.",
    });
  });

  it("keeps two slots of the same source apart", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const target = cmp.snapshot.residues.find((r) => r.kind === "polymer")!;
    const ws = workspace(ref, [slot("first", cmp), slot("second", cmp)]);
    const result = view(
      resolveInvestigation(residueRequest("second", cmp, target.id), ws),
    );
    expect(result.slotId).toBe("second");
    expect(result.comparison!.structure).toEqual({
      kind: "comparison",
      slotId: "second",
      snapshotId: cmp.snapshot.id,
    });
    // Removing the other copy leaves the investigation as it is.
    const withoutFirst = { ...ws, slots: ws.slots.slice(1) };
    expect(
      refreshInvestigation({ status: "resolved", view: result }, withoutFirst),
    ).toEqual({ status: "resolved", view: result });
    // Removing its own slot clears it instead of moving it to the remaining copy.
    expect(
      refreshInvestigation(
        { status: "resolved", view: result },
        { ...ws, slots: ws.slots.slice(0, 1) },
      ),
    ).toBeNull();
  });

  it("resolves residues of an assembly instance by chain instance, not author chain alone", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("4HHB"),
      comparisonSide("4HHB", "1"),
    ]);
    const his = find(cmp, "B", "HIS", "92");
    const operator = cmp.snapshot.chains.find(
      (c) => c.id === his.chainId,
    )!.operatorId;
    expect(operator).toBeTruthy();
    const result = view(
      resolveInvestigation(
        residueRequest("asm", cmp, his.id),
        workspace(ref, [slot("asm", cmp)]),
      ),
    );
    expect(label(ref, result.reference!.residueIds[0])).toBe("B:HIS92");
    expect(result.reference!.residueIds[0]).not.toBe(his.id);
    expect(result.correspondence?.comparisonChainId).toBe(his.chainId);
  });

  it("preserves insertion codes on both sides", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const inserted = ref.snapshot.residues.find(
      (r) => r.kind === "polymer" && r.insertionCode,
    )!;
    const pair = correspondence(ref.side, cmp.side).pairs.find(
      (p) => p.referenceResidueId === inserted.id,
    )!;
    const result = view(
      resolveInvestigation(
        residueRequest("s1", cmp, pair.comparisonResidueId!),
        workspace(ref, [slot("s1", cmp)]),
      ),
    );
    expect(result.reference!.residueIds).toEqual([inserted.id]);
    expect(label(ref, inserted.id)).toMatch(/\d+[A-Z]$/);
  });

  it("explains absent and ambiguous correspondence instead of guessing a partner", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const ws = workspace(ref, [slot("s1", cmp)]);
    const water = cmp.snapshot.residues.find((r) => r.kind === "water")!;
    const ligand = view(
      resolveInvestigation(residueRequest("s1", cmp, water.id), ws),
    );
    expect(ligand.reference).toMatchObject({
      residueIds: [],
      unavailable: "Only polymer residues are paired by UniProt position.",
    });
    expect(ligand.correspondence).toBeNull();

    // Artificial: one comparison mapping marked ambiguous.
    const asp = correspondence(ref.side, cmp.side).pairs.find(
      (p) => p.uniprotPosition === 194,
    )!;
    const ambiguous = {
      ...cmp,
      mappings: cmp.mappings.map((m) =>
        m.residueId === asp.comparisonResidueId
          ? { ...m, status: "ambiguous" as const }
          : m,
      ),
    };
    const result = view(
      resolveInvestigation(
        residueRequest("s1", cmp, asp.comparisonResidueId!),
        workspace(ref, [
          slot("s1", cmp, {
            interpretation: interpretation(ambiguous, "artificial-ambiguous"),
          }),
        ]),
      ),
    );
    expect(result.correspondence?.status).toBe("not_comparable");
    expect(result.reference!.residueIds).toEqual([]);
    expect(result.reference!.unavailable).toMatch(/^Not comparable/);

    // Without the comparison's annotations there is no correspondence at all.
    const missing = view(
      resolveInvestigation(
        residueRequest("s1", cmp, asp.comparisonResidueId!),
        workspace(ref, [
          slot("s1", cmp, { interpretation: null, biologyPhase: "loading" }),
        ]),
      ),
    );
    expect(missing.correspondenceUnavailable).toBe(
      "Residue correspondence is still loading.",
    );
  });

  it("lists every interaction of a fingerprint cell, nearest first", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const [runA, runB] = await Promise.all([
      analyzeLigand(ref, "BEN"),
      analyzeLigand(cmp, "BEN"),
    ]);
    const ws = workspace(ref, [slot("s1", cmp, { analysis: runB })], runA);
    const refAsp = find(ref, "A", "ASP", "189");
    const multi = runA.interactions.filter(
      (i) => i.type === "hydrogen_bond" && i.receptor.residueId === refAsp.id,
    );
    expect(multi.length).toBeGreaterThan(1);
    const rowKey = JSON.stringify([
      "polymer",
      refAsp.chainId,
      "P00760",
      194,
      "hydrogen_bond",
    ]);
    const result = view(
      resolveInvestigation({ kind: "fingerprint", slotId: "s1", rowKey }, ws),
    );
    expect(result.reference).toMatchObject({
      residueIds: [refAsp.id],
      cell: "present",
    });
    const ids =
      result.reference!.interactions.status === "evaluated"
        ? result.reference!.interactions.ids
        : [];
    expect([...ids].sort()).toEqual(multi.map((i) => i.id).sort());
    const distances = ids.map(
      (id) => runA.interactions.find((i) => i.id === id)!.distanceAngstrom,
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(result.comparison).toMatchObject({ cell: "present" });
    expect(result.comparison!.interactions).toMatchObject({
      status: "evaluated",
      analysisCacheKey: runB.cacheKey,
    });

    // Without a comparison analysis its side says why, and the reference is unchanged.
    const unanalyzed = view(
      resolveInvestigation(
        { kind: "fingerprint", slotId: "s1", rowKey },
        workspace(ref, [slot("s1", cmp)], runA),
      ),
    );
    expect(unanalyzed.comparison!.interactions).toEqual({
      status: "not_available",
      reason: "Not analyzed",
    });
    expect(unanalyzed.reference!.interactions).toEqual(
      result.reference!.interactions,
    );
    expect(
      resolveInvestigation(
        { kind: "fingerprint", slotId: "s1", rowKey: '["polymer","x"]' },
        ws,
      ),
    ).toMatchObject({ status: "unavailable" });
  });

  it("draws the nearest interaction per side unless another listed one is chosen", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const [runA, runB] = await Promise.all([
      analyzeLigand(ref, "BEN"),
      analyzeLigand(cmp, "BEN"),
    ]);
    const ws = workspace(ref, [slot("s1", cmp, { analysis: runB })], runA);
    const refAsp = find(ref, "A", "ASP", "189");
    const request = {
      kind: "fingerprint" as const,
      slotId: "s1",
      rowKey: JSON.stringify([
        "polymer",
        refAsp.chainId,
        "P00760",
        194,
        "hydrogen_bond",
      ]),
    };
    const result = resolveInvestigation(request, ws);
    const ids = (side: "reference" | "comparison") => {
      const i = view(result)[side]!.interactions;
      return i.status === "evaluated" ? i.ids : [];
    };
    expect(ids("reference").length).toBeGreaterThan(1);
    expect(drawnInteractions(result)).toEqual({
      reference: ids("reference")[0],
      comparison: ids("comparison")[0],
    });
    const chosen = { reference: ids("reference")[1], comparison: null };
    expect(drawnInteractions(result, chosen)).toEqual({
      reference: ids("reference")[1],
      comparison: ids("comparison")[0],
    });
    // A choice that is no longer listed falls back to the nearest.
    expect(
      drawnInteractions(result, { reference: "gone", comparison: "gone" }),
    ).toEqual(drawnInteractions(result));

    // A water-mediated cell draws the bridge, water included, on both sides.
    const bridge = resolveInvestigation(
      {
        ...request,
        rowKey: JSON.stringify([
          "polymer",
          refAsp.chainId,
          "P00760",
          216,
          "water_bridge",
        ]),
      },
      ws,
    );
    const drawnBridge = drawnInteractions(bridge);
    const refBridge = runA.interactions.find(
      (i) => i.id === drawnBridge.reference,
    );
    const cmpBridge = runB.interactions.find(
      (i) => i.id === drawnBridge.comparison,
    );
    expect(refBridge?.type).toBe("water_bridge");
    expect(refBridge?.mediator).toBeDefined();
    expect(cmpBridge?.type).toBe("water_bridge");
    expect(cmpBridge?.mediator).toBeDefined();

    // A residue request lists every interaction; the nearest chemical one is drawn.
    const site = resolveInvestigation(
      residueRequest("s1", cmp, find(cmp, "A", "ASP", "171").id),
      ws,
    );
    expect(view(site).reference!.residueIds).toEqual([refAsp.id]);
    const siteIds = (() => {
      const i = view(site).reference!.interactions;
      return i.status === "evaluated" ? i.ids : [];
    })();
    const type = (id: string | null) =>
      [...runA.interactions, ...runB.interactions].find((i) => i.id === id)
        ?.type;
    const isChemical = (id: string) =>
      !["proximity_contact", "steric_clash"].includes(type(id)!);
    expect(siteIds.some((id) => !isChemical(id))).toBe(true);
    const drawnSite = drawnInteractions(site, null, isChemical);
    expect(drawnSite.reference).toBe(siteIds.find(isChemical));
    expect(isChemical(drawnSite.comparison!)).toBe(true);

    // Reference-only selections leave drawing to the analysis panel.
    const referenceOnly = resolveInvestigation(
      {
        kind: "residue",
        target: {
          structure: { kind: "reference", snapshotId: ref.snapshot.id },
          residueId: refAsp.id,
        },
      },
      ws,
    );
    expect(drawnInteractions(referenceOnly)).toEqual({
      reference: null,
      comparison: null,
    });
  });

  it("draws only the measured side of a gained or lost interaction", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("4HHB"),
      comparisonSide("1HHO"),
    ]);
    const [runA, runB] = await Promise.all([
      analyzeLigand(ref, "HEM"),
      analyzeLigand(cmp, "HEM"),
    ]);
    const ws = workspace(ref, [slot("s1", cmp, { analysis: runB })], runA);
    const rowKey = JSON.stringify([
      "polymer",
      find(ref, "A", "HIS", "58").chainId,
      "P69905",
      59,
      "pi_stacking",
    ]);
    const result = resolveInvestigation(
      { kind: "fingerprint", slotId: "s1", rowKey },
      ws,
    );
    const v = view(result);
    expect(v.reference).toMatchObject({ cell: "present" });
    expect(v.comparison).toMatchObject({ cell: "absent" });
    expect(v.comparison!.change).toMatchObject({ column: 1 });
    expect(v.comparison!.change!.presentMarginAngstrom).toBeGreaterThan(0);
    // Both mapped residues are selected, but only the present interaction is drawn.
    expect(v.reference!.residueIds).toHaveLength(1);
    expect(v.comparison!.residueIds).toHaveLength(1);
    expect(v.comparison!.interactions).toMatchObject({
      status: "evaluated",
      ids: [],
    });
    const drawn = drawnInteractions(result);
    expect(drawn.comparison).toBeNull();
    expect(runA.interactions.find((i) => i.id === drawn.reference)?.type).toBe(
      "pi_stacking",
    );
  });

  it("resolves a binding-site difference to both superposed residues", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const ligand = (side: Side) =>
      side.snapshot.ligands.find((l) => l.componentId === "BEN")!.residueId;
    const corr = correspondence(ref.side, cmp.side);
    const fit = superpose(corr, ref.snapshot, cmp.snapshot, "global");
    const ws: InvestigationWorkspace = {
      reference: {
        ...workspace(ref, []).reference,
        targetLigandId: ligand(ref),
      },
      slots: [
        slot("s1", cmp, { superposition: fit, targetLigandId: ligand(cmp) }),
      ],
    };
    const gln = find(ref, "A", "GLN", "192");
    const result = view(
      resolveInvestigation(
        { kind: "site_difference", slotId: "s1", referenceResidueId: gln.id },
        ws,
      ),
    );
    expect(result.siteDifference?.rotamerChange).toBe(true);
    expect(residue(cmp, result.comparison!.residueIds[0])?.componentId).toBe(
      "GLN",
    );
    expect(result.correspondence?.uniprotPosition).toBe(197);
    // Without a fit there is nothing to resolve.
    expect(
      resolveInvestigation(
        { kind: "site_difference", slotId: "s1", referenceResidueId: gln.id },
        { ...ws, slots: [slot("s1", cmp, { targetLigandId: ligand(cmp) })] },
      ),
    ).toMatchObject({ status: "unavailable" });
  });

  it("re-resolves after re-pairing and clears when the reference changes", async () => {
    const [ref, cmp] = await Promise.all([
      comparisonSide("4HHB"),
      comparisonSide("1HHO"),
    ]);
    const his = find(cmp, "B", "HIS", "92");
    const request = residueRequest("hb", cmp, his.id);
    const ws = workspace(ref, [slot("hb", cmp)]);
    const before = resolveInvestigation(request, ws);
    expect(label(ref, view(before).reference!.residueIds[0])).toBe("B:HIS92");

    // Pair reference chain D with comparison chain B instead.
    const chainOf = (side: Side, auth: string) =>
      side.snapshot.chains.find(
        (c) => c.authAsymId === auth && c.type === "polymer",
      )!.id;
    const repaired: InvestigationWorkspace = {
      ...ws,
      slots: [
        slot("hb", cmp, {
          pairingOverrides: [
            {
              accession: "P68871",
              referenceChainId: chainOf(ref, "B"),
              comparisonChainId: null,
            },
            {
              accession: "P68871",
              referenceChainId: chainOf(ref, "D"),
              comparisonChainId: chainOf(cmp, "B"),
            },
          ],
        }),
      ],
    };
    expect(investigationRevision(request, repaired)).not.toBe(
      view(before).revision,
    );
    const after = refreshInvestigation(before, repaired)!;
    expect(label(ref, view(after).reference!.residueIds[0])).toBe("D:HIS92");
    // An unchanged workspace returns the same result object.
    expect(refreshInvestigation(after, repaired)).toBe(after);

    const other = await comparisonSide("2DN2");
    expect(refreshInvestigation(after, workspace(other, repaired.slots))).toBe(
      null,
    );
  });

  it("refuses a reference target from another snapshot", async () => {
    const [ref, other] = await Promise.all([
      comparisonSide("3PTB"),
      comparisonSide("1S0R"),
    ]);
    const target = other.snapshot.residues[0];
    expect(
      resolveInvestigation(
        {
          kind: "residue",
          target: {
            structure: { kind: "reference", snapshotId: other.snapshot.id },
            residueId: target.id,
          },
        },
        workspace(ref, []),
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "The selected structure is no longer loaded.",
    });
  });
});

describe("reference residue-set investigations", () => {
  it("retains every observed position in snapshot order and clears after replacement", async () => {
    const side = await comparisonSide("3PTB");
    const w = workspace(side, []);
    const ids = side.snapshot.residues.slice(0, 3).map((r) => r.id);
    const request: InvestigationRequest = {
      kind: "reference_residues",
      snapshotId: side.snapshot.id,
      residueIds: [ids[2], ids[0], ids[1], ids[0]],
    };
    const result = resolveInvestigation(request, w);
    expect(view(result).reference?.residueIds).toEqual(ids);
    expect(view(result).slotId).toBeNull();
    expect(
      refreshInvestigation(result, {
        ...w,
        reference: {
          ...w.reference,
          snapshot: { ...side.snapshot, id: "replaced" },
        },
      }),
    ).toBeNull();
    expect(
      resolveInvestigation({ ...request, residueIds: [ids[0], "missing"] }, w)
        .status,
    ).toBe("unavailable");
    expect(resolveInvestigation({ ...request, residueIds: [] }, w).status).toBe(
      "unavailable",
    );
  });
});
