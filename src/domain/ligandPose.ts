import type { SuperpositionResult } from "./comparison";

/** Strict source-graph symmetry, equal heavy-atom weights, fixed protein frame. */
export const LIGAND_POSE_VERSION = "ligand-pose-1.0.0";
export const POSE_ALGORITHM_VERSION = "pose-exact-1.0.0";
export const POSE_CHEMISTRY_VERSION = "pose-chemistry-1.0.0";
export const POSE_MAX_HEAVY_ATOMS = 256;
export const POSE_SEARCH_LIMITS = Object.freeze({
  maxStates: 100_000,
  maxMaps: 4096,
});
export const POSE_WORKER_TIMEOUT_MS = 5000;
export const POSE_TIE_TOLERANCE_ANGSTROM = 1e-12;
export type PoseReason =
  | "source_mismatch"
  | "missing_ligand"
  | "ligand_group"
  | "unsupported_ligand"
  | "metal_containing"
  | "covalent_attachment"
  | "attachment_unknown"
  | "missing_chemistry"
  | "invalid_chemistry"
  | "chemistry_conflict"
  | "unsupported_stereo"
  | "conformer_required"
  | "invalid_conformer"
  | "invalid_occupancy_policy"
  | "incomplete_ligand"
  | "duplicate_atom"
  | "atom_mismatch"
  | "nonfinite_coordinates"
  | "atom_limit"
  | "different_component"
  | "missing_fit"
  | "invalid_transform"
  | "invalid_input"
  | "no_correspondence"
  | "search_limit"
  | "map_limit"
  | "pinned_chemistry_missing"
  | "pinned_result_missing";
export interface PoseUnavailable {
  status: "not_evaluated";
  code: PoseReason;
  reason: string;
}
export const poseUnavailable = (
  code: PoseReason,
  reason: string,
): PoseUnavailable => ({ status: "not_evaluated", code, reason });

/** Includes hydrogens: their bonds carry stereo context even though RMSD excludes H/D/T.
 * Null is unknown, never an assumed neutral charge/nonaromatic/achiral label.
 */
export interface PoseGraphAtom {
  name: string;
  element: string;
  charge: number | null;
  aromatic: boolean | null;
  stereo: "N" | "R" | "S" | null;
}
export interface PoseGraphBond {
  a: string;
  b: string;
  sourceOrder: "SING" | "DOUB" | "TRIP" | "AROM" | null;
  /** Explicit Y aromatic flags normalize alternating source orders to AROM. */
  order: "SING" | "DOUB" | "TRIP" | "AROM" | null;
  aromatic: boolean | null;
  stereo: "N" | "E" | "Z" | null;
}
export interface PoseChemicalGraph {
  componentId: string;
  atoms: PoseGraphAtom[];
  bonds: PoseGraphBond[];
  containsMetal: boolean;
}
export type PoseGraphRead =
  | PoseUnavailable
  | {
      status: "complete" | "incomplete";
      graph: PoseChemicalGraph;
    };
export interface PoseChemistry {
  id: string;
  componentId: string;
  parserVersion: string;
  policyVersion: string;
  contentHash: string;
  graphHash: string;
  origin: "embedded" | "ccd";
  binary: boolean;
  url?: string;
  retrievedAt: string;
  /** Exact chosen source bytes, independent of the coordinate-cache eviction policy. */
  bytes: Uint8Array;
  graph: PoseChemicalGraph;
}
export interface PoseAttachmentContext {
  sourceHash: string;
  snapshotId: string;
  residueId: string;
  status: "no_recorded_link" | "covalent" | "unknown";
  connectionIds: string[];
}
export interface PreparedPoseLigand {
  sourceHash: string;
  snapshotId: string;
  parser: string;
  modelIndex: number;
  modelNumber: number;
  assemblyId: string;
  residueId: string;
  componentId: string;
  conformerId: string | null;
  minimumOccupancy: number;
  chemistryId: string;
  chemistryHash: string;
  graphHash: string;
  graph: PoseChemicalGraph;
  attachment: PoseAttachmentContext;
  /** All arrays in chemical atom-name order; owned copies, never renderer buffers. */
  atomIds: string[];
  atomNames: string[];
  sourceRows: number[];
  positions: Float64Array;
}
export type PoseLigandPreparation =
  PoseUnavailable | { status: "prepared"; ligand: PreparedPoseLigand };
export interface LigandPoseInput {
  version: string;
  algorithmVersion: string;
  inputKey: string;
  reference: PreparedPoseLigand;
  comparison: PreparedPoseLigand;
  fit: SuperpositionResult;
  /** Full identity of the protein-fit inputs, supplied by the comparison controller. */
  fitInputKey: string;
}
/** Full inputs are stored alongside results by StoredLigandPose; UI persistence is M4-C. */
export type LigandPoseResult =
  | PoseUnavailable
  | {
      status: "evaluated";
      version: string;
      algorithmVersion: string;
      inputKey: string;
      rmsdAngstrom: number;
      nameMatchedRmsdAngstrom?: number;
      matchedAtoms: number;
      admissibleMaps: number;
      searchStates: number;
      fit: SuperpositionResult;
      fitInputKey: string;
      reference: PoseResultContext;
      comparison: PoseResultContext;
      pairs: {
        referenceAtomId: string;
        comparisonAtomId: string;
        referenceAtomName: string;
        comparisonAtomName: string;
        distanceAngstrom: number;
      }[];
    };
export type PoseResultContext = Pick<
  PreparedPoseLigand,
  | "sourceHash"
  | "snapshotId"
  | "residueId"
  | "componentId"
  | "conformerId"
  | "minimumOccupancy"
  | "chemistryId"
  | "chemistryHash"
  | "graphHash"
>;
export interface StoredLigandPose {
  inputKey: string;
  input: LigandPoseInput;
  result: LigandPoseResult;
  createdAt: string;
  contentHash?: string;
}

export interface PoseOptions {
  referenceConformerId: string | null;
  comparisonConformerId: string | null;
}
export const DEFAULT_POSE_OPTIONS: PoseOptions = {
  referenceConformerId: null,
  comparisonConformerId: null,
};
export interface SavedPoseSelection {
  options: PoseOptions;
  resultKey?: string;
}
export interface PoseSlotState {
  options: PoseOptions;
  enabled: boolean;
  phase:
    | "idle"
    | "preparing"
    | "running"
    | "ready"
    | "unavailable"
    | "error"
    | "cancelled"
    | "restoring";
  contextKey: string;
  result: LigandPoseResult | null;
  record: StoredLigandPose | null;
  savedKey?: string;
  mode: "fresh" | "cached" | "pinned" | null;
  message: string;
}
