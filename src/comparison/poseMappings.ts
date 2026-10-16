import { isHydrogenElement } from "../domain/elements";
import {
  POSE_MAX_HEAVY_ATOMS,
  POSE_SEARCH_LIMITS,
  poseUnavailable,
  type PoseChemicalGraph,
  type PoseGraphAtom,
  type PoseGraphBond,
  type PoseUnavailable,
} from "../domain/ligandPose";

const atomLabel = (a: PoseGraphAtom) =>
  JSON.stringify([a.element, a.charge, a.aromatic, a.stereo]);
const bondLabel = (b: PoseGraphBond) =>
  JSON.stringify([b.order, b.aromatic, b.stereo]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
interface Graph {
  atoms: PoseGraphAtom[];
  edges: Map<number, string>[];
  hydrogens: { name: string; label: string }[][];
  stereoBonds: [number, number][];
}
function graph(source: PoseChemicalGraph): Graph | PoseUnavailable {
  if (source.containsMetal)
    return poseUnavailable(
      "metal_containing",
      "Metal-containing graphs are outside the pose policy.",
    );
  const atoms = source.atoms
    .filter((a) => !isHydrogenElement(a.element))
    .sort((a, b) => compare(a.name, b.name));
  if (atoms.length > POSE_MAX_HEAVY_ATOMS)
    return poseUnavailable(
      "atom_limit",
      "The pose policy supports at most 256 heavy atoms.",
    );
  if (
    !atoms.length ||
    !source.bonds.length ||
    source.atoms.length > POSE_MAX_HEAVY_ATOMS * 5
  )
    return poseUnavailable(
      "invalid_chemistry",
      "Empty or oversized chemical graph.",
    );
  const byName = new Map(source.atoms.map((a) => [a.name, a]));
  if (
    byName.size !== source.atoms.length ||
    source.atoms.some(
      (a) =>
        !a.name ||
        !a.element ||
        !Number.isSafeInteger(a.charge) ||
        typeof a.aromatic !== "boolean" ||
        !["N", "R", "S"].includes(a.stereo ?? ""),
    )
  )
    return poseUnavailable(
      "invalid_chemistry",
      "Chemical atom labels must be complete and unique.",
    );
  const heavy = new Map(atoms.map((a, i) => [a.name, i]));
  const edges = atoms.map(() => new Map<number, string>()),
    hydrogens: Graph["hydrogens"] = atoms.map(() => []);
  const stereoBonds: Graph["stereoBonds"] = [],
    seen = new Set<string>(),
    hydrogenDegree = new Map<string, number>();
  for (const b of source.bonds) {
    const a = byName.get(b.a),
      z = byName.get(b.b),
      key = JSON.stringify([b.a, b.b].sort());
    if (
      !a ||
      !z ||
      a === z ||
      seen.has(key) ||
      !["SING", "DOUB", "TRIP", "AROM"].includes(b.order ?? "") ||
      !["SING", "DOUB", "TRIP", "AROM"].includes(b.sourceOrder ?? "") ||
      typeof b.aromatic !== "boolean" ||
      !["N", "E", "Z"].includes(b.stereo ?? "") ||
      (b.order === "AROM") !== b.aromatic ||
      (b.aromatic && (!a.aromatic || !z.aromatic)) ||
      (!b.aromatic && b.order !== b.sourceOrder) ||
      (b.aromatic && b.sourceOrder === "TRIP")
    )
      return poseUnavailable(
        "invalid_chemistry",
        "Invalid, duplicate or contradictory chemical bond.",
      );
    seen.add(key);
    const i = heavy.get(b.a),
      j = heavy.get(b.b);
    if (i === undefined || j === undefined) {
      const h = i === undefined ? a : z,
        parent = i ?? j;
      if (
        parent === undefined ||
        h.stereo !== "N" ||
        h.aromatic ||
        b.order !== "SING" ||
        b.stereo !== "N"
      )
        return poseUnavailable(
          "unsupported_stereo",
          "Only terminal, non-stereogenic hydrogen bonds are supported.",
        );
      hydrogenDegree.set(h.name, (hydrogenDegree.get(h.name) ?? 0) + 1);
      hydrogens[parent].push({
        name: h.name,
        label: JSON.stringify([atomLabel(h), bondLabel(b)]),
      });
    } else {
      edges[i].set(j, bondLabel(b));
      edges[j].set(i, bondLabel(b));
      if (b.stereo !== "N") {
        if (b.order !== "DOUB")
          return poseUnavailable(
            "unsupported_stereo",
            "E/Z requires a nonaromatic double bond.",
          );
        stereoBonds.push([i, j]);
      }
    }
  }
  if (
    source.atoms.some(
      (a) => isHydrogenElement(a.element) && hydrogenDegree.get(a.name) !== 1,
    )
  )
    return poseUnavailable(
      "unsupported_stereo",
      "Hydrogen connectivity must be explicitly terminal.",
    );
  const reached = new Set([0]),
    queue = [0];
  for (let k = 0; k < queue.length; k++)
    for (const j of edges[queue[k]].keys())
      if (!reached.has(j)) {
        reached.add(j);
        queue.push(j);
      }
  if (reached.size !== atoms.length)
    return poseUnavailable(
      "invalid_chemistry",
      "Disconnected graphs are outside the pose policy.",
    );
  hydrogens.forEach((h) =>
    h.sort((a, b) => compare(a.label, b.label) || compare(a.name, b.name)),
  );
  for (let i = 0; i < atoms.length; i++)
    if (
      atoms[i].stereo !== "N" &&
      (edges[i].size + hydrogens[i].length !== 4 ||
        new Set(hydrogens[i].map((h) => h.label)).size !== hydrogens[i].length)
    )
      return poseUnavailable(
        "unsupported_stereo",
        "Tetrahedral stereo requires four explicit, distinguishable neighbors; implicit or equivalent hydrogen neighbors are unsupported.",
      );
  for (const [i, j] of stereoBonds)
    for (const k of [i, j]) {
      const degree = edges[k].size - 1 + hydrogens[k].length;
      if (
        degree < 1 ||
        degree > 2 ||
        new Set(hydrogens[k].map((h) => h.label)).size !== hydrogens[k].length
      )
        return poseUnavailable(
          "unsupported_stereo",
          "Unsupported E/Z substituent context.",
        );
    }
  return { atoms, edges, hydrogens, stereoBonds };
}

// Shared color refinement preserves element, charge, aromatic/stereo labels, degree,
// hydrogen inventory and progressively larger neighborhoods. Names never partition candidates.
function colors(a: Graph, b: Graph) {
  const graphs = [a, b];
  const intern = (keys: string[][]) => {
    const unique = [...new Set(keys.flat())].sort(),
      ids = new Map(unique.map((s, i) => [s, i]));
    return keys.map((ks) => ks.map((k) => ids.get(k)!));
  };
  let c = intern(
    graphs.map((g) =>
      g.atoms.map((a, i) =>
        JSON.stringify([
          atomLabel(a),
          g.edges[i].size,
          g.hydrogens[i].map((h) => h.label),
        ]),
      ),
    ),
  );
  for (let r = 0; r < a.atoms.length + b.atoms.length; r++) {
    const next = intern(
      graphs.map((g, k) =>
        g.atoms.map((_, i) =>
          JSON.stringify([
            c[k][i],
            [...g.edges[i]]
              .map(([j, label]) => JSON.stringify([label, c[k][j]]))
              .sort(),
          ]),
        ),
      ),
    );
    if (new Set(next.flat()).size === new Set(c.flat()).size) return next;
    c = next;
  }
  return c;
}
function parity(order: number[]) {
  let odd = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++)
      if (order[i] > order[j]) odd ^= 1;
  return odd;
}
/** Same named graph on both sides lets a fixed stereo site use its own deposited neighbor
 * order as a common frame. Moving sites require distinct invariant neighbor colors; if
 * refinement cannot order them, refuse the whole calculation instead of losing a map.
 * R/S or E/Z equality alone is never the permutation test.
 */
function stereoCheck(
  a: Graph,
  b: Graph,
  ca: number[],
  cb: number[],
  map: number[],
): boolean | null {
  const neighbors = (g: Graph, c: number[], i: number, exclude = -1) => [
    ...[...g.edges[i].keys()]
      .filter((j) => j !== exclude)
      .map((j) => ({ name: g.atoms[j].name, label: `C:${c[j]}`, index: j })),
    ...g.hydrogens[i].map((h, n) => ({
      name: h.name,
      label: `H:${h.label}`,
      index: -n - 1,
    })),
  ];
  const p = (
    i: number,
    j: number,
    excludeA = -1,
    excludeB = -1,
  ): number | null => {
    const ns = neighbors(a, ca, i, excludeA),
      nt = neighbors(b, cb, j, excludeB);
    const fixed =
      a.atoms[i].name === b.atoms[j].name &&
      (excludeA === -1 || a.atoms[excludeA].name === b.atoms[excludeB].name);
    if (
      !fixed &&
      (new Set(ns.map((n) => n.label)).size !== ns.length ||
        new Set(nt.map((n) => n.label)).size !== nt.length)
    )
      return null;
    const key = (n: (typeof ns)[number]) => (fixed ? n.name : n.label);
    ns.sort((x, y) => compare(key(x), key(y)));
    nt.sort((x, y) => compare(key(x), key(y)));
    const order = ns.map((n) =>
      nt.findIndex((t) =>
        n.index >= 0 ? t.index === map[n.index] : t.index === n.index,
      ),
    );
    return order.some((i) => i < 0) ? null : parity(order);
  };
  let unknown = false;
  for (let i = 0; i < a.atoms.length; i++)
    if (a.atoms[i].stereo !== "N") {
      const value = p(i, map[i]);
      if (value === 1) return false;
      if (value === null) unknown = true;
    }
  for (const [i, j] of a.stereoBonds) {
    const left = p(i, map[i], j, map[j]),
      right = p(j, map[j], i, map[i]);
    if (left === null || right === null) unknown = true;
    else if ((left ^ right) !== 0) return false;
  }
  return unknown ? null : true;
}

export type PoseMappings =
  | PoseUnavailable
  | {
      status: "mapped";
      referenceNames: string[];
      comparisonNames: string[];
      /** Each complete map indexes comparisonNames in referenceNames order. H permutations are collapsed. */
      maps: number[][];
      searchStates: number;
    };
/** Exact graph search. Smaller budgets are useful for validation; the calculator uses only
 * the versioned production limits. No partial mapping set is returned on exhaustion.
 */
export function enumeratePoseMappings(
  reference: PoseChemicalGraph,
  comparison: PoseChemicalGraph,
  limits: { maxStates: number; maxMaps: number } = POSE_SEARCH_LIMITS,
): PoseMappings {
  if (reference.componentId !== comparison.componentId)
    return poseUnavailable(
      "different_component",
      "Pose comparison requires the same chemical component.",
    );
  if (
    !Number.isSafeInteger(limits.maxStates) ||
    !Number.isSafeInteger(limits.maxMaps) ||
    limits.maxStates < 1 ||
    limits.maxMaps < 1 ||
    limits.maxStates > POSE_SEARCH_LIMITS.maxStates ||
    limits.maxMaps > POSE_SEARCH_LIMITS.maxMaps
  )
    return poseUnavailable(
      "invalid_input",
      "Search budgets must be positive integers within the versioned limits.",
    );
  const a = graph(reference),
    b = graph(comparison);
  if ("status" in a) return a;
  if ("status" in b) return b;
  // Validate actual labels, not just an untrusted hash. Source Kekule orders are normalized by M4-A.
  const signature = (g: PoseChemicalGraph) =>
    JSON.stringify({
      atoms: [...g.atoms].sort((a, b) => compare(a.name, b.name)),
      bonds: g.bonds
        .map(({ sourceOrder: _, a, b, ...rest }) => ({
          ends: [a, b].sort(),
          ...rest,
        }))
        .sort((a, b) =>
          compare(JSON.stringify(a.ends), JSON.stringify(b.ends)),
        ),
    });
  if (signature(reference) !== signature(comparison))
    return poseUnavailable(
      "chemistry_conflict",
      "Pinned name-addressed chemical graphs disagree.",
    );
  const [ca, cb] = colors(a, b),
    n = a.atoms.length;
  const candidates = ca.map((color) =>
    cb.flatMap((c, j) => (c === color ? [j] : [])),
  );
  const map = Array(n).fill(-1) as number[],
    used = new Set<number>(),
    maps: number[][] = [];
  let searchStates = 0,
    failure: PoseUnavailable | null = null;
  const compatible = (i: number, j: number) => {
    for (let k = 0; k < n; k++)
      if (map[k] !== -1 && a.edges[i].get(k) !== b.edges[j].get(map[k]))
        return false;
    return true;
  };
  const visit = (depth: number) => {
    if (failure) return;
    if (++searchStates > limits.maxStates) {
      failure = poseUnavailable(
        "search_limit",
        "Exact pose search exceeded its state budget; no best-so-far score is returned.",
      );
      return;
    }
    if (depth === n) {
      const stereo = stereoCheck(a, b, ca, cb, map);
      if (stereo === null) {
        failure = poseUnavailable(
          "unsupported_stereo",
          "A mapping moves a stereo site whose neighbor order cannot be established by this policy.",
        );
        return;
      }
      if (!stereo) return;
      if (maps.length === limits.maxMaps) {
        failure = poseUnavailable(
          "map_limit",
          "Exact pose search exceeded its complete-map budget; no best-so-far score is returned.",
        );
        return;
      }
      maps.push([...map]);
      return;
    }
    // Most constrained next atom, then stable atom name; deterministic candidates.
    let next = -1,
      choices: number[] = [];
    for (let i = 0; i < n; i++)
      if (map[i] === -1) {
        const available = candidates[i].filter(
          (j) => !used.has(j) && compatible(i, j),
        );
        if (!available.length) return;
        if (next === -1 || available.length < choices.length) {
          next = i;
          choices = available;
        }
      }
    for (const j of choices) {
      map[next] = j;
      used.add(j);
      visit(depth + 1);
      used.delete(j);
      map[next] = -1;
      if (failure) return;
    }
  };
  visit(0);
  if (failure) return failure;
  if (!maps.length)
    return poseUnavailable(
      "no_correspondence",
      "No complete stereochemistry-preserving atom correspondence exists.",
    );
  maps.sort((a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return {
    status: "mapped",
    referenceNames: a.atoms.map((a) => a.name),
    comparisonNames: b.atoms.map((a) => a.name),
    maps,
    searchStates,
  };
}
