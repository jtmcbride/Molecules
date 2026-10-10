import type { StructureSnapshot } from "../domain/types";
import { isHydrogenElement } from "../domain/elements";
// Expected standard amino-acid heavy atoms, excluding optional terminal OXT.
// This is a completeness check, not a protonation or chemical-state assignment.
const SIDECHAINS: Record<string, string> = {
  ALA: "CB",
  ARG: "CB CG CD NE CZ NH1 NH2",
  ASN: "CB CG OD1 ND2",
  ASP: "CB CG OD1 OD2",
  CYS: "CB SG",
  GLN: "CB CG CD OE1 NE2",
  GLU: "CB CG CD OE1 OE2",
  GLY: "",
  HIS: "CB CG ND1 CD2 CE1 NE2",
  ILE: "CB CG1 CG2 CD1",
  LEU: "CB CG CD1 CD2",
  LYS: "CB CG CD CE NZ",
  MET: "CB CG SD CE",
  PHE: "CB CG CD1 CD2 CE1 CE2 CZ",
  PRO: "CB CG CD",
  SER: "CB OG",
  THR: "CB OG1 CG2",
  TRP: "CB CG CD1 CD2 NE1 CE2 CE3 CZ2 CZ3 CH2",
  TYR: "CB CG CD1 CD2 CE1 CE2 CZ OH",
  VAL: "CB CG1 CG2",
};
export function incompleteResidues(
  snapshot: StructureSnapshot,
  context: number[],
) {
  const observed = new Map<string, Set<string>>();
  for (const i of context)
    if (!isHydrogenElement(snapshot.atoms[i].element)) {
      const id = snapshot.residues[snapshot.atomBuffer.residueIndices[i]].id;
      if (!observed.has(id)) observed.set(id, new Set());
      observed.get(id)!.add(snapshot.atoms[i].name);
    }
  const missing = new Map<string, string[]>();
  for (const residue of snapshot.residues) {
    const names = observed.get(residue.id);
    if (!names || residue.kind === "water") continue;
    const standard = SIDECHAINS[residue.componentId];
    const expected =
      standard !== undefined
        ? `N CA C O ${standard}`.trim().split(/\s+/)
        : snapshot.chemistry.expectedHeavyAtomNames?.[residue.componentId];
    if (!expected) continue;
    const absent = expected.filter((name) => !names.has(name));
    if (absent.length) missing.set(residue.id, absent);
  }
  return missing;
}
