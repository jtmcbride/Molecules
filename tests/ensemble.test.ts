import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareStructure } from "../src/analysis/prepare";
import { analyze } from "../src/analysis/engine";
import {
  DEFAULT_PARAMETERS,
  type AnalysisParameters,
} from "../src/domain/analysis";
import type { StructureSource } from "../src/domain/types";

async function load(text: string | Uint8Array, id: string) {
  const bytes =
    typeof text === "string" ? new TextEncoder().encode(text) : text;
  const source: StructureSource = {
    id,
    name: id,
    kind: "local",
    format: "mmcif",
    binary: false,
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    fetchedAt: "2026-10-10T00:00:00Z",
  };
  return prepareStructure(source, 0, "");
}
async function run(
  p: Awaited<ReturnType<typeof load>>,
  component: string,
  parameters: Partial<AnalysisParameters> = {},
  authSeqId?: string,
) {
  const ligand = p.snapshot.ligands.find(
    (l) =>
      l.componentId === component &&
      (!authSeqId ||
        p.snapshot.residues.find((r) => r.id === l.residueId)!.authSeqId ===
          authSeqId),
  )!;
  return analyze(
    p.structure,
    p.snapshot,
    p.selectionIndex,
    {
      ligandResidueId: ligand.residueId,
      receptorChainIds: p.snapshot.chains
        .filter((c) => c.type === "polymer")
        .map((c) => c.id),
      parameters: { ...DEFAULT_PARAMETERS, ...parameters },
    },
    [],
  );
}

/*
 * Artificial: the hydrogen-geometry fixture with SER OG split into conformers. A (occupancy
 * 0.6) keeps OG 2.8 Å from the acetamide O1; B (0.4) turns OG away (4.6 Å). HG is removed.
 */
async function twoConformerSerine(ligandAltlocs = false) {
  const lines = (await readFile("tests/fixtures/hydrogen-geometry.cif", "utf8"))
    .split("\n")
    .filter((l) => !l.includes(" HG ") && !l.startsWith("SER OG HG"));
  return lines
    .flatMap((l) => {
      if (l.startsWith("ATOM 6 O OG ."))
        return [
          "ATOM 6 O OG A SER A 1 1 ? 0 0 0 0.6 10 1 SER A OG 1",
          "ATOM 12 O OG B SER A 1 1 ? -1.8 -0.6 0 0.4 10 1 SER A OG 1",
        ];
      if (ligandAltlocs && l.startsWith("HETATM 11 C C2 ."))
        return [
          "HETATM 11 C C2 A ACM B 2 . ? 4.9 0.9 0 0.5 10 1 ACM B C2 1",
          "HETATM 13 C C2 B ACM B 2 . ? 4.8 1.4 0 0.5 10 1 ACM B C2 1",
        ];
      return [l];
    })
    .join("\n");
}

describe("per-conformer ensemble analysis (R5)", () => {
  it("reports an H-bond present only in conformer A, with its occupancy", async () => {
    const p = await load(await twoConformerSerine(), "ensemble-ser");
    const r = await run(p, "ACM");
    expect(r.request.parameters.conformerPolicy).toBe("ensemble");
    expect(r.stats.conformerLabels).toEqual(["A", "B"]);
    const hb = r.interactions.find((i) => i.type === "hydrogen_bond")!;
    expect(hb.conformerPresence).toBe("partial");
    expect(hb.conformers!.map((c) => c.altId)).toEqual(["A"]);
    expect(hb.conformers![0].occupancy).toBeCloseTo(0.6, 6);
    expect(p.snapshot.atoms[hb.receptor.atomIndices[0]].altId).toBe("A");
    // Contacts not involving the disordered atom appear in both conformers.
    expect(
      r.interactions.some(
        (i) => i.type === "proximity_contact" && i.conformerPresence === "all",
      ),
    ).toBe(true);
    expect(
      r.qualityFlags.some((q) =>
        q.startsWith(
          "Per-conformer ensemble over alternate-conformer labels A, B.",
        ),
      ),
    ).toBe(true);
  });
  it("loses that residue entirely under exclude_disordered and keeps one conformer under preferred_residue", async () => {
    const p = await load(await twoConformerSerine(), "ensemble-ser-policies");
    await expect(
      run(p, "ACM", { conformerPolicy: "exclude_disordered" }),
    ).rejects.toThrow("receptor has no eligible heavy atoms");
    const preferred = await run(p, "ACM", {
      conformerPolicy: "preferred_residue",
    });
    expect(preferred.interactions.some((i) => i.type === "hydrogen_bond")).toBe(
      true,
    );
    expect(
      preferred.interactions.every((i) => i.conformers === undefined),
    ).toBe(true);
  });
  it("analyzes a ligand with alternate conformers instead of refusing it", async () => {
    const p = await load(await twoConformerSerine(true), "ensemble-ligand");
    await expect(
      run(p, "ACM", { conformerPolicy: "exclude_disordered" }),
    ).rejects.toThrow("This ligand has alternate conformers");
    const r = await run(p, "ACM");
    expect(r.stats.conformerLabels).toEqual(["A", "B"]);
    expect(r.interactions.length).toBeGreaterThan(0);
  });
  it("1T46: imatinib contacts to the disordered Val654 are recovered with per-conformer presence", async () => {
    const p = await load(
      new Uint8Array(
        gunzipSync(await readFile("tests/fixtures/reference-set/1T46.cif.gz")),
      ),
      "1T46",
    );
    const r = await run(p, "STI");
    expect(r.stats.conformerLabels!.length).toBeGreaterThanOrEqual(2);
    const residueOf = (i: number) =>
      p.snapshot.residues[p.snapshot.atomBuffer.residueIndices[i]];
    const val654 = r.interactions.filter(
      (i) => residueOf(i.receptor.atomIndices[0]).authSeqId === "654",
    );
    expect(val654.some((i) => i.type === "hydrophobic_contact")).toBe(true);
    expect(
      r.interactions.every((i) => i.conformers && i.conformers.length >= 1),
    ).toBe(true);
    const old = await run(p, "STI", { conformerPolicy: "exclude_disordered" });
    expect(
      old.interactions.some(
        (i) => residueOf(i.receptor.atomIndices[0]).authSeqId === "654",
      ),
    ).toBe(false);
  });
});
