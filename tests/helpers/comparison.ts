import { biologyFixture } from "./biology";
import type { ComparisonSide } from "../../src/comparison/correspondence";

/** A comparison side built from frozen coordinates and SIFTS/UniProt fixtures. */
export async function comparisonSide(id: string, assembly = "") {
  const p = await biologyFixture(id, assembly);
  return {
    ...p,
    side: {
      snapshot: p.snapshot,
      interpretation: { mappings: p.mappings, coverage: p.coverage },
    } satisfies ComparisonSide,
  };
}
