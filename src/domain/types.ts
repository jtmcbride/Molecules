/** Domain objects contain no rendering-library objects. Coordinates are assembly-space Å. */
export interface StructureSource {
  id: string;
  name: string;
  kind: 'pdb' | 'local' | 'sample';
  format: 'mmcif';
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
  kind: 'polymer' | 'ligand' | 'water' | 'ion' | 'branched';
  atomIndices: number[];
  preferredAltId: string | null;
}
export interface LigandInstance {
  id: string;
  residueId: string;
  componentId: string;
  description: string;
  kind: 'ligand' | 'ion' | 'branched';
}
export interface AtomRecord {
  id: string;
  name: string;
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
  provenance: {
    schemaVersion: 1;
    contentHash: string;
    parser: string;
    createdAt: string;
    coordinateFrame: 'assembly';
    conformerPolicy: 'residue-mean-occupancy-v1';
    qualityFlags: string[];
  };
}
export interface StructureOptions {
  models: { index: number; number: number }[];
  assemblies: { id: string; description: string }[];
}
export type Representation = 'cartoon' | 'ball-and-stick' | 'molecular-surface';
export interface SessionDescriptor {
  schemaVersion: 1;
  sourceHash: string;
  modelIndex: number;
  assemblyId: string;
  selectedResidueId: string | null;
  activeChainId: string | null;
  representation: Representation;
  showWater: boolean;
  savedAt: string;
}
