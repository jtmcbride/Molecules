import {
  AtomicNumbers,
  ElementVdwRadii,
} from "molstar/lib/mol-model/structure/model/properties/atomic/measures";
import { isMetal } from "molstar/lib/mol-model/structure/model/properties/atomic/types";
import type { ElementSymbol } from "molstar/lib/mol-model/structure/model/types";
import type { MolecularInteraction } from "../domain/analysis";
type Point = [number, number, number];
export function centroid(positions: Float32Array, atoms: number[]): Point {
  if (!atoms.length) throw new Error("A centroid requires atoms.");
  return [0, 1, 2].map(
    (k) =>
      atoms.reduce((sum, i) => sum + positions[i * 3 + k], 0) / atoms.length,
  ) as Point;
}
export function planeNormal(
  positions: Float32Array,
  atoms: number[],
): Point | undefined {
  if (atoms.length < 3) return;
  // Match Mol*'s first-three-member normal on nondegenerate ring features.
  // Later triples are only a fallback for standalone degenerate input checks.
  const origin = atoms[0];
  for (let a = 1; a < atoms.length - 1; a++)
    for (let b = a + 1; b < atoms.length; b++) {
      const u = [0, 1, 2].map(
        (k) => positions[atoms[a] * 3 + k] - positions[origin * 3 + k],
      );
      const v = [0, 1, 2].map(
        (k) => positions[atoms[b] * 3 + k] - positions[origin * 3 + k],
      );
      const cross: Point = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ],
        n = Math.hypot(...cross);
      if (n >= 1e-8) return cross.map((x) => x / n) as Point;
    }
}
export function ringGeometry(
  positions: Float32Array,
  ligandAtoms: number[],
  receptorAtoms: number[],
  ligandRing: boolean,
  receptorRing: boolean,
): MolecularInteraction["geometry"] {
  const a = centroid(positions, ligandAtoms),
    b = centroid(positions, receptorAtoms),
    delta = a.map((x, k) => x - b[k]);
  const na = ligandRing ? planeNormal(positions, ligandAtoms) : undefined,
    nb = receptorRing ? planeNormal(positions, receptorAtoms) : undefined;
  const offset = (normal: Point) =>
    Math.sqrt(
      Math.max(
        0,
        delta.reduce((s, x) => s + x * x, 0) -
          delta.reduce((s, x, k) => s + x * normal[k], 0) ** 2,
      ),
    );
  const offsets = [na, nb].filter((n): n is Point => !!n).map(offset);
  return {
    ligandCentroid: a,
    receptorCentroid: b,
    centroidDistanceAngstrom: Math.hypot(...delta),
    offsetAngstrom: offsets.length ? Math.min(...offsets) : undefined,
    planeAngleDegrees:
      na && nb
        ? (Math.acos(
            Math.min(1, Math.abs(na.reduce((s, x, k) => s + x * nb[k], 0))),
          ) *
            180) /
          Math.PI
        : undefined,
  };
}
/** Use published radii only. Metals require coordination analysis rather than a VdW clash label. */
export function clashRadius(element: string): number | undefined {
  const symbol = element.toUpperCase();
  if (isMetal(symbol as ElementSymbol)) return;
  const number = AtomicNumbers[symbol];
  return number === undefined ? undefined : ElementVdwRadii[number];
}

// Single-bond covalent radii (Å) for nonmetal elements; Cordero et al., Dalton Trans. 2832 (2008),
// sp3 carbon. Metals are excluded: metal–ligand contacts are coordination, not unrecorded bonds.
const COVALENT_RADII: Record<string, number> = {
  H: 0.31,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  CL: 1.02,
  SE: 1.2,
  BR: 1.2,
  I: 1.39,
};
export function covalentRadius(element: string): number | undefined {
  return COVALENT_RADII[element.toUpperCase()];
}
