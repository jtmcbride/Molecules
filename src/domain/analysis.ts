export const ENGINE_VERSION = 'contacts-1.0.0';
export const RULESET_VERSION = 'molstar-5.13.1-ligand-1';
export type InteractionType = 'proximity_contact' | 'hydrogen_bond' | 'hydrophobic_contact' | 'salt_bridge';
export type ConformerPolicy = 'exclude_disordered' | 'preferred_residue';
export interface AnalysisParameters {
  proximityCutoff: number;
  hydrogenBondCutoff: number;
  hydrophobicCutoff: number;
  saltBridgeCutoff: number;
  minimumOccupancy: number;
  conformerPolicy: ConformerPolicy;
  classifyChemistry: boolean;
}
export const DEFAULT_PARAMETERS: AnalysisParameters = {
  proximityCutoff: 5, hydrogenBondCutoff: 3.5, hydrophobicCutoff: 4, saltBridgeCutoff: 4,
  minimumOccupancy: 0, conformerPolicy: 'exclude_disordered', classifyChemistry: true,
};
export const INTERACTION_LABELS: Record<InteractionType, string> = {
  proximity_contact: 'Proximity', hydrogen_bond: 'H-bond candidate', hydrophobic_contact: 'Hydrophobic', salt_bridge: 'Salt-bridge candidate',
};
export const INTERACTION_COLORS: Record<InteractionType, string> = {
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
  role: 'ligand' | 'receptor' | 'donor' | 'acceptor' | 'positive_group' | 'negative_group';
}
export interface MolecularInteraction {
  id: string;
  type: InteractionType;
  ligand: Participant;
  receptor: Participant;
  /** Minimum atom-pair distance for group interactions, endpoint distance otherwise. */
  distanceAngstrom: number;
  closestAtomPair: [number, number];
  donorHydrogenAcceptorAngle?: number;
  hydrogenMode?: 'explicit' | 'implicit';
  classification: 'measured_proximity' | 'candidate' | 'geometry_supported';
  notes: string[];
}
export interface ResidueInteractionSummary {
  residueId: string;
  proximityPairCount: number;
  chemicalInteractionCount: number;
  minimumDistance: number;
  types: InteractionType[];
  interactionIds: string[];
}
export interface AnalysisRun {
  schemaVersion: 1;
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
  chemistrySources: { componentId: string; source: 'embedded' | 'ccd' | 'standard_template'; contentHash: string; url?: string; retrievedAt?: string }[];
  chemicalParameters: Record<string, unknown>;
  generatedAt: string;
  assumptions: string[];
  qualityFlags: string[];
  evaluation: Record<InteractionType, { status: 'evaluated' | 'partially_evaluated' | 'not_evaluated'; reason?: string }>;
  bindingSite: { ligandResidueId: string; residueIds: string[]; definition: 'computed_contact_union'; cutoffsAngstrom: { proximity: number; hydrogenBond: number; hydrophobic: number; saltBridge: number } };
  stats: { ligandAtomCount: number; receptorAtomCount: number; excludedDisorderedResidues: number; excludedOccupancyAtoms: number; excludedBondedPairs: number; elapsedMilliseconds: number };
  interactions: MolecularInteraction[];
  residues: ResidueInteractionSummary[];
  /** Atom-derived residue adjacency. IDs point to canonical interactions above. */
  graph: Record<string, string[]>;
  bonds: { atomA: number; atomB: number; order: number; provenance: 'dictionary_or_explicit' | 'geometry_inferred' }[];
}
