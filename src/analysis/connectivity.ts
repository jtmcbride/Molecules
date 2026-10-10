import {
  Structure,
  StructureElement,
  Unit,
} from "molstar/lib/mol-model/structure";
import { OrderedSet } from "molstar/lib/mol-data/int";
import type { AnalysisRun } from "../domain/analysis";
import type { SelectionIndex } from "../structure/extract";

/** Domain atom index by Mol* `${unitId}:${element}` location. */
export type AtomLocations = Map<string, number>;
export function atomLocations(index: SelectionIndex): AtomLocations {
  return new Map(
    index.locationsByAtom.map((l, i) => [`${l.unitId}:${l.element}`, i]),
  );
}

/** Mol* sub-structure containing exactly the given domain atoms. */
export function selectAtoms(
  structure: Structure,
  index: SelectionIndex,
  atoms: number[],
): Structure {
  const grouped = new Map<number, number[]>();
  for (const atom of atoms) {
    const l = index.locationsByAtom[atom];
    if (!grouped.has(l.unitId)) grouped.set(l.unitId, []);
    grouped.get(l.unitId)!.push(l.unitIndex);
  }
  return StructureElement.Loci.toStructure(
    StructureElement.Loci(
      structure,
      [...grouped].map(([id, indices]) => ({
        unit: structure.unitMap.get(id)!,
        indices: OrderedSet.ofSortedArray(
          indices.sort((a, b) => a - b) as StructureElement.UnitIndex[],
        ),
      })),
    ),
  );
}

// Mol* bond flags: bit 1 is a covalent bond; bit 32 marks geometry-inferred connectivity.
const COVALENT = 1;
const COMPUTED = 32;

/** Covalent connectivity of the selected context in domain atom indices. */
export class Connectivity {
  readonly bonds: AnalysisRun["bonds"] = [];
  readonly adjacency = new Map<number, Set<number>>();
  private seen = new Set<string>();

  add(
    a: number | undefined,
    b: number | undefined,
    order: number,
    flags: number,
  ) {
    if (a === undefined || b === undefined || !(flags & COVALENT)) return;
    const atomA = Math.min(a, b),
      atomB = Math.max(a, b),
      key = `${atomA}:${atomB}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.bonds.push({
      atomA,
      atomB,
      order,
      provenance:
        flags & COMPUTED ? "geometry_inferred" : "dictionary_or_explicit",
    });
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      if (!this.adjacency.has(x)) this.adjacency.set(x, new Set());
      this.adjacency.get(x)!.add(y);
    }
  }

  neighbors(atom: number): Set<number> {
    return this.adjacency.get(atom) ?? new Set();
  }

  /** True when the atoms are at most `maxBonds` covalent bonds apart. */
  withinBonds(a: number, b: number, maxBonds: number): boolean {
    let frontier = [a];
    const seen = new Set([a]);
    for (let depth = 0; depth < maxBonds && frontier.length; depth++) {
      const next: number[] = [];
      for (const atom of frontier)
        for (const n of this.adjacency.get(atom) ?? []) {
          if (n === b) return true;
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      frontier = next;
    }
    return false;
  }

  /**
   * Ligand–receptor pairs are excluded up to three bonds apart. Any covalent path between
   * them crosses a ligand–receptor link, so this only differs from the two-bond rule for
   * covalently attached ligands, where 1–4 pairs across the link are not noncovalent contacts.
   */
  ligandReceptorBonded(ligandAtom: number, receptorAtom: number): boolean {
    return this.withinBonds(ligandAtom, receptorAtom, 3);
  }

  /** Covalent bonds joining a ligand atom to a receptor atom. */
  crossLinks(ligand: Set<number>, receptor: Set<number>) {
    return this.bonds.filter(
      (b) =>
        (ligand.has(b.atomA) && receptor.has(b.atomB)) ||
        (ligand.has(b.atomB) && receptor.has(b.atomA)),
    );
  }

  /** True when the atoms are one or two covalent bonds apart. */
  withinTwoBonds(a: number, b: number): boolean {
    const first = this.adjacency.get(a);
    if (!first) return false;
    if (first.has(b)) return true;
    for (const n of first) if (this.adjacency.get(n)?.has(b)) return true;
    return false;
  }
}

export function buildConnectivity(
  selected: Structure,
  locations: AtomLocations,
): Connectivity {
  const connectivity = new Connectivity();
  const atom = (unit: Unit, element: number) =>
    locations.get(`${unit.id}:${unit.elements[element]}`);
  for (const unit of selected.units)
    if (Unit.isAtomic(unit)) {
      const { a, b, edgeProps } = unit.bonds;
      for (let i = 0; i < a.length; i++)
        if (a[i] < b[i])
          connectivity.add(
            atom(unit, a[i]),
            atom(unit, b[i]),
            edgeProps.order[i],
            edgeProps.flags[i],
          );
    }
  for (const edge of selected.interUnitBonds.edges)
    connectivity.add(
      atom(selected.unitMap.get(edge.unitA)!, edge.indexA),
      atom(selected.unitMap.get(edge.unitB)!, edge.indexB),
      edge.props.order,
      edge.props.flag,
    );
  return connectivity;
}
