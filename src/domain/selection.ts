import type {
  CorrespondenceStatus,
  FingerprintCell,
  FingerprintChange,
  SiteResidueDifference,
} from "./comparison";

/**
 * Structure-qualified selection contracts (M2). Residue IDs are only unique within one
 * snapshot, and the same source can be open twice, so every target names its structure:
 * the reference, or a comparison slot together with the snapshot it was resolved against.
 */
export type StructureRef =
  | { kind: "reference"; snapshotId: string }
  | { kind: "comparison"; slotId: string; snapshotId: string };

export interface ResidueTarget {
  structure: StructureRef;
  residueId: string;
}

/** What the user asked to investigate; resolved against the current workspace. */
export type InvestigationRequest =
  | { kind: "residue"; target: ResidueTarget }
  | {
      kind: "pose_atom";
      slotId: string;
      inputKey: string;
      referenceAtomId: string;
    }
  | { kind: "reference_residues"; snapshotId: string; residueIds: string[] }
  | { kind: "site_difference"; slotId: string; referenceResidueId: string }
  | { kind: "fingerprint"; slotId: string; rowKey: string };

/**
 * Interactions of one side's current analysis that the request covers, nearest first (ties
 * by interaction ID). Without a usable analysis the state says why; it is never an empty list.
 */
export type InvestigationInteractions =
  | { status: "evaluated"; analysisCacheKey: string; ids: string[] }
  | { status: "not_available"; reason: string };

export interface InvestigationSide {
  structure: StructureRef;
  /**
   * Selected residues in snapshot order. Several only when one request covers several
   * instances (a receptor component present more than once); empty when `unavailable`.
   */
  residueIds: string[];
  atomIds?: string[];
  /** Why this side has no residue. */
  unavailable?: string;
  interactions: InvestigationInteractions;
  /** Fingerprint requests: this side's cell, and its margin when it differs from the reference. */
  cell?: FingerprintCell;
  change?: FingerprintChange;
}

/** The exact SIFTS correspondence that links the two sides of a comparison request. */
export interface InvestigationCorrespondence {
  basis: "sifts_exact";
  accession: string;
  uniprotPosition: number;
  referenceChainId: string;
  comparisonChainId: string;
  status: CorrespondenceStatus;
  reason?: string;
  residueChange?: { reference: string; comparison: string };
}

export interface InvestigationView {
  request: InvestigationRequest;
  /** Comparison slot the request involves; null for reference-only requests. */
  slotId: string | null;
  reference: InvestigationSide | null;
  comparison: InvestigationSide | null;
  correspondence: InvestigationCorrespondence | null;
  /** Why a comparison request has no correspondence. */
  correspondenceUnavailable?: string;
  /** Component fingerprint rows: several deposited instances share the row's component ID. */
  instanceAmbiguous?: boolean;
  siteDifference?: SiteResidueDifference;
  posePair?: {
    referenceAtomId: string;
    comparisonAtomId: string;
    referenceAtomName: string;
    comparisonAtomName: string;
    distanceAngstrom: number;
    inputKey: string;
  };
  /** Identities of every input the view was resolved from. */
  revision: string;
}

export type InvestigationResult =
  | { status: "resolved"; view: InvestigationView }
  | {
      status: "unavailable";
      request: InvestigationRequest;
      reason: string;
      revision: string;
    };

export function sameStructure(a: StructureRef, b: StructureRef) {
  return a.kind === "reference"
    ? b.kind === "reference" && a.snapshotId === b.snapshotId
    : b.kind === "comparison" &&
        a.slotId === b.slotId &&
        a.snapshotId === b.snapshotId;
}

export function sameTarget(a: ResidueTarget | null, b: ResidueTarget | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.residueId === b.residueId &&
      sameStructure(a.structure, b.structure))
  );
}
