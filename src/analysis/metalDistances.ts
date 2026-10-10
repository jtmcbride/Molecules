import type { AnalysisParameters } from "../domain/analysis";

/**
 * Target metal–donor distances (Å) by metal and donor element, from the peak positions of
 * metal–donor distance distributions in high-resolution (<1.5 Å) mononuclear protein sites:
 * Bazayeva, Andreini & Rosato, Acta Cryst. D80, 362–376 (2024), doi:10.1107/S2059798324003152
 * (CC BY 4.0). Transition metals: Fig. 6. Na, K, Mg, Ca: Fig. 3 and Section 3.1. Where a donor
 * element has several residue-specific peaks, the entry is a representative value of the main
 * peaks listed in `basis`. The acceptance tolerance is this application's policy, not part of
 * the source.
 */
export const METAL_DISTANCE_TABLE_VERSION = "bazayeva-2024-v1";
interface Target {
  distance: number;
  basis: string;
}
export const METAL_TARGETS: Record<
  string,
  Partial<Record<"O" | "N" | "S", Target>>
> = {
  NA: {
    O: {
      distance: 2.4,
      basis: "main-chain O peak 2.35 Å; Asp Oδ1 about 2.4 Å",
    },
  },
  K: {
    O: {
      distance: 2.7,
      basis: "main-chain O peak about 2.7 Å; Asp Oδ1/Glu Oε1 2.7 Å",
    },
  },
  MG: {
    O: {
      distance: 2.1,
      basis: "Asp/Glu OX1 and Asn Oδ1 about 2.1 Å (main-chain O about 2.25 Å)",
    },
    N: { distance: 2.2, basis: "His Nε2 2.2 Å" },
  },
  CA: {
    O: {
      distance: 2.35,
      basis: "main-chain O about 2.3 Å; Asp Oδ1 2.4 Å; Glu Oε1 2.3–2.4 Å",
    },
  },
  MN: {
    O: { distance: 2.12, basis: "Asp Oδ1 2.13 Å; Glu Oε1 2.10 Å" },
    N: { distance: 2.19, basis: "His Nε2 2.19 Å" },
  },
  FE: {
    O: {
      distance: 2.03,
      basis: "Asp Oδ1 2.11 Å; Glu Oε1 1.99 Å; Tyr OH 1.99 Å",
    },
    N: { distance: 2.02, basis: "His Nε2 2.02 Å" },
    S: { distance: 2.32, basis: "Cys Sγ 2.32 Å; Met Sδ 2.32 Å" },
  },
  NI: {
    O: { distance: 2.2, basis: "Asp Oδ1 2.20 Å" },
    N: { distance: 2.1, basis: "His Nδ1/Nε2 peaks 1.94–2.25 Å" },
  },
  CU: {
    N: { distance: 2.03, basis: "His Nδ1/Nε2 2.03 Å" },
    S: { distance: 2.2, basis: "Cys Sγ 2.20 Å (Met Sδ 2.53 Å)" },
  },
  ZN: {
    O: { distance: 1.97, basis: "Asp Oδ1 1.97 Å; Glu Oε1 1.97 Å" },
    N: { distance: 2.04, basis: "His Nδ1 2.05 Å; Nε2 2.03 Å" },
    S: { distance: 2.32, basis: "Cys Sγ 2.32 Å" },
  },
};

export interface MetalLimit {
  limit: number;
  target?: number;
  source: "element_specific" | "uniform" | "uniform_fallback";
}

/** Maximum accepted metal–donor distance for this pair under the request's policy. */
export function metalDistanceLimit(
  metalElement: string,
  donorElement: string,
  p: AnalysisParameters,
): MetalLimit {
  if (p.metalDistancePolicy !== "element_specific")
    return { limit: p.metalCutoff, source: "uniform" };
  const target =
    METAL_TARGETS[metalElement.toUpperCase()]?.[
      donorElement.toUpperCase() as "O" | "N" | "S"
    ];
  return target
    ? {
        limit: target.distance + p.metalTolerance,
        target: target.distance,
        source: "element_specific",
      }
    : { limit: p.metalCutoff, source: "uniform_fallback" };
}

/** Search radius covering every pair the policy could accept. */
export function metalSearchDistance(p: AnalysisParameters): number {
  if (p.metalDistancePolicy !== "element_specific") return p.metalCutoff;
  const largest = Math.max(
    ...Object.values(METAL_TARGETS).flatMap((donors) =>
      Object.values(donors).map((t) => t!.distance),
    ),
  );
  return Math.max(p.metalCutoff, largest + p.metalTolerance);
}
