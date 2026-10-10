import type { StructureSnapshot } from "../domain/types";

type Vec = [number, number, number];

/** Side-chain torsion atoms (IUPAC-IUB 1970): χ1 = N–CA–CB–XG, χ2 = CA–CB–XG–XD. */
export const CHI_ATOMS: Record<string, string[][]> = {
  ARG: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD"],
  ],
  ASN: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "OD1"],
  ],
  ASP: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "OD1"],
  ],
  CYS: [["N", "CA", "CB", "SG"]],
  GLN: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD"],
  ],
  GLU: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD"],
  ],
  HIS: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "ND1"],
  ],
  ILE: [
    ["N", "CA", "CB", "CG1"],
    ["CA", "CB", "CG1", "CD1"],
  ],
  LEU: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD1"],
  ],
  LYS: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD"],
  ],
  MET: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "SD"],
  ],
  PHE: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD1"],
  ],
  PRO: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD"],
  ],
  SER: [["N", "CA", "CB", "OG"]],
  THR: [["N", "CA", "CB", "OG1"]],
  TRP: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD1"],
  ],
  TYR: [
    ["N", "CA", "CB", "CG"],
    ["CA", "CB", "CG", "CD1"],
  ],
  VAL: [["N", "CA", "CB", "CG1"]],
};
/**
 * χ angles with 180° symmetry: swapping the equivalent terminal atoms (Asp OD1/OD2, the
 * Phe/Tyr ring) changes the angle by 180° without changing the structure.
 */
export const CHI_PERIOD: Record<string, Record<number, number>> = {
  ASP: { 2: 180 },
  PHE: { 2: 180 },
  TYR: { 2: 180 },
};
/** Chemically equivalent side-chain atoms whose names may be swapped between depositions. */
export const EQUIVALENT_ATOMS: Record<string, [string, string][]> = {
  ASP: [["OD1", "OD2"]],
  GLU: [["OE1", "OE2"]],
  PHE: [
    ["CD1", "CD2"],
    ["CE1", "CE2"],
  ],
  TYR: [
    ["CD1", "CD2"],
    ["CE1", "CE2"],
  ],
  ARG: [["NH1", "NH2"]],
};

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Dihedral angle a–b–c–d in degrees, in (−180, 180]. */
export function dihedral(a: Vec, b: Vec, c: Vec, d: Vec) {
  const b0 = sub(a, b),
    b1 = sub(c, b),
    b2 = sub(d, c);
  const n = Math.hypot(...b1);
  const u: Vec = [b1[0] / n, b1[1] / n, b1[2] / n];
  const v = sub(b0, u.map((x) => x * dot(b0, u)) as Vec),
    w = sub(b2, u.map((x) => x * dot(b2, u)) as Vec);
  return (Math.atan2(dot(cross(u, v), w), dot(v, w)) * 180) / Math.PI;
}

/** Smallest difference between two angles (degrees) under the given period. */
export function angleDelta(a: number, b: number, period = 360) {
  const d = (((b - a) % period) + period) % period;
  return Math.min(d, period - d);
}

/** Named heavy-atom positions of a residue's preferred conformer with positive occupancy. */
export function residueAtoms(snapshot: StructureSnapshot, residueId: string) {
  const residue = snapshot.residues.find((r) => r.id === residueId);
  const atoms = new Map<string, Vec>();
  if (!residue) return atoms;
  const preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const p = snapshot.atomBuffer.positions;
  for (const i of residue.atomIndices) {
    const atom = snapshot.atoms[i];
    if (
      !preferred.has(i) ||
      atom.element === "H" ||
      !(snapshot.atomBuffer.occupancies[i] > 0)
    )
      continue;
    atoms.set(atom.name, [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
  }
  return atoms;
}

/** χ1 and χ2 (degrees) where all four atoms are present; undefined otherwise. */
export function chiAngles(component: string, atoms: Map<string, Vec>) {
  return (CHI_ATOMS[component] ?? []).map((names) => {
    const xyz = names.map((n) => atoms.get(n));
    return xyz.every(Boolean)
      ? dihedral(xyz[0]!, xyz[1]!, xyz[2]!, xyz[3]!)
      : undefined;
  });
}
