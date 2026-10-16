import type { ComparisonSlot } from "../state/comparison";
import type { StructureSnapshot } from "../domain/types";
/** Exact scientific inputs of the protein fit, shared by fit production and pose consumers. */
export function comparisonFitKey(
  reference: {
    snapshot: StructureSnapshot | null;
    interpretation?: { id: string } | null;
    targetLigandId: string | null;
    ligandGroupId: string | null;
  },
  slot: ComparisonSlot,
) {
  const group = reference.snapshot?.ligandGroups?.find(
    (g) => g.id === reference.ligandGroupId,
  );
  const ligands =
    group?.residueIds ??
    (reference.targetLigandId ? [reference.targetLigandId] : []);
  return JSON.stringify([
    reference.snapshot?.id,
    reference.interpretation?.id,
    slot.interpretation?.id,
    slot.pairingOverrides,
    slot.superpositionScope,
    slot.superpositionScope === "binding_site" ? ligands : null,
  ]);
}
