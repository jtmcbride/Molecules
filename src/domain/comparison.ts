import type { InteractionType } from "./analysis";
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
  superpositionScope?: SuperpositionScope;
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

export type SuperpositionScope = "global" | "binding_site" | "none";
/**
 * Rigid fit of a comparison structure onto the reference by SIFTS-paired Cα atoms. The
 * transform maps comparison coordinates into the reference frame and is applied only to the
 * display and to comparison measurements, never to a snapshot.
 */
export interface SuperpositionResult {
  scope: Exclude<SuperpositionScope, "none">;
  method: string;
  atoms: "CA";
  transform: RigidTransform;
  /** RMSD over the atoms kept by outlier rejection (Å). */
  rmsdCore: number;
  /** RMSD over every paired atom under the final transform (Å). */
  rmsdAll: number;
  fitted: number;
  total: number;
  cycles: number;
  /** Rejected pairs as JSON [reference chain ID, UniProt position]. */
  rejected: string[];
  siteRadiusAngstrom?: number;
  referenceLigandIds?: string[];
}

/** Interaction types in fingerprints: chemical interactions, not proximity or clashes. */
export const FINGERPRINT_TYPES = [
  "hydrogen_bond",
  "salt_bridge",
  "hydrophobic_contact",
  "pi_stacking",
  "cation_pi",
  "halogen_bond",
  "metal_coordination",
  "water_bridge",
] as const satisfies readonly InteractionType[];
export type FingerprintType = (typeof FINGERPRINT_TYPES)[number];
/**
 * One structure's state at one fingerprint row. Only `present` and `absent` are
 * measurements; the others say why there is none and are never counted as absent.
 */
export type FingerprintCell =
  "present" | "absent" | "not_evaluated" | "not_observed" | "not_comparable";
export interface FingerprintRow {
  /** JSON key: ["polymer", reference chain ID, accession, UniProt position, type] or ["component", component ID, type]. */
  key: string;
  kind: "polymer" | "component";
  type: FingerprintType;
  referenceChainId?: string;
  accession?: string;
  uniprotPosition?: number;
  componentId?: string;
  /** Aligned with `FingerprintMatrix.columns`. */
  cells: FingerprintCell[];
  /** Columns whose cell differs from the reference (present vs absent), with distance margins. */
  changes?: FingerprintChange[];
}
/**
 * How far a gained or lost interaction is from its cutoff. `presentMarginAngstrom` is the
 * present side's distance inside the cutoff; `absentExcessAngstrom` is how far the absent
 * side's closest candidate atoms lie beyond it (candidate atoms by element, so it errs low).
 * `marginal` marks a change within FINGERPRINT_MARGIN_ANGSTROM of the cutoff on either side.
 */
export interface FingerprintChange {
  column: number;
  presentMarginAngstrom?: number;
  absentExcessAngstrom?: number;
  marginal: boolean;
}
/** Changes this close to a cutoff are flagged: the 4.0 vs 4.5 Å hydrophobic cutoffs of the
 * application and ProLIF differ by this much, and it is typical coordinate error near 2 Å. */
export const FINGERPRINT_MARGIN_ANGSTROM = 0.5;
export interface FingerprintColumn {
  /** "reference" or the comparison slot ID. */
  id: string;
  label: string;
  analysisCacheKey?: string;
  ligandLabel?: string;
  /** Why this column cannot be compared with the reference (absent when comparable). */
  refusal?: string;
  /** Chemical interactions whose receptor residue has no row (no exact mapping or chain pairing). */
  unplacedInteractions: number;
  /** Versus the reference, over rows measured in both. Absent for the reference column. */
  similarity?: {
    tanimoto: number | null;
    shared: number;
    gained: number;
    lost: number;
    compared: number;
    excluded: number;
  };
}
export interface FingerprintMatrix {
  version: string;
  columns: FingerprintColumn[];
  rows: FingerprintRow[];
}
