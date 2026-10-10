import type {
  AnalysisParameters,
  MolecularInteraction,
} from "../domain/analysis";
import type { StructureQuality } from "../domain/types";

/**
 * Distance between a measured quantity and the cutoff that admitted it (Å). Positive
 * values lie inside the rule. Centroid rules use the centroid distance, water bridges
 * their longer leg and steric clashes the overlap above the minimum.
 */
export function cutoffMargin(
  i: MolecularInteraction,
  p: AnalysisParameters,
): number | undefined {
  switch (i.type) {
    case "proximity_contact":
      return p.proximityCutoff - i.distanceAngstrom;
    case "hydrogen_bond":
      return p.hydrogenBondCutoff - i.distanceAngstrom;
    case "hydrophobic_contact":
      return p.hydrophobicCutoff - i.distanceAngstrom;
    case "halogen_bond":
      return p.halogenBondCutoff - i.distanceAngstrom;
    case "salt_bridge":
      return p.saltBridgeCutoff - i.distanceAngstrom;
    case "metal_coordination":
      return (
        (i.geometry?.metalLimitAngstrom ?? p.metalCutoff) - i.distanceAngstrom
      );
    case "pi_stacking":
      return i.geometry?.centroidDistanceAngstrom === undefined
        ? undefined
        : p.piStackingCutoff - i.geometry.centroidDistanceAngstrom;
    case "cation_pi":
      return i.geometry?.centroidDistanceAngstrom === undefined
        ? undefined
        : p.cationPiCutoff - i.geometry.centroidDistanceAngstrom;
    case "water_bridge":
      return i.geometry?.waterLegDistancesAngstrom
        ? p.waterLegMax - Math.max(...i.geometry.waterLegDistancesAngstrom)
        : undefined;
    case "steric_clash":
      return i.geometry?.overlapAngstrom === undefined
        ? undefined
        : i.geometry.overlapAngstrom - p.clashOverlapMin;
  }
}

/**
 * Estimated standard uncertainty of an interatomic distance: √2 × the per-atom
 * coordinate error, for two independent atoms with average B factors.
 */
export function distanceUncertainty(
  quality: StructureQuality | undefined,
): number | undefined {
  return quality?.coordinateErrorAngstrom === undefined
    ? undefined
    : Math.SQRT2 * quality.coordinateErrorAngstrom;
}

/** The measurement lies within one distance uncertainty of its cutoff. Display metadata only. */
export function isBorderline(
  i: MolecularInteraction,
  p: AnalysisParameters,
  sigma: number | undefined,
): boolean {
  const margin = cutoffMargin(i, p);
  return sigma !== undefined && margin !== undefined && margin < sigma;
}
