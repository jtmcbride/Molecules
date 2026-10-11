import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { summarizeBindingSite } from "../src/biology/projection";
import { variantConsequences } from "../src/biology/consequences";
import { interpretationVariantStates } from "../src/biology/variants";
import {
  BIOLOGY_VERSION,
  featureCategory,
  type InterpretationSnapshot,
} from "../src/domain/biology";
import { comparisonSide } from "./helpers/comparison";
import { analyzeLigand } from "./helpers/fingerprint";
/*
 * Golden curated-variant output: variant records, their projections, deposited-residue states,
 * binding-site variant overlaps and structural consequences. Any change must be deliberate:
 * regenerate with UPDATE_VARIANTS_GOLDEN=1, bump BIOLOGY_VERSION when interpretation semantics
 * change, and record why in validation/VARIANTS.md. DUMP_VARIANTS_GOLDEN=<dir> writes the
 * canonical JSON per case.
 */
const GOLDEN = "tests/fixtures/golden/variants.json";
const CASES = [
  { name: "4HHB-HEM-B", entry: "4HHB", ligand: "HEM", chain: "B" },
  { name: "2HBS-HEM-B", entry: "2HBS", ligand: "HEM", chain: "B" },
  { name: "3PTB-BEN-A", entry: "3PTB", ligand: "BEN", chain: "A" },
  { name: "1OPH", entry: "1OPH", ligand: null, chain: "A" },
] as const;

describe("golden curated-variant output", async () => {
  const golden: Record<string, string> = process.env.UPDATE_VARIANTS_GOLDEN
    ? {}
    : JSON.parse(await readFile(GOLDEN, "utf8"));
  const computed: Record<string, string> = {};
  for (const c of CASES)
    it(c.name, async () => {
      const p = await comparisonSide(c.entry);
      const interpretation: InterpretationSnapshot = {
        schemaVersion: 1,
        id: `pinned-${c.entry}`,
        version: BIOLOGY_VERSION,
        snapshotId: p.snapshot.id,
        sourceHash: p.source.contentHash,
        entryId: c.entry,
        createdAt: "2026-10-10T00:00:00Z",
        resourceIds: [],
        resourceRefs: [],
        proteins: p.proteins,
        annotations: p.annotations,
        mappings: p.mappings,
        coverage: p.coverage,
        projections: p.projections,
        evidence: p.evidence,
        qualityFlags: [],
        ligands: [],
      };
      const variants = p.annotations.filter(
        (a) => featureCategory(a.type) === "variant",
      );
      const ids = new Set(variants.map((a) => a.id));
      const run = c.ligand ? await analyzeLigand(p, c.ligand, c.chain) : null;
      const output = {
        version: BIOLOGY_VERSION,
        records: variants,
        projections: p.projections.filter((pr) => ids.has(pr.annotationId)),
        states: interpretationVariantStates(interpretation),
        bindingSiteVariants: run
          ? summarizeBindingSite(interpretation, run, c.ligand!).variants
          : null,
        consequences: run
          ? variantConsequences(interpretation, run, p.snapshot)
          : null,
      };
      const text = JSON.stringify(output);
      computed[c.name] = createHash("sha256").update(text).digest("hex");
      if (process.env.DUMP_VARIANTS_GOLDEN) {
        await mkdir(process.env.DUMP_VARIANTS_GOLDEN, { recursive: true });
        await writeFile(
          `${process.env.DUMP_VARIANTS_GOLDEN}/${c.name}.json`,
          JSON.stringify(output, null, 1),
        );
      }
      if (process.env.UPDATE_VARIANTS_GOLDEN) {
        await writeFile(
          GOLDEN,
          JSON.stringify(
            {
              ...JSON.parse(await readFile(GOLDEN, "utf8").catch(() => "{}")),
              ...computed,
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }
      expect(computed[c.name]).toBe(golden[c.name]);
    });
});
