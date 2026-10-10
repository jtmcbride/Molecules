import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareStructure } from "../src/analysis/prepare";
import { analyze } from "../src/analysis/engine";
import {
  DEFAULT_PARAMETERS,
  type AnalysisRequest,
} from "../src/domain/analysis";
import type { StructureSource } from "../src/domain/types";
import { summarizeBindingSite } from "../src/biology/projection";
import type { InterpretationSnapshot } from "../src/domain/biology";

async function load(accession: string) {
  const bytes = new Uint8Array(
    gunzipSync(
      await readFile(`tests/fixtures/reference-set/${accession}.cif.gz`),
    ),
  );
  const source: StructureSource = {
    id: accession,
    name: accession,
    kind: "local",
    format: "mmcif",
    binary: false,
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    fetchedAt: "2026-10-10T00:00:00Z",
  };
  return prepareStructure(source, 0, "");
}
type Prepared = Awaited<ReturnType<typeof load>>;
const residue = (p: Prepared, id: string) =>
  p.snapshot.residues.find((r) => r.id === id)!;
const polymerChains = (p: Prepared) =>
  p.snapshot.chains.filter((c) => c.type === "polymer").map((c) => c.id);
const request = (
  p: Prepared,
  extra: Partial<AnalysisRequest> & { ligandResidueId: string },
): AnalysisRequest => ({
  receptorChainIds: polymerChains(p),
  parameters: { ...DEFAULT_PARAMETERS },
  ...extra,
});

describe("multi-residue ligands and receptor components (R6)", () => {
  it("4KZN: the N-glycan is one branched group analyzed without intra-glycan contacts", async () => {
    const p = await load("4KZN");
    const glycan = p.snapshot.ligandGroups!.find((g) => g.kind === "branched")!;
    expect(glycan.residueIds.map((id) => residue(p, id).componentId)).toEqual([
      "NAG",
      "NAG",
      "BMA",
      "MAN",
      "MAN",
      "FUC",
    ]);
    const members = new Set(glycan.residueIds);
    const grouped = await analyze(
      p.structure,
      p.snapshot,
      p.selectionIndex,
      request(p, {
        ligandResidueId: glycan.residueIds[0],
        ligandResidueIds: glycan.residueIds,
      }),
      [],
    );
    expect(
      grouped.interactions.every(
        (i) =>
          members.has(i.ligand.residueId) && !members.has(i.receptor.residueId),
      ),
    ).toBe(true);
    const ligandResidues = new Set(
      grouped.interactions.map((i) => i.ligand.residueId),
    );
    expect(ligandResidues.size).toBeGreaterThan(1);
    const anchorOnly = await analyze(
      p.structure,
      p.snapshot,
      p.selectionIndex,
      request(p, { ligandResidueId: glycan.residueIds[0] }),
      [],
    );
    expect(grouped.residues.length).toBeGreaterThan(anchorOnly.residues.length);
  });
  it("1ATP: Mn2+ ions as receptor components coordinate ATP phosphate oxygens", async () => {
    const p = await load("1ATP");
    const atp = p.snapshot.ligands.find((l) => l.componentId === "ATP")!;
    const manganese = p.snapshot.ligands
      .filter((l) => l.componentId === "MN")
      .map((l) => l.residueId);
    expect(manganese).toHaveLength(2);
    const r = await analyze(
      p.structure,
      p.snapshot,
      p.selectionIndex,
      request(p, {
        ligandResidueId: atp.residueId,
        receptorComponentResidueIds: manganese,
      }),
      [],
    );
    const metal = r.interactions.filter(
      (i) =>
        i.type === "metal_coordination" &&
        manganese.includes(i.receptor.residueId),
    );
    expect(metal.length).toBeGreaterThanOrEqual(2);
    for (const m of metal) {
      expect(p.snapshot.atoms[m.ligand.atomIndices[0]].name).toMatch(
        /^O[123][ABG]$/,
      );
      expect(m.geometry).toMatchObject({
        metalElement: "MN",
        metalLimitSource: "element_specific",
      });
    }
    const without = await analyze(
      p.structure,
      p.snapshot,
      p.selectionIndex,
      request(p, { ligandResidueId: atp.residueId }),
      [],
    );
    expect(
      without.interactions.some((i) =>
        manganese.includes(i.receptor.residueId),
      ),
    ).toBe(false);
    // The binding-site summary keeps polymer denominators and lists the cofactor contacts.
    const interpretation = {
      snapshotId: p.snapshot.id,
      mappings: [],
      projections: [],
      annotations: [],
      ligands: [],
      id: "x",
    } as unknown as InterpretationSnapshot;
    const summary = summarizeBindingSite(interpretation, r, "ATP");
    expect(new Set(summary.cofactorContactIds)).toEqual(new Set(manganese));
    expect(summary.contactCount).toBe(
      r.residues.filter((x) => !manganese.includes(x.residueId)).length,
    );
  });
  it("rejects inconsistent groups and receptor components", async () => {
    const p = await load("1ATP");
    const atp = p.snapshot.ligands.find(
      (l) => l.componentId === "ATP",
    )!.residueId;
    const mn = p.snapshot.ligands.find(
      (l) => l.componentId === "MN",
    )!.residueId;
    const polymer = p.snapshot.residues.find((r) => r.kind === "polymer")!.id;
    const run = (extra: Partial<AnalysisRequest>) =>
      analyze(
        p.structure,
        p.snapshot,
        p.selectionIndex,
        request(p, { ligandResidueId: atp, ...extra }),
        [],
      );
    await expect(run({ ligandResidueIds: [mn] })).rejects.toThrow(
      "Select a ligand instance",
    );
    await expect(
      run({ ligandResidueIds: [atp, mn], receptorComponentResidueIds: [mn] }),
    ).rejects.toThrow("Receptor components must be");
    await expect(
      run({ receptorComponentResidueIds: [polymer] }),
    ).rejects.toThrow("Receptor components must be");
  });
});

describe("groups containing ions", () => {
  it("1R55: a ligand grouped with its zinc keeps nonmetal chemistry and reports zinc–His coordination", async () => {
    const p = await load("1R55");
    const ligand = p.snapshot.ligands.find(
      (l) => l.componentId === "097",
    )!.residueId;
    const zinc = p.snapshot.ligands.find(
      (l) =>
        l.componentId === "ZN" && residue(p, l.residueId).authSeqId === "201",
    )!.residueId;
    const r = await analyze(
      p.structure,
      p.snapshot,
      p.selectionIndex,
      request(p, { ligandResidueId: ligand, ligandResidueIds: [ligand, zinc] }),
      [],
    );
    expect(r.evaluation.hydrogen_bond.status).not.toBe("not_evaluated");
    const zincHis = r.interactions
      .filter(
        (i) => i.type === "metal_coordination" && i.ligand.residueId === zinc,
      )
      .map((i) => residue(p, i.receptor.residueId).authSeqId);
    expect(new Set(zincHis)).toEqual(new Set(["345", "349", "355"]));
  });
});
