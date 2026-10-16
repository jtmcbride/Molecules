/** Column-major proper rigid transform, comparison assembly -> reference assembly. */
export function isProperPoseTransform(t: readonly number[]) {
  if (t.length !== 16 || !t.every(Number.isFinite)) return false;
  const dot = (a: number, b: number) =>
    [0, 1, 2].reduce((s, i) => s + t[a * 4 + i] * t[b * 4 + i], 0);
  const det =
    t[0] * (t[5] * t[10] - t[9] * t[6]) -
    t[4] * (t[1] * t[10] - t[9] * t[2]) +
    t[8] * (t[1] * t[6] - t[5] * t[2]);
  return (
    Math.abs(t[15] - 1) <= 1e-6 &&
    [3, 7, 11].every((i) => Math.abs(t[i]) <= 1e-6) &&
    Math.abs(det - 1) <= 1e-6 &&
    [0, 1, 2].every((i) =>
      [0, 1, 2].every((j) => Math.abs(dot(i, j) - (i === j ? 1 : 0)) <= 1e-6),
    )
  );
}
