/**
 * Phase 4 structural comparison contracts. Comparison structures are independent of the
 * reference: each has its own source, snapshot, interpretation and analysis, built by the
 * same code and versions as the reference. Nothing here rewrites a snapshot or a run.
 */

/** Comparison semantics version: bump whenever comparison output can change. */
export const COMPARISON_VERSION = "comparison-1.0.0";
/** Comparison structures besides the reference (eight structures in total). */
export const MAX_COMPARISON_STRUCTURES = 7;

/** Column-major 4×4 rigid transform mapping comparison coordinates onto the reference frame. */
export type RigidTransform = number[];

/** What a saved session records per comparison structure. Restoring never refetches biology. */
export interface ComparisonMemberDescriptor {
  sourceHash: string;
  modelIndex: number;
  assemblyId: string;
  targetLigandId: string | null;
  ligandGroupId: string | null;
  analysisCacheKey?: string;
  interpretationId?: string;
  visible: boolean;
  transform?: RigidTransform;
  pairingOverrides?: ChainPairingOverride[];
}

/**
 * Reference and comparison chain instances paired for one shared UniProt accession, and
 * how: the user's choice, the same author chain ID and operator, or order of appearance.
 */
export interface ChainPairing {
  accession: string;
  referenceChainId: string;
  comparisonChainId: string;
  basis: "user" | "same_author_chain" | "chain_order";
}
/** A user's pairing for a reference chain; `null` leaves it unpaired. */
export interface ChainPairingOverride {
  accession: string;
  referenceChainId: string;
  comparisonChainId: string | null;
}
export const CORRESPONDENCE_STATUSES = [
  "paired",
  "reference_only",
  "comparison_only",
  "not_comparable",
] as const;
export type CorrespondenceStatus = (typeof CORRESPONDENCE_STATUSES)[number];
/**
 * One UniProt position of a chain pairing. `paired` needs an observed, exactly mapped
 * residue on both sides; `not_comparable` means an ambiguous, conflicting or mismatched
 * mapping on either side (`reason` says which).
 */
export interface ResiduePair {
  accession: string;
  uniprotPosition: number;
  referenceChainId: string;
  comparisonChainId: string;
  referenceResidueId?: string;
  comparisonResidueId?: string;
  status: CorrespondenceStatus;
  reason?: string;
  /** One-letter deposited residues when the paired residues differ (e.g. an engineered mutation). */
  residueChange?: { reference: string; comparison: string };
}
export interface Correspondence {
  version: string;
  referenceSnapshotId: string;
  comparisonSnapshotId: string;
  sharedAccessions: string[];
  pairings: ChainPairing[];
  unpairedReferenceChains: { chainId: string; accessions: string[] }[];
  unpairedComparisonChains: { chainId: string; accessions: string[] }[];
  pairs: ResiduePair[];
  counts: Record<CorrespondenceStatus, number>;
}
