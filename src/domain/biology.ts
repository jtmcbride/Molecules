/** Biological records and evidence are independent of the renderer and API formats. */
import type { StructureQuality } from "./types";
export const BIOLOGY_VERSION = "biology-1.1.0";
export interface ResourceSnapshot {
  id: string;
  key: string;
  provider: "SIFTS" | "UniProt" | "RCSB";
  identifier: string;
  url: string;
  contentHash: string;
  retrievedAt: string;
  release?: string;
  bytes: Uint8Array;
}
export const EVIDENCE_KINDS = [
  "experimental_structure",
  "structure_coordinates",
  "database_annotation",
  "computed_geometry",
] as const;
export const MAPPING_STATUSES = [
  "exact",
  "ambiguous",
  "sequence_mismatch",
  "source_conflict",
] as const;
export const RESIDUE_IDENTITIES = [
  "match",
  "engineered_mutation",
  "conflict",
  "unexplained_mismatch",
] as const;
export interface Evidence {
  id: string;
  kind: (typeof EVIDENCE_KINDS)[number];
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
  quality?: StructureQuality; // experimental_structure / structure_coordinates only
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
  /** SIFTS residue annotations, e.g. "Engineered mutation", "Conflict", "Expression tag". */
  annotations: string[];
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
  status: (typeof MAPPING_STATUSES)[number];
  /** Residue identity versus UniProt, independent of position correspondence. Absent before biology-1.1.0. */
  identity?: (typeof RESIDUE_IDENTITIES)[number];
  /** One-letter UniProt and deposited residues when they differ, e.g. S → A. */
  residueChange?: { uniprot: string; deposited: string };
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
  /** Cross-referenced chemical identity of deposited ligands; absent in biology-1.0.0 snapshots. */
  ligands?: LigandIdentity[];
  /** wwPDB/RCSB fit and geometry scores per deposited ligand instance; absent in biology-1.0.0 snapshots. */
  ligandFits?: LigandFit[];
}
/**
 * Validation scores of one deposited ligand instance (RCSB ligand quality, from the wwPDB
 * validation pipeline). They describe the deposited coordinates and are absent when no
 * structure factors were deposited.
 */
export interface LigandFit {
  labelAsymId: string;
  componentId: string;
  rscc?: number; // real-space correlation coefficient
  rsr?: number; // real-space R value
  completeness?: number; // fraction of modeled atoms
  mogulBondsRmsz?: number;
  mogulAnglesRmsz?: number;
  rankingModelFit?: number; // percentile rank among PDB ligands (0–1)
  rankingModelGeometry?: number;
  scoreType?: string;
  evidenceIds: string[];
}
/** A deposited chemical component and its database cross-references (RCSB chemical component record). */
export interface LigandIdentity {
  componentId: string;
  name: string;
  chebiIds: string[]; // normalized "CHEBI:<number>"; empty when the record has no ChEBI cross-reference
  evidenceIds: string[];
}
/**
 * Relation between an annotation's ligand and the analyzed component, by ChEBI identifier only.
 * Charge states and conjugate acids/bases have separate ChEBI entries, so "different" means a
 * different ChEBI entity, not necessarily a chemically unrelated molecule.
 */
export type LigandRelation = "same" | "different" | "unresolved";
export interface FeatureOverlap {
  type: string;
  category: FeatureCategory;
  residueIds: string[];
  annotationIds: string[];
  /** Exactly mapped observed residues carrying this feature type in the same chain instances. */
  background: { annotated: number; total: number };
}
export interface LigandSiteOverlap {
  annotationId: string;
  ligandName?: string;
  ligandId?: string;
  relation: LigandRelation;
  reason: string;
  residueIds: string[];
}
export interface BindingSiteSummary {
  analysisRunId: string;
  interpretationId: string;
  contactCount: number;
  mappedCount: number;
  ambiguousCount: number;
  unmappedCount: number;
  /** Mapped contact residues overlapping site-level features (active site, binding site, site). */
  siteAnnotatedCount: number;
  /** Site-level feature coverage of all exactly mapped observed residues in the same chain instances. */
  siteBackground: { annotated: number; total: number };
  proximityResidueCount: number;
  chemicalResidueCount: number;
  clashResidueCount: number;
  overlaps: FeatureOverlap[];
  ligandSites: LigandSiteOverlap[];
  /** ChEBI identifiers of the analyzed component, when cross-referenced. */
  analyzedLigand: { componentId: string; chebiIds: string[] };
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

/**
 * Site-level features name specific residues and form the binding-site headline. Domains and
 * regions often span most of a chain (e.g. the P00760 Peptidase S1 domain covers 24–244), so
 * they are context, never a functional numerator. Processing features are excluded entirely.
 */
export const SITE_FEATURE_TYPES = ["Active site", "Binding site", "Site"];
export const CONTEXT_FEATURE_TYPES = ["Domain", "Region"];
export type FeatureCategory = "site" | "context";
export function featureCategory(type: string): FeatureCategory | undefined {
  return SITE_FEATURE_TYPES.includes(type)
    ? "site"
    : CONTEXT_FEATURE_TYPES.includes(type)
      ? "context"
      : undefined;
}
