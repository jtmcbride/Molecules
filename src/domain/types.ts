/** Domain objects contain no rendering-library objects. Coordinates are assembly-space Å. */
export interface StructureSource {
  id: string;
  name: string;
  kind: "pdb" | "local" | "sample";
  format: "mmcif";
  binary: boolean;
  bytes: Uint8Array;
  contentHash: string;
  fetchedAt: string;
  url?: string;
  metadata?: StructureMetadata;
}
export interface StructureMetadata {
  title: string;
  method?: string;
  resolution?: number;
}
export interface SequencePosition {
  labelSeqId: number;
  componentId: string;
  code: string;
  residueIds: string[];
}
export interface ChainRecord {
  id: string;
  labelAsymId: string;
  authAsymId: string;
  entityId: string;
  type: string;
  description: string;
  operatorId: string;
  operatorIds: string[];
  transform: number[];
  residueIds: string[];
  sequence: SequencePosition[];
}
export interface ResidueRecord {
  id: string;
  chainId: string;
  componentId: string;
  labelSeqId: number | null;
  authSeqId: string | null;
  insertionCode: string | null;
  sourceResidueIndex: number;
  kind: "polymer" | "ligand" | "water" | "ion" | "branched";
  atomIndices: number[];
  preferredAltId: string | null;
}
export interface LigandInstance {
  id: string;
  residueId: string;
  componentId: string;
  description: string;
  kind: "ligand" | "ion" | "branched";
}
export interface AtomRecord {
  id: string;
  name: string;
  /** Upper-case element symbol (normalizeElement), e.g. "ZN", "H". */
  element: string;
  altId: string | null;
  sourceRow: number;
  formalCharge: number | null;
}
export interface AtomBuffer {
  positions: Float32Array;
  residueIndices: Uint32Array;
  occupancies: Float32Array;
  bFactors: Float32Array;
  /** All observed atoms are preserved; these indices define a coherent preferred conformer. */
  preferredAtomIndices: Uint32Array;
  atomCount: number;
}
/**
 * Refinement statistics read from the coordinate file. Coordinate error is a Cruickshank
 * diffraction-component precision index: the deposited ESU based on R-free when present,
 * otherwise DPI_free = sqrt(Ni / n_obs) · C^(-1/3) · d_min · R_free (Cruickshank 1999,
 * Acta Cryst D55:583; Blow 2002, Acta Cryst D58:792). It describes an atom with average B.
 */
export interface StructureQuality {
  method?: string;
  resolutionAngstrom?: number;
  rFree?: number;
  reflectionsUsed?: number;
  completenessPercent?: number;
  /** Non-hydrogen atoms with positive occupancy in this model (asymmetric unit). */
  refinedAtomCount: number;
  coordinateErrorAngstrom?: number;
  coordinateErrorSource?: "deposited_esu_r_free" | "computed_dpi_free";
}
export interface StructureSnapshot {
  id: string;
  sourceId: string;
  modelIndex: number;
  modelNumber: number;
  assemblyId: string;
  chains: ChainRecord[];
  residues: ResidueRecord[];
  ligands: LigandInstance[];
  atoms: AtomRecord[];
  atomBuffer: AtomBuffer;
  componentParentIds?: Record<string, string>;
  quality?: StructureQuality;
  chemistry: {
    embeddedBondComponentIds: string[];
    expectedHeavyAtomNames?: Record<string, string[]>;
    appliedChemicalDefinitionHashes?: string[];
  };
  provenance: {
    schemaVersion: 1;
    contentHash: string;
    parser: string;
    createdAt: string;
    coordinateFrame: "assembly";
    conformerPolicy: "residue-mean-occupancy-v1";
    qualityFlags: string[];
  };
}
export interface StructureOptions {
  models: { index: number; number: number }[];
  assemblies: { id: string; description: string }[];
}
export type Representation = "cartoon" | "ball-and-stick" | "molecular-surface";
export interface SessionDescriptor {
  schemaVersion: 1 | 2;
  interpretationId?: string;
  annotationCategories?: string[];
  selectedProteinAccession?: string | null;
  associationAccession?: string;
  analysisCacheKey?: string;
  sourceHash: string;
  modelIndex: number;
  assemblyId: string;
  selectedResidueId: string | null;
  activeChainId: string | null;
  representation: Representation;
  showWater: boolean;
  savedAt: string;
}
