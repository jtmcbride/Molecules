export const ENGINE_VERSION = 'contacts-2.0.0';
export const RULESET_VERSION = 'molstar-5.13.1-ligand-2';
export type InteractionType = 'proximity_contact' | 'hydrogen_bond' | 'hydrophobic_contact' | 'salt_bridge' | 'pi_stacking' | 'cation_pi' | 'metal_coordination' | 'water_bridge' | 'steric_clash';
export type ConformerPolicy = 'exclude_disordered' | 'preferred_residue';
export interface AnalysisParameters {
  proximityCutoff: number;
  hydrogenBondCutoff: number;
  hydrophobicCutoff: number;
  saltBridgeCutoff: number;
  piStackingCutoff: number;
  piOffsetMax: number;
  piAngleDeviation: number;
  cationPiCutoff: number;
  metalCutoff: number;
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
  proximityCutoff: 5, hydrogenBondCutoff: 3.5, hydrophobicCutoff: 4, saltBridgeCutoff: 4,
  piStackingCutoff: 5.5, piOffsetMax: 2, piAngleDeviation: 30, cationPiCutoff: 6, metalCutoff: 3,
  waterLegMin: 2.5, waterLegMax: 4.1, waterAngleMin: 71, waterAngleMax: 140, includeWaters: true, clashOverlapMin: 0.6,
  minimumOccupancy: 0, conformerPolicy: 'exclude_disordered', classifyChemistry: true,
};
export const INTERACTION_LABELS: Record<InteractionType, string> = {
  proximity_contact: 'Proximity', hydrogen_bond: 'H-bond candidate', hydrophobic_contact: 'Hydrophobic', salt_bridge: 'Salt-bridge candidate',
  pi_stacking: 'π-stacking', cation_pi: 'Cation–π candidate', metal_coordination: 'Metal candidate', water_bridge: 'Water-bridge candidate', steric_clash: 'Clash candidate',
};
export const INTERACTION_COLORS: Record<InteractionType, string> = {
  pi_stacking: '#e29bb2', cation_pi: '#bcb0e8', metal_coordination: '#86d8ad', water_bridge: '#7baee3', steric_clash: '#ef977b',
  proximity_contact: '#8fa5c1', hydrogen_bond: '#76c9d5', hydrophobic_contact: '#d3c077', salt_bridge: '#cb9de6',
};
export interface ChemicalDefinition {
  componentId: string;
  bytes: Uint8Array;
  contentHash: string;
  url: string;
  retrievedAt: string;
}
export interface AnalysisRequest {
  ligandResidueId: string;
  receptorChainIds: string[];
  parameters: AnalysisParameters;
}
export interface Participant {
  residueId: string;
  atomIndices: number[];
  role: 'ligand' | 'receptor' | 'donor' | 'acceptor' | 'positive_group' | 'negative_group' | 'aromatic_ring' | 'metal' | 'coordinator' | 'water';
}
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
    selectedReceptorPartnerCount?: number;
    selectedReceptorAnglesDegrees?: number[];
  };
  donorHydrogenAcceptorAngle?: number;
  hydrogenMode?: 'explicit' | 'implicit';
  classification: 'measured_proximity' | 'candidate' | 'geometry_supported';
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
  chemistrySources: { componentId: string; source: 'embedded' | 'ccd' | 'standard_template'; contentHash?: string; version?: string; url?: string; retrievedAt?: string }[];
  chemicalParameters: Record<string, unknown>;
  generatedAt: string;
  assumptions: string[];
  qualityFlags: string[];
  evaluation: Record<InteractionType, { status: 'evaluated' | 'partially_evaluated' | 'not_evaluated'; reason?: string }>;
  bindingSite: { ligandResidueId: string; residueIds: string[]; definition: 'computed_contact_union'; cutoffsAngstrom: { proximity: number; hydrogenBond: number; hydrophobic: number; saltBridge: number; piStacking: number; cationPi: number; metal: number; waterLegMax: number; clashOverlapMin: number } };
  stats: { ligandAtomCount: number; receptorAtomCount: number; waterAtomCount: number; excludedDisorderedResidues: number; excludedOccupancyAtoms: number; excludedBondedPairs: number; elapsedMilliseconds: number };
  interactions: MolecularInteraction[];
  residues: ResidueInteractionSummary[];
  /** Atom-derived residue adjacency. IDs point to canonical interactions above. */
  graph: Record<string, string[]>;
  bonds: { atomA: number; atomB: number; order: number; provenance: 'dictionary_or_explicit' | 'geometry_inferred' }[];
}
