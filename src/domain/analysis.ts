export const ENGINE_VERSION = "contacts-2.1.0";
export const RULESET_VERSION = "molstar-5.13.1-ligand-3";
export type InteractionType =
  | "proximity_contact"
  | "hydrogen_bond"
  | "hydrophobic_contact"
  | "salt_bridge"
  | "pi_stacking"
  | "cation_pi"
  | "metal_coordination"
  | "water_bridge"
  | "steric_clash"
  | "halogen_bond";
/** Why a Mol* candidate edge did not become an interaction. Counted in AnalysisRun.stats.rejections. */
export const REJECTION_REASONS = [
  "mol_refinement_filtered", // Mol* refinement marked the edge redundant (e.g. H-bond overlapping an ionic contact)
  "not_ligand_receptor", // endpoints are not one ligand group and one receptor group
  "unknown_receptor_chemistry",
  "chemistry_not_evaluated", // nonmetal classification disabled or unavailable for this target
  "incomplete_receptor_residue",
  "multi_residue_receptor_group",
  "bonded_endpoints", // one or two covalent bonds apart
  "uncharged_nitrogen_negative", // nitrogen-only negative feature without an explicit negative formal charge
  "unsupported_type", // a Mol* interaction type outside this ruleset
  "metal_bound_residue", // His/Cys coordinating a metal: no salt bridge; that atom has no H-bond
  "metal_distance", // beyond the element-specific metal–donor target plus tolerance
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
/**
 * ensemble (default, ruleset ligand-3): analyze each alternate-conformer label and report
 * per-conformer presence. exclude_disordered: drop residues with alternate conformers.
 * preferred_residue: one recorded conformer per residue (exploratory).
 */
export type ConformerPolicy =
  "ensemble" | "exclude_disordered" | "preferred_residue";
export interface AnalysisParameters {
  proximityCutoff: number;
  hydrogenBondCutoff: number;
  hydrophobicCutoff: number;
  saltBridgeCutoff: number;
  piStackingCutoff: number;
  piOffsetMax: number;
  piAngleDeviation: number;
  cationPiCutoff: number;
  /** Halogen-bond X···A distance and allowed deviation from linear C–X···A (Mol* rule). */
  halogenBondCutoff: number;
  halogenAngleDeviation: number;
  /** Uniform metal–donor cutoff; also the fallback for pairs without a target distance. */
  metalCutoff: number;
  /** element_specific: per metal/donor target + tolerance (ruleset ligand-3); uniform: metalCutoff. */
  metalDistancePolicy: "element_specific" | "uniform";
  metalTolerance: number;
  waterLegMin: number;
  waterLegMax: number;
  waterAngleMin: number;
  waterAngleMax: number;
  includeWaters: boolean;
  clashOverlapMin: number;
  minimumOccupancy: number;
  conformerPolicy: ConformerPolicy;
  classifyChemistry: boolean;
}
export const DEFAULT_PARAMETERS: AnalysisParameters = {
  proximityCutoff: 5,
  hydrogenBondCutoff: 3.5,
  hydrophobicCutoff: 4,
  saltBridgeCutoff: 4,
  piStackingCutoff: 5.5,
  piOffsetMax: 2,
  piAngleDeviation: 30,
  cationPiCutoff: 6,
  halogenBondCutoff: 4,
  halogenAngleDeviation: 30,
  metalCutoff: 3,
  metalDistancePolicy: "element_specific",
  metalTolerance: 0.5,
  waterLegMin: 2.5,
  waterLegMax: 4.1,
  waterAngleMin: 71,
  waterAngleMax: 140,
  includeWaters: true,
  clashOverlapMin: 0.6,
  minimumOccupancy: 0,
  conformerPolicy: "ensemble",
  classifyChemistry: true,
};
export const INTERACTION_LABELS: Record<InteractionType, string> = {
  proximity_contact: "Proximity",
  hydrogen_bond: "H-bond candidate",
  hydrophobic_contact: "Hydrophobic",
  salt_bridge: "Salt-bridge candidate",
  pi_stacking: "π-stacking",
  cation_pi: "Cation–π candidate",
  metal_coordination: "Metal candidate",
  water_bridge: "Water-bridge candidate",
  steric_clash: "Clash candidate",
  halogen_bond: "Halogen bond",
};
export const INTERACTION_COLORS: Record<InteractionType, string> = {
  pi_stacking: "#e29bb2",
  cation_pi: "#bcb0e8",
  metal_coordination: "#86d8ad",
  water_bridge: "#7baee3",
  steric_clash: "#ef977b",
  proximity_contact: "#8fa5c1",
  hydrogen_bond: "#76c9d5",
  hydrophobic_contact: "#d3c077",
  salt_bridge: "#cb9de6",
  halogen_bond: "#9fd36f",
};
export interface ChemicalDefinition {
  componentId: string;
  bytes: Uint8Array;
  contentHash: string;
  url: string;
  retrievedAt: string;
}
export interface AnalysisRequest {
  /** The ligand residue, or the anchor (first residue) of a ligand group. */
  ligandResidueId: string;
  /** Ruleset ligand-3: every residue of a multi-residue ligand (includes ligandResidueId). */
  ligandResidueIds?: string[];
  receptorChainIds: string[];
  /** Ruleset ligand-3: non-polymer residues (cofactors, metal ions) included as receptor endpoints. */
  receptorComponentResidueIds?: string[];
  parameters: AnalysisParameters;
}
/** Residue IDs analyzed as the ligand. */
export function ligandResidueIds(request: AnalysisRequest): string[] {
  return request.ligandResidueIds?.length
    ? request.ligandResidueIds
    : [request.ligandResidueId];
}
export interface Participant {
  residueId: string;
  atomIndices: number[];
  role:
    | "ligand"
    | "receptor"
    | "donor"
    | "acceptor"
    | "positive_group"
    | "negative_group"
    | "aromatic_ring"
    | "metal"
    | "coordinator"
    | "halogen_donor"
    | "halogen_acceptor"
    | "water";
}
/**
 * Chemistry X-ray coordinates rarely resolve: His protonation (side-chain pKa about 6),
 * Asn/Gln amide orientation (O/N swap) and His tautomer/ring orientation.
 */
export const AMBIGUITIES = [
  "his_protonation",
  "amide_flip",
  "his_tautomer",
] as const;
export type Ambiguity = (typeof AMBIGUITIES)[number];
export const AMBIGUITY_LABELS: Record<Ambiguity, string> = {
  his_protonation: "pH-dependent His",
  amide_flip: "amide flip?",
  his_tautomer: "His tautomer?",
};
export interface MolecularInteraction {
  id: string;
  type: InteractionType;
  ligand: Participant;
  receptor: Participant;
  /** Minimum atom-pair distance for group interactions, endpoint distance otherwise. */
  distanceAngstrom: number;
  closestAtomPair: [number, number];
  mediator?: Participant;
  geometry?: {
    centroidDistanceAngstrom?: number;
    planeAngleDegrees?: number;
    offsetAngstrom?: number;
    ligandCentroid?: [number, number, number];
    receptorCentroid?: [number, number, number];
    waterLegDistancesAngstrom?: [number, number];
    waterAngleDegrees?: number;
    overlapAngstrom?: number;
    vdwRadiiAngstrom?: [number, number];
    metalElement?: string;
    /** C–X···A angle of a halogen bond (180° is linear). */
    halogenAngleDegrees?: number;
    /** Accepted maximum for this metal/donor pair and the target it derives from. */
    metalLimitAngstrom?: number;
    metalTargetAngstrom?: number;
    metalLimitSource?: "element_specific" | "uniform" | "uniform_fallback";
    selectedReceptorPartnerCount?: number;
    selectedReceptorAnglesDegrees?: number[];
  };
  donorHydrogenAcceptorAngle?: number;
  hydrogenMode?: "explicit" | "implicit";
  /** Ensemble mode: conformer labels containing this interaction, with the occupancy of its altloc-specific atoms. */
  conformers?: { altId: string; occupancy?: number }[];
  conformerPresence?: "all" | "partial";
  /** Unresolved chemistry affecting this interaction (ruleset ligand-3); detection is unchanged. */
  ambiguities?: Ambiguity[];
  classification: "measured_proximity" | "candidate" | "geometry_supported";
  notes: string[];
}
export interface ResidueInteractionSummary {
  residueId: string;
  proximityPairCount: number;
  chemicalInteractionCount: number;
  clashCount: number;
  minimumDistance: number;
  types: InteractionType[];
  interactionIds: string[];
}
export interface AnalysisRun {
  schemaVersion: 2;
  cacheKey: string;
  id: string;
  snapshotId: string;
  sourceId: string;
  sourceHash: string;
  modelNumber: number;
  assemblyId: string;
  request: AnalysisRequest;
  engineVersion: string;
  ruleSetVersion: string;
  parserVersion: string;
  chemistrySources: {
    componentId: string;
    source: "embedded" | "ccd" | "standard_template";
    contentHash?: string;
    version?: string;
    url?: string;
    retrievedAt?: string;
  }[];
  chemicalParameters: Record<string, unknown>;
  generatedAt: string;
  assumptions: string[];
  qualityFlags: string[];
  evaluation: Record<
    InteractionType,
    {
      status: "evaluated" | "partially_evaluated" | "not_evaluated";
      reason?: string;
    }
  >;
  bindingSite: {
    ligandResidueId: string;
    residueIds: string[];
    definition: "computed_contact_union";
    cutoffsAngstrom: {
      proximity: number;
      hydrogenBond: number;
      hydrophobic: number;
      saltBridge: number;
      piStacking: number;
      cationPi: number;
      halogenBond?: number; // ruleset ligand-3

      metal: number;
      waterLegMax: number;
      clashOverlapMin: number;
    };
  };
  stats: {
    ligandAtomCount: number;
    receptorAtomCount: number;
    waterAtomCount: number;
    excludedDisorderedResidues: number;
    excludedOccupancyAtoms: number;
    excludedBondedPairs: number;
    elapsedMilliseconds: number;
    rejections?: Partial<Record<RejectionReason, number>>;
    /** Ensemble mode: analyzed alternate-conformer labels. */
    conformerLabels?: string[];
  };
  /** Ligand–receptor covalent bonds in the selected context (ruleset ligand-3). */
  covalentAttachments?: {
    ligandAtom: number;
    receptorAtom: number;
    provenance: "dictionary_or_explicit" | "geometry_inferred";
  }[];
  interactions: MolecularInteraction[];
  residues: ResidueInteractionSummary[];
  /** Atom-derived residue adjacency. IDs point to canonical interactions above. */
  graph: Record<string, string[]>;
  bonds: {
    atomA: number;
    atomB: number;
    order: number;
    provenance: "dictionary_or_explicit" | "geometry_inferred";
  }[];
}
