import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareStructure } from "../src/analysis/prepare";
import { analyze } from "../src/analysis/engine";
import { DEFAULT_PARAMETERS, type AnalysisRun } from "../src/domain/analysis";
import { isHydrogenElement, normalizeElement } from "../src/domain/elements";
import type { StructureSource } from "../src/domain/types";
// Synthetic: rewrites only the atom_site.type_symbol column of an artificial fixture.
function caseSymbols(text: string, change: (symbol: string) => string) {
  return text
    .split("\n")
    .map((line) => {
      if (!/^(ATOM|HETATM) /.test(line)) return line;
      const fields = line.split(" ");
      fields[2] = change(fields[2]);
      return fields.join(" ");
    })
    .join("\n");
}
async function run(name: string, transform: (s: string) => string = (s) => s) {
  const bytes = new TextEncoder().encode(
    transform(await readFile(`tests/fixtures/${name}.cif`, "utf8")),
  );
  const source: StructureSource = {
    id: name,
    name,
    kind: "local",
    format: "mmcif",
    binary: false,
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    fetchedAt: "2026-10-10T00:00:00Z",
  };
  const p = await prepareStructure(source, 0, "");
  const request = {
    ligandResidueId: p.snapshot.ligands[0].residueId,
    receptorChainIds: p.snapshot.chains
      .filter((c) => c.type === "polymer")
      .map((c) => c.id),
    parameters: { ...DEFAULT_PARAMETERS },
  };
  return {
    snapshot: p.snapshot,
    run: await analyze(p.structure, p.snapshot, p.selectionIndex, request, []),
  };
}
/** Scientific fields only: identifiers derived from source bytes, timestamps and timing are excluded. */
function scientific(run: AnalysisRun) {
  const { elapsedMilliseconds: _, ...stats } = run.stats;
  const fields = {
    interactions: run.interactions,
    evaluation: run.evaluation,
    qualityFlags: run.qualityFlags,
    assumptions: run.assumptions,
    bonds: run.bonds,
    residues: run.residues,
    stats,
  };
  return JSON.parse(
    JSON.stringify(fields).replaceAll(run.sourceHash, "SOURCE"),
  );
}
describe("element-symbol normalization", () => {
  it("detects hydrogen isotopes independent of case and does not confuse mercury or helium", () => {
    for (const symbol of ["H", "h", "D", "d", "T", "t", " H "])
      expect(isHydrogenElement(symbol)).toBe(true);
    for (const symbol of ["HG", "Hg", "HE", "He", "C", "N", "ZN", ""])
      expect(isHydrogenElement(symbol)).toBe(false);
    expect(normalizeElement("Zn")).toBe("ZN");
  });
  it("gives identical eligibility, completeness and explicit-hydrogen classification for lowercase symbols", async () => {
    const upper = await run("hydrogen-geometry"),
      lower = await run("hydrogen-geometry", (s) =>
        caseSymbols(s, (x) => x.toLowerCase()),
      );
    expect(lower.snapshot.atoms.map((a) => a.element)).toEqual(
      upper.snapshot.atoms.map((a) => a.element),
    );
    expect(
      lower.snapshot.atoms.every((a) => a.element === a.element.toUpperCase()),
    ).toBe(true);
    expect(scientific(lower.run)).toEqual(scientific(upper.run));
    const hbond = lower.run.interactions.find(
      (i) => i.type === "hydrogen_bond",
    )!;
    expect(hbond.hydrogenMode).toBe("explicit");
    expect(hbond.classification).toBe("geometry_supported");
  });
  it("keeps metal identity and coordination for mixed-case symbols", async () => {
    const upper = await run("metal-coordination"),
      mixed = await run("metal-coordination", (s) =>
        caseSymbols(s, (x) => x[0] + x.slice(1).toLowerCase()),
      );
    expect(scientific(mixed.run)).toEqual(scientific(upper.run));
    expect(
      mixed.run.interactions.find((i) => i.type === "metal_coordination")!
        .geometry!.metalElement,
    ).toBe("ZN");
  });
});
