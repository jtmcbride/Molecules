import type { StructureSnapshot } from "../domain/types";
/** Owned displayed endpoints. Snapshots already contain assembly coordinates; only the
 * selected display transform is applied here, exactly once per structure. */
export function poseDisplacementPoint(
  snapshot: StructureSnapshot,
  atomId: string,
  transform: readonly number[] | null,
): [number, number, number] | null {
  const i = snapshot.atoms.findIndex((a) => a.id === atomId);
  if (i < 0) return null;
  const p = snapshot.atomBuffer.positions,
    x = p[i * 3],
    y = p[i * 3 + 1],
    z = p[i * 3 + 2];
  return transform
    ? ([0, 1, 2].map(
        (k) =>
          transform[k] * x +
          transform[4 + k] * y +
          transform[8 + k] * z +
          transform[12 + k],
      ) as [number, number, number])
    : [x, y, z];
}
