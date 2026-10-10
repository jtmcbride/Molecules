import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareStructure } from "../src/analysis/prepare";
import { analyze } from "../src/analysis/engine";
import {
  DEFAULT_PARAMETERS,
  type AnalysisParameters,
  type AnalysisRun,
} from "../src/domain/analysis";
import type { StructureSource } from "../src/domain/types";

async function load(bytes: Uint8Array, id: string) {
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
) {
  const ligand = p.snapshot.ligands.find((l) => l.componentId === component)!;
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
/** Bond distance between two atoms over the run's recorded covalent bonds (BFS). */
function bondDistance(r: AnalysisRun, a: number, b: number, limit = 4) {
  const adjacency = new Map<number, number[]>();
  for (const x of r.bonds)
    for (const [p, q] of [
      [x.atomA, x.atomB],
      [x.atomB, x.atomA],
    ])
      adjacency.set(p, [...(adjacency.get(p) ?? []), q]);
  let frontier = [a];
  const seen = new Set([a]);
  for (let d = 1; d <= limit; d++) {
    const next: number[] = [];
    for (const atom of frontier)
      for (const n of adjacency.get(atom) ?? []) {
        if (n === b) return d;
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    frontier = next;
  }
  return Infinity;
}
const names = (p: Awaited<ReturnType<typeof load>>, i: number) =>
  p.snapshot.atoms[i].name;

describe("covalent ligands (5P9J ibrutinib–BTK, 4G5J afatinib–EGFR)", () => {
  for (const [accession, component, cys, cysAtom, ligAtom] of [
    ["5P9J", "8E8", "481", "SG", "CAA"],
    ["4G5J", "0WN", "797", "SG", "C30"],
  ] as const)
    it(`${accession}: records the deposited Cys${cys} attachment and excludes pairs within three bonds across it`, async () => {
      const p = await load(
        new Uint8Array(
          gunzipSync(
            await readFile(`tests/fixtures/reference-set/${accession}.cif.gz`),
          ),
        ),
        accession,
      );
      const r = await run(p, component);
      expect(r.covalentAttachments).toHaveLength(1);
      const link = r.covalentAttachments![0];
      expect([
        names(p, link.ligandAtom),
        names(p, link.receptorAtom),
        link.provenance,
      ]).toEqual([ligAtom, cysAtom, "dictionary_or_explicit"]);
      const residue =
        p.snapshot.residues[
          p.snapshot.atomBuffer.residueIndices[link.receptorAtom]
        ];
      expect([residue.componentId, residue.authSeqId]).toEqual(["CYS", cys]);
      for (const i of r.interactions)
        expect(
          bondDistance(r, i.closestAtomPair[0], i.closestAtomPair[1], 3),
        ).toBe(Infinity);
      expect(
        r.qualityFlags.some((q) =>
          q.startsWith(`Covalently attached ligand: ${component}`),
        ),
      ).toBe(true);
      expect(r.ruleSetVersion).toBe("molstar-5.13.1-ligand-3");
    });
});

describe("short hydrogen bonds and unrecorded attachments (synthetic)", () => {
  // Artificial: the hydrogen-geometry fixture with the acetamide acceptor moved toward SER OG.
  const moveLigand = (text: string, dx: number) =>
    text
      .split("\n")
      .map((line) => {
        if (!line.startsWith("HETATM")) return line;
        const f = line.split(" ");
        f[10] = String(Number(f[10]) + dx);
        return f.join(" ");
      })
      .join("\n");
  it("treats a typed donor–acceptor overlap as a short hydrogen bond, and keeps it as a clash without typing", async () => {
    const text = await readFile("tests/fixtures/hydrogen-geometry.cif", "utf8");
    // OG at x=0, O1 at x=2.8 → 2.40 Å: O–O overlap 3.04 − 2.40 = 0.64 Å ≥ 0.6 Å.
    const p = await load(
      new TextEncoder().encode(moveLigand(text, -0.4)),
      "short-hbond",
    );
    const typed = await run(p, "ACM");
    const pair = (i: AnalysisRun["interactions"][number]) =>
      [names(p, i.closestAtomPair[0]), names(p, i.closestAtomPair[1])]
        .sort()
        .join(":");
    expect(
      typed.interactions.some(
        (i) => i.type === "steric_clash" && pair(i) === "O1:OG",
      ),
    ).toBe(false);
    const hbond = typed.interactions.find(
      (i) => i.type === "hydrogen_bond" && pair(i) === "O1:OG",
    )!;
    expect(hbond.distanceAngstrom).toBeCloseTo(2.4, 5);
    expect(
      hbond.notes.some((n) => n.startsWith("Short donor–acceptor distance")),
    ).toBe(true);
    expect(
      typed.qualityFlags.some((q) =>
        q.includes("treated as short hydrogen bonds"),
      ),
    ).toBe(true);
    const untyped = await run(p, "ACM", { classifyChemistry: false });
    expect(
      untyped.interactions.some(
        (i) => i.type === "steric_clash" && pair(i) === "O1:OG",
      ),
    ).toBe(true);
  });
  it("records geometry-inferred bonds, flags unbonded pairs within covalent distance, and stays silent beyond it", async () => {
    // Artificial: SER HG removed so the probe pair is OG···O1 only (an explicit H 0.6 Å
    // from O1 would itself be bonded by Mol* and make OG–O1 a two-bond pair).
    const text = (
      await readFile("tests/fixtures/hydrogen-geometry.cif", "utf8")
    )
      .split("\n")
      .filter((l) => !l.includes(" HG ") && !l.startsWith("SER OG HG"))
      .join("\n");
    const at = async (d: number) => {
      const p = await load(
        new TextEncoder().encode(moveLigand(text, d - 2.8)),
        `probe-${d}`,
      );
      const r = await run(p, "ACM", { classifyChemistry: false });
      return {
        attachment: r.covalentAttachments?.map((a) => a.provenance) ?? [],
        flagged: r.qualityFlags.some((q) =>
          q.startsWith("Possible unrecorded covalent attachment"),
        ),
      };
    };
    // O+O covalent radii 1.32 Å; the flag bound is 1.72 Å. Mol* infers a bond at ≤1.5 Å here.
    expect(await at(1.45)).toEqual({
      attachment: ["geometry_inferred"],
      flagged: false,
    });
    expect(await at(1.65)).toEqual({ attachment: [], flagged: true });
    expect(await at(1.8)).toEqual({ attachment: [], flagged: false });
  });
});

describe("R2 on deposited structures", () => {
  const caseRun = async (accession: string, component: string) => {
    const p = await load(
      new Uint8Array(
        gunzipSync(
          await readFile(`tests/fixtures/reference-set/${accession}.cif.gz`),
        ),
      ),
      accession,
    );
    return { p, r: await run(p, component) };
  };
  const residueOf = (p: Awaited<ReturnType<typeof load>>, atom: number) =>
    p.snapshot.residues[p.snapshot.atomBuffer.residueIndices[atom]];
  it("1OQ5: zinc-coordinating His94/96/119 are not reported as celecoxib hydrogen-bond partners", async () => {
    const { p, r } = await caseRun("1OQ5", "CEL");
    const zincHis = r.interactions.filter(
      (i) =>
        ["hydrogen_bond", "water_bridge", "salt_bridge"].includes(i.type) &&
        ["94", "96", "119"].includes(
          residueOf(p, i.receptor.atomIndices[0]).authSeqId!,
        ),
    );
    expect(zincHis).toEqual([]);
    expect(r.stats.rejections?.metal_bound_residue).toBeGreaterThanOrEqual(3);
  });
  it("1V48: the His86 salt bridge is labeled pH-dependent", async () => {
    const { p, r } = await caseRun("1V48", "HA1");
    const his = r.interactions.find(
      (i) =>
        i.type === "salt_bridge" &&
        residueOf(p, i.receptor.atomIndices[0]).componentId === "HIS",
    )!;
    expect(residueOf(p, his.receptor.atomIndices[0]).authSeqId).toBe("86");
    expect(his.ambiguities).toEqual(["his_protonation"]);
  });
});
