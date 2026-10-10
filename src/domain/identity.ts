/** JSON tuples preserve separators, insertion codes, and nulls without collisions. */
export function identity(...parts: (string | number | null)[]): string {
  return JSON.stringify(parts);
}
export function optionalCifString(value: string): string | null {
  return value === "" || value === "." || value === "?" ? null : value;
}
export function choosePreferredConformer(
  atoms: {
    index: number;
    name: string;
    altId: string | null;
    occupancy: number;
  }[],
) {
  const groups = new Map<string, { sum: number; count: number }>();
  for (const atom of atoms) {
    if (!atom.altId) continue;
    const group = groups.get(atom.altId) ?? { sum: 0, count: 0 };
    group.sum += Number.isFinite(atom.occupancy) ? atom.occupancy : 0;
    group.count++;
    groups.set(atom.altId, group);
  }
  const preferredAltId =
    [...groups].sort(
      (a, b) =>
        b[1].sum / b[1].count - a[1].sum / a[1].count ||
        a[0].localeCompare(b[0]),
    )[0]?.[0] ?? null;
  const eligible = atoms.filter((a) => !a.altId || a.altId === preferredAltId);
  const byName = new Map<string, (typeof eligible)[number]>();
  for (const atom of eligible) {
    const previous = byName.get(atom.name);
    if (
      !previous ||
      atom.occupancy > previous.occupancy ||
      (atom.occupancy === previous.occupancy && atom.index < previous.index)
    )
      byName.set(atom.name, atom);
  }
  return {
    preferredAltId,
    indices: [...byName.values()].map((a) => a.index).sort((a, b) => a - b),
  };
}
