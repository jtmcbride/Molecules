import type { MolecularInteraction, RejectionReason } from "../domain/analysis";

export const MAX_INTERACTIONS = 1_000_000;
export type InteractionDraft = Omit<MolecularInteraction, "id">;
export interface Rejection {
  rejected: RejectionReason;
}
export const reject = (reason: RejectionReason): Rejection => ({
  rejected: reason,
});
export const isRejection = <T extends object>(
  value: T | Rejection,
): value is Rejection => "rejected" in value;

/** Deduplicates interactions by type, endpoint atoms, roles and mediator, and counts rejections. */
export class InteractionCollector {
  readonly interactions: MolecularInteraction[] = [];
  readonly rejections: Partial<Record<RejectionReason, number>> = {};
  private seen = new Set<string>();

  record(draft: InteractionDraft) {
    const key = JSON.stringify([
      draft.type,
      draft.ligand.atomIndices,
      draft.ligand.role,
      draft.receptor.atomIndices,
      draft.receptor.role,
      draft.mediator?.atomIndices,
    ]);
    if (this.seen.has(key)) return;
    if (this.interactions.length >= MAX_INTERACTIONS)
      throw new Error(
        "This selection produces too many contacts. Use a smaller receptor or cutoff. No partial results were returned.",
      );
    this.seen.add(key);
    this.interactions.push({ ...draft, id: key });
  }

  reject(reason: RejectionReason) {
    this.rejections[reason] = (this.rejections[reason] ?? 0) + 1;
  }

  accept(result: InteractionDraft | Rejection) {
    if (isRejection(result)) this.reject(result.rejected);
    else this.record(result);
  }
}
