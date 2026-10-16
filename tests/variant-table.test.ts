import { beforeAll, describe, expect, it } from "vitest";
import { biologyFixture } from "./helpers/biology";
import {
  BIOLOGY_VERSION,
  type InterpretationSnapshot,
} from "../src/domain/biology";
import { variantLabel } from "../src/biology/variants";
import {
  filterVariants,
  variantBounds,
  variantTable,
  type VariantFilters,
} from "../src/biology/variantTable";
import { projectAnnotations } from "../src/biology/projection";
import type { AnalysisRun } from "../src/domain/analysis";

function interpretation(
  p: Awaited<ReturnType<typeof biologyFixture>>,
): InterpretationSnapshot {
  return {
    schemaVersion: 1,
    id: "fixture",
    version: BIOLOGY_VERSION,
    snapshotId: p.snapshot.id,
    sourceHash: p.source.contentHash,
    entryId: p.source.id,
    createdAt: p.source.fetchedAt,
    resourceIds: [],
    resourceRefs: [],
    proteins: p.proteins,
    annotations: p.annotations,
    mappings: p.mappings,
    coverage: p.coverage,
    projections: p.projections,
    evidence: p.evidence,
    qualityFlags: [],
  };
}
const defaults: VariantFilters = {
  type: "",
  text: "",
  observed: "all",
  contact: "all",
};
let hb: InterpretationSnapshot, proteinId: string;
beforeAll(async () => {
  hb = interpretation(await biologyFixture("4HHB"));
  proteinId = hb.proteins.find((p) => p.accession === "P68871")!.id;
});
const sickle = (model: ReturnType<typeof variantTable>) =>
  model.rows.find((r) => variantLabel(r.annotation) === "E7V")!;

describe("protein-level variant discovery", () => {
  it("counts source features once across chains and preserves the source records and sequence order", () => {
    const before = JSON.stringify(hb);
    const model = variantTable(hb, proteinId);
    expect(model.rows).toHaveLength(261);
    expect(sickle(model).chains).toHaveLength(2);
    expect(
      sickle(model).chains.every(
        (c) =>
          c.state.state === "original" && c.observedPositions.join() === "7",
      ),
    ).toBe(true);
    expect(model.rows.map((r) => r.annotation.start.position)).toEqual(
      model.rows
        .map((r) => r.annotation.start.position)
        .sort((a, b) => a! - b!),
    );
    expect(
      filterVariants(model, { ...defaults, text: "rs334" }).map((r) =>
        variantLabel(r.annotation),
      ),
    ).toEqual(["E7A", "E7V"]);
    expect(filterVariants(model, { ...defaults, text: "  e7v  " })).toEqual([
      sickle(model),
    ]);
    expect(filterVariants(model, { ...defaults, type: "Mutagenesis" })).toEqual(
      [],
    );
    expect(JSON.stringify(hb)).toBe(before);
  });

  it("does not multiply source totals when an assembly duplicates a deposited chain", async () => {
    const deposited = interpretation(await biologyFixture("1HHO"));
    const assembly = interpretation(await biologyFixture("1HHO", "1"));
    const id = deposited.proteins.find((p) => p.accession === "P68871")!.id;
    const a = variantTable(deposited, id),
      b = variantTable(assembly, id);
    expect(a.rows).toHaveLength(261);
    expect(b.rows.map((r) => r.annotation.id)).toEqual(
      a.rows.map((r) => r.annotation.id),
    );
    expect(sickle(a).chains).toHaveLength(1);
    expect(sickle(b).chains).toHaveLength(2);
    expect(new Set(sickle(b).chains.map((c) => c.chainInstanceId)).size).toBe(
      2,
    );
  });

  it("returns no curated records for P00760", async () => {
    const p = interpretation(await biologyFixture());
    expect(variantTable(p, p.proteins[0].id).rows).toEqual([]);
  });

  it("preserves P01009 multi-residue replacements and separates mutagenesis", async () => {
    const p = interpretation(await biologyFixture("1OPH"));
    const model = variantTable(p, p.proteins[0].id);
    const multi = model.rows.find(
      (r) =>
        r.annotation.start.position === 190 &&
        r.annotation.end.position === 198,
    )!;
    expect(variantLabel(multi.annotation)).toBe("QGKIVDLVK190–198GFQNAILVR");
    expect(multi.chains[0].observedPositions).toEqual([
      190, 191, 192, 193, 194, 195, 196, 197, 198,
    ]);
    expect(multi.chains[0].residueIds).toHaveLength(9);
    // Artificially omit one mapped position: keep the eight observable positions selectable.
    const partial = {
      ...p,
      mappings: p.mappings.filter((m) => m.uniprotPosition !== 190),
    };
    partial.projections = projectAnnotations(
      partial.annotations,
      partial.mappings,
    );
    const partialRow = variantTable(partial, p.proteins[0].id).rows.find(
      (r) => r.annotation.id === multi.annotation.id,
    )!;
    expect(partialRow.chains[0].residueIds).toHaveLength(8);
    expect(partialRow.chains[0].outsideCount).toBe(1);
    expect(partialRow.chains[0].state.state).toBe("not_evaluated");
    expect(
      filterVariants(model, { ...defaults, type: "Mutagenesis" }).length,
    ).toBeGreaterThan(0);
    expect(
      filterVariants(model, { ...defaults, type: "Natural variant" }).every(
        (r) => r.annotation.type === "Natural variant",
      ),
    ).toBe(true);
  });

  it("keeps records outside a fragment, missing coordinates, ambiguity and uncertain bounds with reasons", () => {
    // Artificially shorten beta mappings and remove/ambiguate positions; source fixture remains intact.
    const p = structuredClone(hb);
    const a = sickle(variantTable(p, proteinId)).annotation;
    p.annotations = [a];
    p.mappings = p.mappings.filter(
      (m) => m.proteinId !== proteinId || m.uniprotPosition > 7,
    );
    p.projections = projectAnnotations(p.annotations, p.mappings);
    const outside = sickle(variantTable(p, proteinId));
    expect(
      outside.chains.every(
        (c) =>
          c.outsideCount === 1 &&
          c.state.state === "not_evaluated" &&
          c.state.reason.includes("outside"),
      ),
    ).toBe(true);
    expect(
      filterVariants(variantTable(p, proteinId), {
        ...defaults,
        observed: "unobserved",
      }),
    ).toHaveLength(1);
    p.mappings = hb.mappings.map((m) =>
      m.uniprotPosition === 7 ? { ...m, residueId: undefined } : m,
    );
    p.projections = projectAnnotations(p.annotations, p.mappings);
    expect(
      sickle(variantTable(p, proteinId)).chains.every(
        (c) => c.unobservedPositions.join() === "7" && !c.residueIds.length,
      ),
    ).toBe(true);
    p.mappings = hb.mappings.map((m) =>
      m.uniprotPosition === 7 ? { ...m, status: "ambiguous" as const } : m,
    );
    p.projections = projectAnnotations(p.annotations, p.mappings);
    expect(
      sickle(variantTable(p, proteinId)).chains.every(
        (c) => c.ambiguousPositions.join() === "7" && !c.residueIds.length,
      ),
    ).toBe(true);
    a.start.modifier = "less_than";
    p.mappings = hb.mappings;
    p.projections = projectAnnotations(p.annotations, p.mappings);
    expect(variantBounds(a)).toBe("<7–7");
    expect(
      sickle(variantTable(p, proteinId)).chains.every(
        (c) =>
          !c.residueIds.length &&
          c.outsideCount === null &&
          c.state.state === "not_evaluated" &&
          c.state.reason.includes("uncertain"),
      ),
    ).toBe(true);
  });

  it("does not turn missing or stale analysis into zero contacts; distinguishes receptor contact kinds", () => {
    const model = variantTable(hb, proteinId);
    expect(model.contactsAvailable).toBe(false);
    expect(
      filterVariants(model, { ...defaults, contact: "chemical" }),
    ).toHaveLength(261);
    const row = sickle(model),
      receptor = { residueId: row.chains[0].residueIds[0] };
    // Synthetic interactions isolate contact membership from chemistry computation (covered by goldens).
    const analysis = {
      snapshotId: hb.snapshotId,
      interactions: [
        { type: "proximity_contact", receptor },
        { type: "hydrogen_bond", receptor },
        {
          type: "steric_clash",
          receptor: { residueId: "elsewhere" },
          ligand: receptor,
        },
      ],
    } as AnalysisRun;
    const result = variantTable(hb, proteinId, analysis);
    expect(result.contactsAvailable).toBe(true);
    expect(sickle(result).chains[0].contacts).toEqual([
      "proximity",
      "chemical",
    ]);
    expect(
      filterVariants(result, { ...defaults, contact: "chemical" }),
    ).toContainEqual(sickle(result));
    expect(filterVariants(result, { ...defaults, contact: "clash" })).toEqual(
      [],
    );
    expect(
      variantTable(hb, proteinId, { ...analysis, snapshotId: "different" })
        .contactsAvailable,
    ).toBe(false);
  });
});
