import type {
  Correspondence,
  RigidTransform,
  SuperpositionResult,
  SuperpositionScope,
} from "../domain/comparison";
import type { StructureSnapshot } from "../domain/types";

type Vec = [number, number, number];

/** Eigen-decomposition of a symmetric 4×4 matrix by cyclic Jacobi rotations. */
function jacobi4(input: number[][]) {
  const a = input.map((row) => [...row]);
  const v: number[][] = [0, 1, 2, 3].map((i) =>
    [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p],
            vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: [0, 1, 2, 3].map((i) => a[i][i]), vectors: v };
}

const centroid = (points: Vec[]): Vec => {
  const c: Vec = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k];
  return c.map((x) => x / points.length) as Vec;
};

/**
 * Least-squares rigid transform moving `moving` onto `target` (Horn, J. Opt. Soc. Am. A 4,
 * 629, 1987: the rotation is the eigenvector of the largest eigenvalue of a 4×4 matrix
 * built from the cross-covariance). Returns a column-major 4×4 matrix.
 */
export function fitRigid(target: Vec[], moving: Vec[]): RigidTransform {
  if (target.length !== moving.length || target.length < 3)
    throw new Error("A rigid fit needs at least three paired points.");
  const ct = centroid(target),
    cm = centroid(moving);
  const S = [0, 1, 2].map(() => [0, 0, 0]);
  for (let i = 0; i < target.length; i++)
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        S[r][c] += (moving[i][r] - cm[r]) * (target[i][c] - ct[c]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = jacobi4(N);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  // q and −q give the same rotation, so the eigenvector's sign does not matter.
  const [q0, q1, q2, q3] = vectors.map((row) => row[best]);
  const R = [
    [
      q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3,
      2 * (q1 * q2 - q0 * q3),
      2 * (q1 * q3 + q0 * q2),
    ],
    [
      2 * (q2 * q1 + q0 * q3),
      q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3,
      2 * (q2 * q3 - q0 * q1),
    ],
    [
      2 * (q3 * q1 - q0 * q2),
      2 * (q3 * q2 + q0 * q1),
      q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3,
    ],
  ];
  const t = [0, 1, 2].map(
    (r) => ct[r] - (R[r][0] * cm[0] + R[r][1] * cm[1] + R[r][2] * cm[2]),
  );
  return [
    R[0][0],
    R[1][0],
    R[2][0],
    0,
    R[0][1],
    R[1][1],
    R[2][1],
    0,
    R[0][2],
    R[1][2],
    R[2][2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

export function applyTransform(m: RigidTransform, p: Vec): Vec {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const distance = (a: Vec, b: Vec) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rms = (values: number[]) =>
  Math.sqrt(values.reduce((t, x) => t + x * x, 0) / values.length);

export const SUPERPOSITION_POLICY = {
  maxCycles: 5,
  /** Pairs deviating by more than this multiple of the current core RMSD are rejected. */
  rejectionFactor: 2,
  /** Rejection stops before fewer than this fraction of the pairs would remain. */
  minFraction: 0.5,
  minAtoms: 10,
  /** Binding-site scope: reference residues with a heavy atom this close to the target ligand. */
  siteRadius: 8,
} as const;

export interface PointPair {
  id: string;
  target: Vec;
  moving: Vec;
}

/**
 * Least-squares fit with iterative outlier rejection: refit after rejecting pairs that
 * deviate by more than `rejectionFactor` × the core RMSD, at most `maxCycles` times, and
 * stop rather than keep fewer than `minFraction` of the pairs or `minAtoms` atoms.
 */
export function superposePairs(pairs: PointPair[]) {
  const policy = SUPERPOSITION_POLICY;
  if (pairs.length < policy.minAtoms)
    throw new Error(
      `Superposition needs at least ${policy.minAtoms} paired Cα atoms; ${pairs.length} are available.`,
    );
  const floor = Math.max(
    policy.minAtoms,
    Math.ceil(policy.minFraction * pairs.length),
  );
  let active = pairs.map((_, i) => i);
  const fit = (indices: number[]) =>
    fitRigid(
      indices.map((i) => pairs[i].target),
      indices.map((i) => pairs[i].moving),
    );
  let transform = fit(active),
    cycles = 0;
  const deviations = (m: RigidTransform) =>
    pairs.map((p) => distance(applyTransform(m, p.moving), p.target));
  for (let c = 0; c < policy.maxCycles; c++) {
    const dev = deviations(transform);
    const core = rms(active.map((i) => dev[i]));
    const keep = active.filter((i) => dev[i] <= policy.rejectionFactor * core);
    if (keep.length === active.length || keep.length < floor) break;
    active = keep;
    transform = fit(active);
    cycles++;
  }
  const dev = deviations(transform);
  const kept = new Set(active);
  return {
    transform,
    rmsdCore: rms(active.map((i) => dev[i])),
    rmsdAll: rms(dev),
    fitted: active.length,
    total: pairs.length,
    cycles,
    rejected: pairs.filter((_, i) => !kept.has(i)).map((p) => p.id),
  };
}

/** Cα of a residue's preferred conformer with positive occupancy, if present. */
function alphaCarbon(snapshot: StructureSnapshot, residueId: string) {
  const residue = snapshot.residues.find((r) => r.id === residueId);
  if (!residue) return undefined;
  const preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const index = residue.atomIndices.find(
    (i) =>
      preferred.has(i) &&
      snapshot.atoms[i].name === "CA" &&
      snapshot.atoms[i].element === "C" &&
      snapshot.atomBuffer.occupancies[i] > 0,
  );
  if (index === undefined) return undefined;
  const p = snapshot.atomBuffer.positions;
  return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]] as Vec;
}

/** Reference residues with a heavy atom within `radius` Å of any target ligand atom. */
export function siteResidues(
  snapshot: StructureSnapshot,
  ligandResidueIds: string[],
  radius: number = SUPERPOSITION_POLICY.siteRadius,
) {
  const p = snapshot.atomBuffer.positions,
    preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const heavy = (i: number) =>
    preferred.has(i) && snapshot.atoms[i].element !== "H";
  const ligandIds = new Set(ligandResidueIds);
  const ligand = snapshot.residues
    .filter((r) => ligandIds.has(r.id))
    .flatMap((r) => r.atomIndices.filter(heavy));
  const r2 = radius * radius;
  return new Set(
    snapshot.residues
      .filter(
        (r) =>
          r.kind === "polymer" &&
          r.atomIndices.some(
            (i) =>
              heavy(i) &&
              ligand.some((j) => {
                const dx = p[i * 3] - p[j * 3],
                  dy = p[i * 3 + 1] - p[j * 3 + 1],
                  dz = p[i * 3 + 2] - p[j * 3 + 2];
                return dx * dx + dy * dy + dz * dz <= r2;
              }),
          ),
      )
      .map((r) => r.id),
  );
}

/** Paired Cα atoms of a correspondence, optionally limited to reference residues in `within`. */
export function alphaPairs(
  correspondence: Correspondence,
  reference: StructureSnapshot,
  comparison: StructureSnapshot,
  within?: Set<string>,
): PointPair[] {
  const pairs: PointPair[] = [];
  for (const pair of correspondence.pairs) {
    if (pair.status !== "paired") continue;
    if (within && !within.has(pair.referenceResidueId!)) continue;
    const target = alphaCarbon(reference, pair.referenceResidueId!),
      moving = alphaCarbon(comparison, pair.comparisonResidueId!);
    if (target && moving)
      pairs.push({
        id: JSON.stringify([pair.referenceChainId, pair.uniprotPosition]),
        target,
        moving,
      });
  }
  return pairs;
}

/**
 * Superposes a comparison structure onto the reference by its SIFTS-paired Cα atoms:
 * every paired residue (`global`) or those near the reference target ligand (`binding_site`).
 */
export function superpose(
  correspondence: Correspondence,
  reference: StructureSnapshot,
  comparison: StructureSnapshot,
  scope: Exclude<SuperpositionScope, "none">,
  referenceLigandIds: string[] = [],
): SuperpositionResult {
  if (scope === "binding_site" && !referenceLigandIds.length)
    throw new Error(
      "Binding-site superposition needs a target ligand in the reference.",
    );
  const within =
    scope === "binding_site"
      ? siteResidues(reference, referenceLigandIds)
      : undefined;
  const result = superposePairs(
    alphaPairs(correspondence, reference, comparison, within),
  );
  return {
    ...result,
    scope,
    ...(scope === "binding_site"
      ? {
          siteRadiusAngstrom: SUPERPOSITION_POLICY.siteRadius,
          referenceLigandIds: [...referenceLigandIds],
        }
      : {}),
    atoms: "CA",
    method: "horn-quaternion-outlier-rejection-v1",
  };
}
