import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prepareStructure } from "../src/analysis/prepare";
import { analyze } from "../src/analysis/engine";
import {
  DEFAULT_PARAMETERS,
  type AnalysisParameters,
  type AnalysisRun,
  type ChemicalDefinition,
} from "../src/domain/analysis";
import type { StructureSource } from "../src/domain/types";
/*
 * Golden scientific output of the interaction engine. Restructuring the engine must
 * leave every hash unchanged. A deliberate ruleset change regenerates the file with
 * UPDATE_ENGINE_GOLDEN=1 and records why in validation/README.md. DUMP_ENGINE_GOLDEN=<dir>
 * writes the full canonical JSON per case for diffing.
 */
const GOLDEN = "tests/fixtures/golden/engine.json";
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
interface Case {
  name: string;
  file: string;
  ligand?: { component: string; authSeqId?: string };
  parameters?: Partial<AnalysisParameters>;
  ccd?: string[];
}
const CASES: Case[] = [
  {
    name: "3PTB-BEN-default",
    file: "tests/fixtures/reference/3PTB.cif",
    ligand: { component: "BEN" },
  },
  {
    name: "3PTB-BEN-ccd",
    file: "tests/fixtures/reference/3PTB.cif",
    ligand: { component: "BEN" },
    ccd: ["tests/fixtures/BEN-ccd.cif"],
  },
  {
    name: "3PTB-BEN-variant",
    file: "tests/fixtures/reference/3PTB.cif",
    ligand: { component: "BEN" },
    parameters: {
      includeWaters: false,
      conformerPolicy: "preferred_residue",
      hydrogenBondCutoff: 4,
      clashOverlapMin: 0.3,
      minimumOccupancy: 0.5,
    },
  },
  {
    name: "3PTB-BEN-no-chemistry",
    file: "tests/fixtures/reference/3PTB.cif",
    ligand: { component: "BEN" },
    parameters: { classifyChemistry: false },
  },
  {
    name: "1EVE-E20-default",
    file: "tests/fixtures/reference/1EVE.cif",
    ligand: { component: "E20", authSeqId: "2001" },
  },
  {
    name: "1RMD-ZN-default",
    file: "tests/fixtures/reference/1RMD.cif",
    ligand: { component: "ZN", authSeqId: "119" },
  },
  { name: "pi-stacking", file: "tests/fixtures/pi-stacking.cif" },
  { name: "cation-pi", file: "tests/fixtures/cation-pi.cif" },
  { name: "metal-coordination", file: "tests/fixtures/metal-coordination.cif" },
  { name: "water-bridge", file: "tests/fixtures/water-bridge.cif" },
  {
    name: "water-bridge-narrow",
    file: "tests/fixtures/water-bridge.cif",
    parameters: { waterLegMax: 2.9, waterAngleMin: 85 },
  },
  { name: "hydrogen-geometry", file: "tests/fixtures/hydrogen-geometry.cif" },
  {
    name: "hydrogen-geometry-clash",
    file: "tests/fixtures/hydrogen-geometry.cif",
    parameters: {
      proximityCutoff: 1,
      classifyChemistry: false,
      clashOverlapMin: 0.1,
    },
  },
];
/** Canonical scientific fields. Run identity, timing and the engine label are excluded; numbers keep 10 significant digits. */
export function canonicalRun(run: AnalysisRun) {
  const {
    id: _id,
    generatedAt: _g,
    cacheKey: _k,
    engineVersion: _e,
    stats,
    ...rest
  } = run;
  const {
    elapsedMilliseconds: _t,
    rejections: _r,
    ...counts
  } = stats as typeof stats & { rejections?: unknown };
  return JSON.stringify({ ...rest, stats: counts }, (_key, value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    !Number.isInteger(value)
      ? Number(value.toPrecision(10))
      : value,
  );
}
async function runCase(c: Case) {
  const bytes = new Uint8Array(await readFile(c.file));
  const source: StructureSource = {
    id: c.name,
    name: c.name,
    kind: "local",
    format: "mmcif",
    binary: false,
    bytes,
    contentHash: sha(bytes),
    fetchedAt: "2026-10-09T00:00:00Z",
  };
  const definitions: ChemicalDefinition[] = [];
  for (const path of c.ccd ?? []) {
    const b = new Uint8Array(await readFile(path));
    definitions.push({
      componentId: path.match(/(\w+)-ccd/)![1],
      bytes: b,
      contentHash: sha(b),
      url: "fixture",
      retrievedAt: "2026-10-09T00:00:00Z",
    });
  }
  const p = await prepareStructure(source, 0, "", definitions);
  const ligand = c.ligand
    ? p.snapshot.ligands.find(
        (l) =>
          l.componentId === c.ligand!.component &&
          (!c.ligand!.authSeqId ||
            p.snapshot.residues.find((r) => r.id === l.residueId)!.authSeqId ===
              c.ligand!.authSeqId),
      )!
    : p.snapshot.ligands[0];
  const run = await analyze(
    p.structure,
    p.snapshot,
    p.selectionIndex,
    {
      ligandResidueId: ligand.residueId,
      receptorChainIds: p.snapshot.chains
        .filter((ch) => ch.type === "polymer")
        .map((ch) => ch.id),
      parameters: { ...DEFAULT_PARAMETERS, ...c.parameters },
    },
    definitions,
  );
  const counts: Record<string, number> = {};
  for (const i of run.interactions) counts[i.type] = (counts[i.type] ?? 0) + 1;
  return {
    run,
    canonical: canonicalRun(run),
    counts,
    rejections: run.stats.rejections ?? {},
  };
}
describe("interaction engine golden output", () => {
  it("reproduces the recorded scientific output for every reference and synthetic case", async () => {
    const recorded: Record<
      string,
      {
        sha256: string;
        counts: Record<string, number>;
        rejections: Record<string, number>;
      }
    > = process.env.UPDATE_ENGINE_GOLDEN
      ? {}
      : JSON.parse(await readFile(GOLDEN, "utf8")).cases;
    const observed: typeof recorded = {};
    for (const c of CASES) {
      const { canonical, counts, rejections } = await runCase(c);
      observed[c.name] = { sha256: sha(canonical), counts, rejections };
      if (process.env.DUMP_ENGINE_GOLDEN) {
        await mkdir(process.env.DUMP_ENGINE_GOLDEN, { recursive: true });
        await writeFile(
          `${process.env.DUMP_ENGINE_GOLDEN}/${c.name}.json`,
          JSON.stringify(JSON.parse(canonical), null, 1),
        );
      }
    }
    if (process.env.UPDATE_ENGINE_GOLDEN) {
      await mkdir("tests/fixtures/golden", { recursive: true });
      await writeFile(
        GOLDEN,
        JSON.stringify(
          {
            note: "SHA-256 of canonicalRun() per case, interaction counts and Mol* edge rejection counts; see tests/engine-golden.test.ts.",
            cases: observed,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    for (const c of CASES)
      expect({ case: c.name, ...observed[c.name] }).toEqual({
        case: c.name,
        ...recorded[c.name],
      });
  }, 120000);
});
