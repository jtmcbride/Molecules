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
}
