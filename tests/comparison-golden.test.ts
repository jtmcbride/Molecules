import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { correspondence } from "../src/comparison/correspondence";
import { buildFingerprint } from "../src/comparison/fingerprint";
import { siteDifferences } from "../src/comparison/siteDifferences";
import { superpose } from "../src/comparison/superposition";
import { comparisonSide } from "./helpers/comparison";
import { analyzeLigand } from "./helpers/fingerprint";
/*
 * Golden comparison output: correspondence, superposition, fingerprints and binding-site
 * differences for each fixture pair. Any change to comparison results must be deliberate:
 * regenerate with UPDATE_COMPARISON_GOLDEN=1, bump COMPARISON_VERSION and record why in
 * validation/COMPARISON.md. DUMP_COMPARISON_GOLDEN=<dir> writes the canonical JSON per case.
 * Numbers are rounded to 1e-6 so the hashes do not depend on floating-point summation order.
 */
const GOLDEN = "tests/fixtures/golden/comparison.json";
const CASES = [
  { name: "3PTB-1S0R-BEN", ref: "3PTB", cmp: "1S0R", ligand: "BEN" },
  { name: "1S0R-1S0Q-apo", ref: "1S0R", cmp: "1S0Q", ligand: "BEN" },
  { name: "2DN2-2DN1-HEM", ref: "2DN2", cmp: "2DN1", ligand: "HEM" },
  { name: "4HHB-1HHO-HEM", ref: "4HHB", cmp: "1HHO", ligand: "HEM" },
] as const;

const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v) =>
    typeof v === "number" && !Number.isInteger(v)
      ? Math.round(v * 1e6) / 1e6
      : v,
  );

describe("golden comparison output", async () => {
  const golden: Record<string, string> = process.env.UPDATE_COMPARISON_GOLDEN
    ? {}
    : JSON.parse(await readFile(GOLDEN, "utf8"));
  const computed: Record<string, string> = {};
  for (const c of CASES)
    it(c.name, async () => {
      const [a, b] = await Promise.all([
        comparisonSide(c.ref),
        comparisonSide(c.cmp),
      ]);
      const hasLigand = (side: typeof a) =>
        side.snapshot.ligands.some((l) => l.componentId === c.ligand);
      const runA = await analyzeLigand(a, c.ligand);
      const runB = hasLigand(b) ? await analyzeLigand(b, c.ligand) : null;
      const corr = correspondence(a.side, b.side);
      const fit = superpose(corr, a.snapshot, b.snapshot, "global");
      const ligandIds = (run: typeof runA | null) =>
        run
          ? run.request.ligandResidueIds?.length
            ? run.request.ligandResidueIds
            : [run.request.ligandResidueId]
          : [];
      const output = {
        correspondence: corr,
        superposition: fit,
        fingerprint: buildFingerprint(
          {
            label: c.ref,
            snapshot: a.snapshot,
            run: runA,
            mappings: a.mappings,
          },
          [
            {
              id: c.cmp,
              label: c.cmp,
              snapshot: b.snapshot,
              run: runB,
              correspondence: corr,
            },
          ],
        ),
        site: siteDifferences(
          a.snapshot,
          b.snapshot,
          corr,
          fit,
          ligandIds(runA),
          ligandIds(runB),
        ),
      };
      const text = canonical(output);
      computed[c.name] = createHash("sha256").update(text).digest("hex");
      if (process.env.DUMP_COMPARISON_GOLDEN) {
        await mkdir(process.env.DUMP_COMPARISON_GOLDEN, { recursive: true });
        await writeFile(
          `${process.env.DUMP_COMPARISON_GOLDEN}/${c.name}.json`,
          JSON.stringify(JSON.parse(text), null, 1),
        );
      }
      if (process.env.UPDATE_COMPARISON_GOLDEN) {
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
