import { CIF } from "molstar/lib/mol-io/reader/cif";
import type {
  CifCategory,
  CifFrame,
} from "molstar/lib/mol-io/reader/cif/data-model";
import { isMetal } from "molstar/lib/mol-model/structure/model/properties/atomic/types";
import {
  getElementFromAtomicNumber,
  type ElementSymbol,
} from "molstar/lib/mol-model/structure/model/types";
import { normalizeElement } from "../domain/elements";
import {
  poseUnavailable,
  type PoseChemicalGraph,
  type PoseGraphRead,
  type PoseGraphAtom,
  type PoseGraphBond,
  type PoseAttachmentContext,
} from "../domain/ligandPose";
import type { StructureSnapshot } from "../domain/types";

const ELEMENTS = new Set<string>([
  ...Array.from({ length: 118 }, (_, i) => getElementFromAtomicNumber(i + 1)),
  "D",
  "T",
]);
const value = (
  category: CifCategory | undefined,
  name: string,
  row: number,
) => {
  const f = category?.getField(name);
  return f && f.valueKind(row) === 0 ? f.str(row).trim() : null;
};
export async function poseCifFrame(bytes: Uint8Array, binary = false) {
  const parsed = await CIF.parse(
    binary ? bytes : new TextDecoder().decode(bytes),
  ).run();
  if (parsed.isError || parsed.result.blocks.length !== 1)
    throw Error("Pose chemistry requires one valid CIF data block.");
  return parsed.result.blocks[0];
}

/** Read only deposited dictionary fields. No bond inference, aromaticity perception or defaults. */
export function chemicalGraph(
  frame: CifFrame,
  componentId: string,
): PoseGraphRead {
  const atoms: PoseGraphAtom[] = [],
    bonds: PoseGraphBond[] = [];
  const atomCategory = frame.categories.chem_comp_atom,
    bondCategory = frame.categories.chem_comp_bond;
  const atomNames = new Set<string>(),
    bondNames = new Set<string>();
  const invalid = (reason: string) =>
    poseUnavailable("invalid_chemistry", reason);
  const flag = (v: string | null) =>
    v === "Y" ? true : v === "N" ? false : null;
  for (let i = 0; i < (atomCategory?.rowCount ?? 0); i++) {
    if (value(atomCategory, "comp_id", i) !== componentId) continue;
    const name = value(atomCategory, "atom_id", i),
      symbol = value(atomCategory, "type_symbol", i);
    const charge = value(atomCategory, "charge", i),
      aromatic =
        value(atomCategory, "pdbx_aromatic_flag", i)?.toUpperCase() ?? null;
    const stereo =
      value(atomCategory, "pdbx_stereo_config", i)?.toUpperCase() ?? null;
    if (
      !name ||
      !symbol ||
      !ELEMENTS.has(normalizeElement(symbol)) ||
      atomNames.has(name)
    )
      return invalid("Missing, invalid or duplicate chemical atom identity.");
    if (
      charge !== null &&
      (!/^[+-]?\d+$/.test(charge) || !Number.isSafeInteger(Number(charge)))
    )
      return invalid(`Invalid formal charge for ${name}.`);
    if (aromatic !== null && !["Y", "N"].includes(aromatic))
      return invalid(`Unsupported aromatic flag for ${name}.`);
    if (stereo !== null && !["N", "R", "S"].includes(stereo))
      return poseUnavailable(
        "unsupported_stereo",
        `Unsupported atom stereochemistry for ${name}.`,
      );
    atomNames.add(name);
    atoms.push({
      name,
      element: normalizeElement(symbol),
      charge: charge === null ? null : Number(charge),
      aromatic: flag(aromatic),
      stereo: stereo as PoseGraphAtom["stereo"],
    });
  }
  for (let i = 0; i < (bondCategory?.rowCount ?? 0); i++) {
    if (value(bondCategory, "comp_id", i) !== componentId) continue;
    const a = value(bondCategory, "atom_id_1", i),
      b = value(bondCategory, "atom_id_2", i);
    const sourceOrder =
      value(bondCategory, "value_order", i)?.toUpperCase() ?? null;
    const aromatic =
      value(bondCategory, "pdbx_aromatic_flag", i)?.toUpperCase() ?? null;
    const stereo =
      value(bondCategory, "pdbx_stereo_config", i)?.toUpperCase() ?? null;
    if (
      !a ||
      !b ||
      a === b ||
      (sourceOrder !== null &&
        !["SING", "DOUB", "TRIP", "AROM"].includes(sourceOrder))
    )
      return invalid("Missing endpoints or unsupported chemical bond order.");
    const [x, y] = [a, b].sort(),
      key = JSON.stringify([x, y]);
    if (bondNames.has(key)) return invalid(`Duplicate bond ${a}–${b}.`);
    if (aromatic !== null && !["Y", "N"].includes(aromatic))
      return invalid(`Unsupported aromatic flag for ${a}–${b}.`);
    if (stereo !== null && !["N", "E", "Z"].includes(stereo))
      return poseUnavailable(
        "unsupported_stereo",
        `Unsupported bond stereochemistry for ${a}–${b}.`,
      );
    if (
      (sourceOrder === "AROM" && aromatic === "N") ||
      (sourceOrder === "TRIP" && aromatic === "Y")
    )
      return invalid(`Contradictory aromatic bond ${a}–${b}.`);
    if (
      stereo &&
      stereo !== "N" &&
      ((sourceOrder !== null && sourceOrder !== "DOUB") || aromatic === "Y")
    )
      return poseUnavailable(
        "unsupported_stereo",
        `E/Z label on a non-double or aromatic bond ${a}–${b}.`,
      );
    bondNames.add(key);
    bonds.push({
      a: x,
      b: y,
      sourceOrder: sourceOrder as PoseGraphBond["sourceOrder"],
      order:
        aromatic === "Y" ? "AROM" : (sourceOrder as PoseGraphBond["order"]),
      aromatic: flag(aromatic),
      stereo: stereo as PoseGraphBond["stereo"],
    });
  }
  const graph: PoseChemicalGraph = {
    componentId,
    atoms: atoms.sort((a, b) => (a.name < b.name ? -1 : 1)),
    bonds: bonds.sort((a, b) =>
      JSON.stringify([a.a, a.b]) < JSON.stringify([b.a, b.b]) ? -1 : 1,
    ),
    containsMetal: atoms.some((a) => isMetal(a.element as ElementSymbol)),
  };
  if (!atoms.length || !bonds.length) return { status: "incomplete", graph };
  const byName = new Map(atoms.map((a) => [a.name, a]));
  for (const bond of bonds) {
    const a = byName.get(bond.a),
      b = byName.get(bond.b);
    if (!a || !b)
      return invalid("A chemical bond references an undefined atom.");
    if (bond.aromatic && (a.aromatic === false || b.aromatic === false))
      return invalid("An aromatic bond has a nonaromatic endpoint.");
  }
  const visited = new Set([atoms[0].name]);
  for (let size = -1; size !== visited.size;) {
    size = visited.size;
    for (const b of bonds)
      if (visited.has(b.a) || visited.has(b.b)) {
        visited.add(b.a);
        visited.add(b.b);
      }
  }
  if (visited.size !== atoms.length)
    return invalid(
      "Disconnected chemical graphs are outside the initial pose scope.",
    );
  return {
    status:
      atoms.every(
        (a) => a.charge !== null && a.aromatic !== null && a.stereo !== null,
      ) &&
      bonds.every(
        (b) =>
          b.sourceOrder !== null && b.aromatic !== null && b.stereo !== null,
      )
        ? "complete"
        : "incomplete",
    graph,
  };
}

/** Name-addressed graph identity; coordinate/ideal-coordinate fields do not enter chemistry. */
export function poseGraphIdentity(graph: PoseChemicalGraph) {
  return JSON.stringify({
    componentId: graph.componentId,
    atoms: graph.atoms,
    bonds: graph.bonds.map(({ sourceOrder: _, ...bond }) => bond),
  });
}
/** Check every specified embedded fact against the chosen complete dictionary. */
export function chemicalGraphConflict(
  embedded: PoseChemicalGraph,
  dictionary: PoseChemicalGraph,
) {
  const atoms = new Map(dictionary.atoms.map((a) => [a.name, a]));
  for (const a of embedded.atoms) {
    const b = atoms.get(a.name);
    if (
      !b ||
      a.element !== b.element ||
      (["charge", "aromatic", "stereo"] as const).some(
        (k) => a[k] !== null && a[k] !== b[k],
      )
    )
      return `Conflicting chemical atom ${a.name}.`;
  }
  const bonds = new Map(
    dictionary.bonds.map((b) => [JSON.stringify([b.a, b.b]), b]),
  );
  for (const a of embedded.bonds) {
    const b = bonds.get(JSON.stringify([a.a, a.b]));
    if (
      !b ||
      (a.order !== null &&
        (a.aromatic === null
          ? a.sourceOrder !== b.sourceOrder
          : a.order !== b.order)) ||
      (["aromatic", "stereo"] as const).some(
        (k) => a[k] !== null && a[k] !== b[k],
      )
    )
      return `Conflicting chemical bond ${a.a}–${a.b}.`;
  }
  return null;
}

/** Source-recorded attachment only. Conservative on incomplete identifiers, including insertion codes.
 * Atom source rows locate the residue in the original file, independent of assembly copies.
 */
export function poseAttachment(
  frame: CifFrame,
  snapshot: StructureSnapshot,
  residueId: string,
): PoseAttachmentContext {
  const result: PoseAttachmentContext = {
    sourceHash: snapshot.provenance.contentHash,
    snapshotId: snapshot.id,
    residueId,
    status: "no_recorded_link",
    connectionIds: [],
  };
  const residue = snapshot.residues.find((r) => r.id === residueId);
  const row = residue && snapshot.atoms[residue.atomIndices[0]]?.sourceRow;
  const site = frame.categories.atom_site,
    conn = frame.categories.struct_conn;
  if (row === undefined || !site || row >= site.rowCount)
    return { ...result, status: "unknown" };
  if (!conn) return result;
  const match = (i: number, side: number): boolean | null => {
    let discriminated = false;
    for (const [suffix, siteName] of [
      ["label_asym_id", "label_asym_id"],
      ["label_comp_id", "label_comp_id"],
      ["label_seq_id", "label_seq_id"],
      ["auth_seq_id", "auth_seq_id"],
    ]) {
      const a = value(conn, `ptnr${side}_${suffix}`, i),
        b = value(site, siteName, row);
      if (a !== null && b !== null && a !== b) return false;
      if (suffix.endsWith("seq_id") && a !== null && b !== null)
        discriminated = true;
    }
    const insertion = value(conn, `pdbx_ptnr${side}_PDB_ins_code`, i),
      actual = value(site, "pdbx_PDB_ins_code", row);
    if (insertion !== actual)
      return actual && insertion === null ? null : false;
    return value(conn, `ptnr${side}_label_asym_id`, i) && discriminated
      ? true
      : null;
  };
  for (let i = 0; i < conn.rowCount; i++) {
    const type = value(conn, "conn_type_id", i)?.toLowerCase();
    if (
      type &&
      !(type.startsWith("covale") || type === "disulf" || type === "modres")
    )
      continue;
    const a = match(i, 1),
      b = match(i, 2);
    if (a === false && b === false) continue;
    // Intra-residue bond within the same crystallographic instance is not an attachment.
    const symmetryA = value(conn, "ptnr1_symmetry", i),
      symmetryB = value(conn, "ptnr2_symmetry", i);
    if (
      a === true &&
      b === true &&
      symmetryA !== null &&
      symmetryA === symmetryB
    )
      continue;
    result.connectionIds.push(value(conn, "id", i) ?? `row:${i}`);
    if (
      a === true &&
      b === true &&
      (symmetryA === null || symmetryB === null)
    ) {
      if (result.status !== "covalent") result.status = "unknown";
    } else if (type && (a === true || b === true)) result.status = "covalent";
    else if (result.status !== "covalent") result.status = "unknown";
  }
  return result;
}
