/** Biological records and evidence are independent of the renderer and API formats. */
export const BIOLOGY_VERSION = "biology-1.0.0";
export interface ResourceSnapshot {
  id: string;
  key: string;
  provider: "SIFTS" | "UniProt";
  identifier: string;
  url: string;
  contentHash: string;
  retrievedAt: string;
  release?: string;
  bytes: Uint8Array;
}
export interface Evidence {
  id: string;
  kind:
    | "experimental_structure"
    | "structure_coordinates"
    | "database_annotation"
    | "computed_geometry";
  provider: string;
  sourceIdentifier?: string;
  url?: string;
  contentHash?: string;
  retrievedAt?: string;
  release?: string;
  ecoCode?: string;
  citationIds?: string[];
  algorithmVersion?: string;
  assumptions?: string[];
}
export interface ProteinRecord {
  id: string;
  accession: string;
  canonicalAccession?: string;
  name: string;
  organism: { name: string; taxonomyId?: number };
  reviewed: boolean;
  sequence: string;
  sequenceVersion?: number;
  entryVersion?: number;
  sequenceHash: string;
  evidenceIds: string[];
  notes: { type: string; description: string; evidenceIds: string[] }[];
}
export interface FeatureBoundary {
  position?: number;
  modifier: "exact" | "less_than" | "greater_than" | "unknown";
}
export interface FunctionalAnnotation {
  id: string;
  proteinId: string;
  type: string;
  description: string;
  start: FeatureBoundary;
  end: FeatureBoundary;
  sourceFeatureId?: string;
  ligand?: { name?: string; identifier?: string; label?: string };
  evidenceIds: string[];
  valid: boolean;
  qualityFlags: string[];
}
export interface MappingSegment {
  accession: string;
  labelAsymId: string;
  authChain: string;
  entityId: string;
  start: number;
  end: number;
  uniprotStart: number;
  uniprotEnd: number;
}
export interface SiftsRow {
  pdbePosition: number;
  authChain: string;
  authNumber: string | null;
  componentId: string;
  notObserved: boolean;
  accession: string;
  uniprotPosition: number;
  uniprotResidue: string;
}
export interface ResidueMapping {
  id: string;
  snapshotId: string;
  chainInstanceId: string;
  residueId?: string;
  labelSeqId: number;
  authSeqId: string | null;
  insertionCode: string | null;
  proteinId: string;
  accession: string;
  uniprotPosition: number;
  status: "exact" | "ambiguous" | "sequence_mismatch" | "source_conflict";
  evidenceIds: string[];
}
export interface ChainCoverage {
  chainInstanceId: string;
  total: number;
  exact: number;
  ambiguous: number;
  unmapped: number;
  accessions: string[];
}
export interface AnnotationProjection {
  annotationId: string;
  chainInstanceId: string;
  residueIds: string[];
  observedPositions: number[];
  unobservedPositions: number[];
  ambiguousPositions: number[];
  uncertain: boolean;
}
export interface InterpretationSnapshot {
  schemaVersion: 1;
  id: string;
  version: string;
  snapshotId: string;
  sourceHash: string;
  entryId: string;
  createdAt: string;
  resourceIds: string[];
  resourceRefs: Omit<ResourceSnapshot, "bytes">[];
  proteins: ProteinRecord[];
  annotations: FunctionalAnnotation[];
  mappings: ResidueMapping[];
  coverage: ChainCoverage[];
  projections: AnnotationProjection[];
  evidence: Evidence[];
  qualityFlags: string[];
}
export interface BindingSiteSummary {
  analysisRunId: string;
  interpretationId: string;
  contactCount: number;
  mappedCount: number;
  ambiguousCount: number;
  unmappedCount: number;
  annotatedCount: number;
  proximityResidueCount: number;
  chemicalResidueCount: number;
  clashResidueCount: number;
  overlaps: { type: string; residueIds: string[]; annotationIds: string[] }[];
}
export const DEFAULT_ANNOTATION_TYPES = [
  "Active site",
  "Binding site",
  "Domain",
  "Region",
  "Site",
  "Signal",
  "Propeptide",
  "Chain",
];

/** Site/function overlaps exclude sequence-processing labels such as the whole chain. */
export const FUNCTIONAL_SITE_TYPES = [
  "Active site",
  "Binding site",
  "Domain",
  "Region",
  "Site",
];
