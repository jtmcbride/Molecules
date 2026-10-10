/** Uniform grid. Searches inspect all intersecting cells, including negative coordinates. */
export class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(
    private positions: Float32Array,
    atomIndices: ArrayLike<number>,
    readonly cellSize: number,
  ) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize))
      throw new Error("Invalid spatial cell size.");
    for (let n = 0; n < atomIndices.length; n++) {
      const index = atomIndices[n];
      const key = this.key(
        Math.floor(positions[index * 3] / cellSize),
        Math.floor(positions[index * 3 + 1] / cellSize),
        Math.floor(positions[index * 3 + 2] / cellSize),
      );
      const cell = this.cells.get(key) ?? [];
      cell.push(index);
      this.cells.set(key, cell);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }
  neighbors(
    index: number,
    cutoff: number,
  ): { index: number; distance: number }[] {
    const x = this.positions[index * 3],
      y = this.positions[index * 3 + 1],
      z = this.positions[index * 3 + 2];
    const output: { index: number; distance: number }[] = [];
    const radiusSquared = cutoff * cutoff;
    for (
      let a = Math.floor((x - cutoff) / this.cellSize);
      a <= Math.floor((x + cutoff) / this.cellSize);
      a++
    ) {
      for (
        let b = Math.floor((y - cutoff) / this.cellSize);
        b <= Math.floor((y + cutoff) / this.cellSize);
        b++
      ) {
        for (
          let c = Math.floor((z - cutoff) / this.cellSize);
          c <= Math.floor((z + cutoff) / this.cellSize);
          c++
        ) {
          for (const candidate of this.cells.get(this.key(a, b, c)) ?? []) {
            const dx = x - this.positions[candidate * 3],
              dy = y - this.positions[candidate * 3 + 1],
              dz = z - this.positions[candidate * 3 + 2];
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared <= radiusSquared)
              output.push({ index: candidate, distance: Math.sqrt(squared) });
          }
        }
      }
    }
    return output.sort((a, b) => a.index - b.index);
  }
}
export function atomDistance(
  positions: Float32Array,
  a: number,
  b: number,
): number {
  return Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
}
export function angleDegrees(
  positions: Float32Array,
  a: number,
  vertex: number,
  b: number,
): number | undefined {
  const u = [0, 1, 2].map(
    (k) => positions[a * 3 + k] - positions[vertex * 3 + k],
  );
  const v = [0, 1, 2].map(
    (k) => positions[b * 3 + k] - positions[vertex * 3 + k],
  );
  const denominator = Math.hypot(...u) * Math.hypot(...v);
  if (!denominator) return undefined;
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          u.reduce((sum, value, k) => sum + value * v[k], 0) / denominator,
        ),
      ),
    ) *
      180) /
    Math.PI
  );
}
