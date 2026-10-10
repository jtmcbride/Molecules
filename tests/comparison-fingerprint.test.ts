import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AnalysisRun } from "../src/domain/analysis";
import type { FingerprintMatrix } from "../src/domain/comparison";
import { comparability } from "../src/comparison/fingerprint";
import { fingerprintPair } from "./helpers/fingerprint";

const row = (m: FingerprintMatrix, position: number, type: string) =>
  m.rows.find((r) => r.uniprotPosition === position && r.type === type);

describe("interaction fingerprints keyed by UniProt position", () => {
  it("3PTB and 1S0R share every benzamidine interaction although numbering differs", async () => {
    const { matrix } = await fingerprintPair("3PTB", "1S0R", "BEN");
    expect(matrix.columns.map((c) => c.ligandLabel)).toEqual([
      "BEN A:1",
      "BEN A:225",
    ]);
    // Asp189 (chymotrypsinogen numbering) = UniProt 194: the benzamidine salt bridge.
    expect(row(matrix, 194, "salt_bridge")?.cells).toEqual([
      "present",
      "present",
    ]);
    expect(row(matrix, 194, "hydrogen_bond")?.cells).toEqual([
      "present",
      "present",
    ]);
    expect(matrix.columns[1].similarity).toEqual({
      tanimoto: 1,
      shared: 7,
      gained: 0,
      lost: 0,
      compared: 7,
      excluded: 0,
    });
  });

  it("heme contacts change between deoxy (T) and oxy (R) hemoglobin; the proximal histidine stays", async () => {
    for (const [ref, cmp, tanimoto] of [
      ["2DN2", "2DN1", 15 / 21],
      ["4HHB", "1HHO", 11 / 21],
    ] as const) {
      const { matrix } = await fingerprintPair(ref, cmp, "HEM");
      // Proximal His F8 (α His87) = UniProt 88 coordinates the iron in both states.
      expect(row(matrix, 88, "metal_coordination")?.cells).toEqual([
        "present",
        "present",
      ]);
      expect(matrix.columns[1].similarity?.tanimoto).toBeCloseTo(tanimoto, 10);
    }
  });

  it("flags gained and lost interactions that lie near a cutoff", async () => {
    for (const [ref, cmp] of [
      ["2DN2", "2DN1"],
      ["4HHB", "1HHO"],
    ] as const) {
      const { matrix } = await fingerprintPair(ref, cmp, "HEM");
      const summary = matrix.rows
        .filter((r) => r.changes)
        .map((r) => {
          const c = r.changes![0];
          const f = (x?: number) => (x === undefined ? "–" : x.toFixed(2));
          return `${r.type}@${r.uniprotPosition} ${r.cells[1] === "present" ? "gained" : "lost"} present-margin ${f(c.presentMarginAngstrom)} absent-excess ${f(c.absentExcessAngstrom)}${c.marginal ? " marginal" : ""}`;
        });
      expect(summary).toMatchSnapshot(`${ref}-${cmp}`);
    }
  });

  it("never counts unmeasured cells as absent", async () => {
    const p = await fingerprintPair("3PTB", "1S0R", "BEN");
    // Artificial: the comparison run did not evaluate hydrogen bonds.
    const notEvaluated: AnalysisRun = {
      ...p.runB,
      evaluation: {
        ...p.runB.evaluation,
        hydrogen_bond: { status: "not_evaluated", reason: "artificial" },
      },
    };
    const m = p.build({ cmp: notEvaluated });
    expect(row(m, 194, "hydrogen_bond")?.cells).toEqual([
      "present",
      "not_evaluated",
    ]);
    expect(m.columns[1].similarity).toMatchObject({
      tanimoto: 1,
      compared: 4,
      excluded: 3,
    });
    // Artificial: the comparison receptor excludes the chain.
    const m2 = p.build({
      cmp: {
        ...p.runB,
        request: { ...p.runB.request, receptorChainIds: [] },
        interactions: [],
      },
    });
    expect(m2.rows.every((r) => r.cells[1] === "not_evaluated")).toBe(true);
    expect(m2.columns[1].similarity?.tanimoto).toBeNull();
  });

  it("reports positions unobserved in one structure as not observed", async () => {
    const p = await fingerprintPair("3PTB", "1S0R", "BEN");
    // Artificial: UniProt 194 unobserved in the comparison structure.
    const corr = {
      ...p.corr,
      pairs: p.corr.pairs.map((x) =>
        x.uniprotPosition === 194
          ? {
              ...x,
              status: "reference_only" as const,
              comparisonResidueId: undefined,
            }
          : x,
      ),
    };
    const { buildFingerprint } = await import("../src/comparison/fingerprint");
    const m = buildFingerprint(
      {
        label: "3PTB",
        snapshot: p.a.snapshot,
        run: p.runA,
        mappings: p.a.mappings,
      },
      [
        {
          id: "1S0R",
          label: "1S0R",
          snapshot: p.b.snapshot,
          run: p.runB,
          correspondence: corr,
        },
      ],
    );
    expect(row(m, 194, "salt_bridge")?.cells).toEqual([
      "present",
      "not_observed",
    ]);
    // The comparison's own interactions at that residue can no longer be placed.
    expect(m.columns[1].unplacedInteractions).toBe(4);
    expect(m.columns[1].similarity?.compared).toBe(5);
  });

  it("refuses columns analyzed with a different ruleset or parameters", async () => {
    const p = await fingerprintPair("3PTB", "1S0R", "BEN");
    const changed: AnalysisRun = {
      ...p.runB,
      ruleSetVersion: "molstar-5.13.1-ligand-2",
      request: {
        ...p.runB.request,
        parameters: { ...p.runB.request.parameters, proximityCutoff: 4.5 },
      },
    };
    expect(comparability(p.runA, changed)).toEqual([
      `ruleset molstar-5.13.1-ligand-2 vs ${p.runA.ruleSetVersion}`,
      "parameters proximityCutoff",
    ]);
    const m = p.build({ cmp: changed });
    expect(m.columns[1].refusal).toMatch(/^Different ruleset/);
    expect(m.columns[1].similarity).toBeUndefined();
    expect(m.rows.every((r) => r.cells[1] === "not_evaluated")).toBe(true);
    expect(p.build({ cmp: null }).columns[1].refusal).toBe("Not analyzed");
  });
});

/*
 * Interactions gained and lost between the two structures of a pair, compared with ProLIF
 * 2.2.2 run on the same pair (scripts/comparison-prolif.py; validation/comparison.json).
 * Rows are UniProt position × type, for types ProLIF evaluates here (no water bridges: the
 * ProLIF preparation removes waters), and only where the application measured both cells.
 * Every disagreement is explained in validation/COMPARISON.md.
 */
describe("fingerprint differences against ProLIF", async () => {
  const prolif = JSON.parse(
    await readFile("validation/comparison.json", "utf8"),
  ).prolif as Record<
    string,
    {
      observations: {
        type: string;
        receptor: { authChain: string; authNumber: string };
      }[];
    }
  >;
  async function differences(ref: string, cmp: string, component: string) {
    const p = await fingerprintPair(ref, cmp, component);
    const residueAt = (side: typeof p.a, chain: string, number: string) =>
      side.snapshot.residues.find(
        (r) =>
          r.kind === "polymer" &&
          !r.insertionCode &&
          r.authSeqId === number &&
          side.snapshot.chains.find((c) => c.id === r.chainId)?.authAsymId ===
            chain,
      );
    const position = (isRef: boolean, chain: string, number: string) => {
      const side = isRef ? p.a : p.b;
      const residue = residueAt(side, chain, number);
      if (!residue) return undefined;
      return isRef
        ? side.mappings.find(
            (m) => m.residueId === residue.id && m.status === "exact",
          )?.uniprotPosition
        : p.corr.pairs.find(
            (x) =>
              x.comparisonResidueId === residue.id && x.status === "paired",
          )?.uniprotPosition;
    };
    const bits = (id: string, isRef: boolean) =>
      new Set(
        prolif[id].observations.map(
          (o) =>
            `${o.type}@${position(isRef, o.receptor.authChain, o.receptor.authNumber)}`,
        ),
      );
    const toolA = bits(ref, true),
      toolB = bits(cmp, false);
    const measured = new Set(
      p.matrix.rows
        .filter((r) => r.cells.every((c) => c === "present" || c === "absent"))
        .map((r) => `${r.type}@${r.uniprotPosition}`),
    );
    const app = new Map(
      p.matrix.rows.map((r) => [`${r.type}@${r.uniprotPosition}`, r.cells]),
    );
    const change = (a: boolean, b: boolean) =>
      a === b ? "same" : b ? "gained" : "lost";
    const keys = [...new Set([...toolA, ...toolB, ...app.keys()])]
      .filter((k) => !k.startsWith("water_bridge@"))
      .sort();
    const result: Record<string, string[]> = {
      agree: [],
      appOnly: [],
      prolifOnly: [],
      opposite: [],
    };
    for (const k of keys) {
      const cells = app.get(k);
      // Rows without a measured app cell in either structure are excluded.
      if (cells ? !measured.has(k) : false) continue;
      const appChange = change(
        cells?.[0] === "present",
        cells?.[1] === "present",
      );
      const toolChange = change(toolA.has(k), toolB.has(k));
      if (appChange === "same" && toolChange === "same") continue;
      if (appChange === toolChange) result.agree.push(`${k} ${appChange}`);
      else if (toolChange === "same") result.appOnly.push(`${k} ${appChange}`);
      else if (appChange === "same")
        result.prolifOnly.push(`${k} ${toolChange}`);
      else result.opposite.push(k);
    }
    return result;
  }

  it("3PTB ↔ 1S0R", async () => {
    expect(await differences("3PTB", "1S0R", "BEN")).toMatchSnapshot();
  });
  it("2DN2 ↔ 2DN1", async () => {
    expect(await differences("2DN2", "2DN1", "HEM")).toMatchSnapshot();
  });
});
