import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareStructure } from "../src/analysis/prepare";
import { analyze } from "../src/analysis/engine";
import { DEFAULT_PARAMETERS } from "../src/domain/analysis";
import type { StructureSource } from "../src/domain/types";
/*
 * Phase 2.x reference validation (V0). Compares the engine's default output with pinned PLIP
 * and ProLIF observations (validation/reference-set.json) by interaction type and receptor
 * residue. The aggregate and per-case agreement are pinned in
 * validation/reference-set-agreement.json: a ruleset change regenerates it with
 * RECORD_REFERENCE_SET=1 and explains every change in validation/README.md.
 */
const AGREEMENT = "validation/reference-set-agreement.json";
const CATEGORIES = [
  "hydrogen_bond",
  "hydrophobic_contact",
  "salt_bridge",
  "pi_stacking",
  "cation_pi",
  "metal_coordination",
  "halogen_bond",
  "water_bridge",
] as const;
type Category = (typeof CATEGORIES)[number];
type Tool = "plip" | "prolif";
interface Observation {
  type: string;
  receptor: { component: string; authChain: string; authNumber: string };
}
interface ReferenceCase {
  accession: string;
  ligand: { component: string; authChain: string; authNumber: string };
  tags: string[];
  cifSha256: string;
  plip: {
    status: string;
    observations: Observation[];
    site?: { members: string[] };
  };
  prolif: { status: string; observations: Observation[] };
}
const key = (o: Observation) =>
  `${o.type}:${o.receptor.component}:${o.receptor.authChain}:${o.receptor.authNumber}`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * App interaction keys for a case. `members` ("COMP:CHAIN:NUM") makes the app analyze the
 * same residues as one ligand group, matching a reference tool's composite ligand (R6).
 */
async function appKeys(c: ReferenceCase, members?: string[]) {
  const bytes = gunzipSync(
    await readFile(`tests/fixtures/reference-set/${c.accession}.cif.gz`),
  );
  expect(sha(bytes)).toBe(c.cifSha256);
  const source: StructureSource = {
    id: c.accession,
    name: c.accession,
    kind: "local",
    format: "mmcif",
    binary: false,
    bytes: new Uint8Array(bytes),
    contentHash: c.cifSha256,
    fetchedAt: "2026-10-10T00:00:00Z",
  };
  const p = await prepareStructure(source, 0, "");
  const chains = new Map(p.snapshot.chains.map((ch) => [ch.id, ch]));
  const residue = p.snapshot.residues.find(
    (r) =>
      r.componentId === c.ligand.component &&
      r.authSeqId === c.ligand.authNumber &&
      chains.get(r.chainId)!.authAsymId === c.ligand.authChain,
  );
  if (!residue) return { status: "ligand_not_found", keys: [] as string[] };
  const group = (members ?? [])
    .map((m) => {
      const [component, chain, number] = m.split(":");
      return p.snapshot.residues.find(
        (r) =>
          r.componentId === component &&
          r.authSeqId === number &&
          chains.get(r.chainId)!.authAsymId === chain &&
          p.snapshot.ligands.some((l) => l.residueId === r.id),
      )?.id;
    })
    .filter((id): id is string => id !== undefined);
  try {
    const run = await analyze(
      p.structure,
      p.snapshot,
      p.selectionIndex,
      {
        ligandResidueId: residue.id,
        ...(group.length > 1
          ? {
              ligandResidueIds: [
                residue.id,
                ...group.filter((id) => id !== residue.id),
              ],
            }
          : {}),
        receptorChainIds: p.snapshot.chains
          .filter((ch) => ch.type === "polymer")
          .map((ch) => ch.id),
        parameters: { ...DEFAULT_PARAMETERS },
      },
      [],
    );
    const residues = new Map(p.snapshot.residues.map((r) => [r.id, r]));
    const keys = run.interactions
      .filter((i) => (CATEGORIES as readonly string[]).includes(i.type))
      .map((i) => {
        const r = residues.get(i.receptor.residueId)!;
        return key({
          type: i.type,
          receptor: {
            component: r.componentId,
            authChain: chains.get(r.chainId)!.authAsymId,
            authNumber: `${r.authSeqId ?? ""}${r.insertionCode ?? ""}`,
          },
        });
      });
    return { status: "ok", keys: [...new Set(keys)].sort() };
  } catch (error) {
    return { status: `failed: ${(error as Error).message}`, keys: [] };
  }
}

function compare(app: string[], ref: string[]) {
  const a = new Set(app),
    r = new Set(ref);
  return {
    shared: [...a].filter((k) => r.has(k)).sort(),
    appOnly: [...a].filter((k) => !r.has(k)).sort(),
    referenceOnly: [...r].filter((k) => !a.has(k)).sort(),
  };
}

describe("reference validation set (PLIP 3.0.0, ProLIF)", () => {
  it("reproduces the pinned per-category agreement for every case", async () => {
    const reference = JSON.parse(
      await readFile("validation/reference-set.json", "utf8"),
    ) as { cases: ReferenceCase[] };
    const perCase: Record<string, unknown> = {};
    const totals: Record<
      Tool,
      Record<
        Category,
        { shared: number; appOnly: number; referenceOnly: number }
      >
    > = { plip: {} as never, prolif: {} as never };
    for (const tool of ["plip", "prolif"] as Tool[])
      for (const category of CATEGORIES)
        totals[tool][category] = { shared: 0, appOnly: 0, referenceOnly: 0 };
    for (const c of reference.cases) {
      const id = `${c.accession}:${c.ligand.component}`;
      // Like-for-like ligand definitions: PLIP's composite site members, and the whole
      // glycan for ProLIF (which was given the glycan); otherwise the single residue.
      const glycan = c.tags.includes("glycan")
        ? c.plip.site?.members
        : undefined;
      const runs: Record<Tool, Awaited<ReturnType<typeof appKeys>>> = {
        plip: await appKeys(c, c.plip.site?.members),
        prolif: await appKeys(c, glycan),
      };
      const app = runs.plip;
      const entry: Record<string, unknown> = { app: app.status };
      for (const tool of ["plip", "prolif"] as Tool[]) {
        const ref = c[tool];
        const app = runs[tool];
        if (ref.status !== "ok" || app.status !== "ok") {
          entry[tool] = { status: ref.status };
          continue;
        }
        // Water bridges are compared with PLIP only (the ProLIF run has no waters).
        const comparable = (k: string) =>
          tool === "plip" || !k.startsWith("water_bridge:");
        const result = compare(
          app.keys.filter(comparable),
          [...new Set(ref.observations.map(key))].filter(comparable),
        );
        entry[tool] = result;
        for (const category of CATEGORIES) {
          const inCategory = (k: string) => k.startsWith(`${category}:`);
          totals[tool][category].shared +=
            result.shared.filter(inCategory).length;
          totals[tool][category].appOnly +=
            result.appOnly.filter(inCategory).length;
          totals[tool][category].referenceOnly +=
            result.referenceOnly.filter(inCategory).length;
        }
      }
      perCase[id] = entry;
    }
    const observed = { totals, cases: perCase };
    if (process.env.RECORD_REFERENCE_SET) {
      await writeFile(AGREEMENT, JSON.stringify(observed, null, 1) + "\n");
      return;
    }
    const pinned = JSON.parse(await readFile(AGREEMENT, "utf8"));
    expect(observed.totals).toEqual(pinned.totals);
    for (const [id, entry] of Object.entries(perCase))
      expect({ id, ...(entry as object) }).toEqual({ id, ...pinned.cases[id] });
  }, 300000);
});
