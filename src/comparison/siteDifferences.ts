import {
  COMPARISON_VERSION,
  type Correspondence,
  type ShiftSignificance,
  type SiteDifferences,
  type SiteResidueDifference,
  type SiteWater,
  type SuperpositionResult,
} from "../domain/comparison";
import type { StructureSnapshot } from "../domain/types";
import { applyTransform, siteResidues } from "./superposition";
import {
  CHI_PERIOD,
  EQUIVALENT_ATOMS,
  angleDelta,
  chiAngles,
  residueAtoms,
} from "./torsions";

type Vec = [number, number, number];

export const SITE_POLICY = {
  /** Site residues: a heavy atom within this distance of either structure's ligand. */
  siteRadius: 5,
  /** Shifts under this multiple of the combined coordinate error are within error. */
  significanceFactor: 2,
  /** A χ difference above this is reported as a rotamer change (half a rotamer well). */
  rotamerChangeDegrees: 60,
  /** Site waters: oxygen within this distance of a ligand or site-residue heavy atom. */
  waterRadius: 4,
  /** Waters are conserved when superposed oxygens lie this close. */
  waterMatch: 1.0,
  /** A comparison water this close to a reference ligand heavy atom occupies its site. */
  ligandOverlap: 2.5,
} as const;

const BACKBONE = new Set(["N", "CA", "C", "O", "OXT"]);
const distance = (a: Vec, b: Vec) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Side-chain RMSD over atoms present in both, trying each swap of equivalent atoms. */
function sideChainRmsd(
  component: string,
  ref: Map<string, Vec>,
  cmp: Map<string, Vec>,
) {
  const names = [...ref.keys()].filter((n) => !BACKBONE.has(n) && cmp.has(n));
  if (!names.length) return { rmsd: undefined, matched: 0 };
  const pairs = EQUIVALENT_ATOMS[component] ?? [];
  let best = Infinity;
  for (let mask = 0; mask < 1 << pairs.length; mask++) {
    const rename = new Map<string, string>();
    pairs.forEach(([a, b], k) => {
      if (mask & (1 << k)) {
        rename.set(a, b);
        rename.set(b, a);
      }
    });
    let sum = 0;
    for (const n of names) {
      const partner = cmp.get(rename.get(n) ?? n) ?? cmp.get(n)!;
      sum += distance(ref.get(n)!, partner) ** 2;
    }
    best = Math.min(best, Math.sqrt(sum / names.length));
  }
  return { rmsd: best, matched: names.length };
}

function heavyAtoms(snapshot: StructureSnapshot, residueIds: Iterable<string>) {
  const ids = new Set(residueIds);
  const preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const p = snapshot.atomBuffer.positions;
  return snapshot.residues
    .filter((r) => ids.has(r.id))
    .flatMap((r) => r.atomIndices)
    .filter((i) => preferred.has(i) && snapshot.atoms[i].element !== "H")
    .map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]] as Vec);
}

/** Water oxygens (preferred conformer) as [residue ID, position]. */
function waters(snapshot: StructureSnapshot, transform?: number[]) {
  const preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const p = snapshot.atomBuffer.positions;
  const out: [string, Vec][] = [];
  for (const r of snapshot.residues) {
    if (r.kind !== "water") continue;
    const i = r.atomIndices.find(
      (a) => preferred.has(a) && snapshot.atoms[a].element === "O",
    );
    if (i === undefined) continue;
    const x: Vec = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
    out.push([r.id, transform ? applyTransform(transform, x) : x]);
  }
  return out;
}

const near = (x: Vec, atoms: Vec[], radius: number) =>
  atoms.some((a) => distance(x, a) <= radius);

/**
 * Binding-site differences after superposition: per paired site residue, Cα displacement,
 * side-chain RMSD and χ changes, judged against the combined coordinate error; and site
 * waters conserved between the structures. The site is the union of residues near either
 * structure's ligand (comparison residues mapped through the correspondence), so an apo
 * comparison structure is assessed in the reference's site.
 */
export function siteDifferences(
  reference: StructureSnapshot,
  comparison: StructureSnapshot,
  correspondence: Correspondence,
  superposition: SuperpositionResult,
  referenceLigandIds: string[],
  comparisonLigandIds: string[],
): SiteDifferences {
  const policy = SITE_POLICY;
  const t = superposition.transform;
  const refSite = referenceLigandIds.length
    ? siteResidues(reference, referenceLigandIds, policy.siteRadius)
    : new Set<string>();
  const cmpSite = comparisonLigandIds.length
    ? siteResidues(comparison, comparisonLigandIds, policy.siteRadius)
    : new Set<string>();
  const pairs = correspondence.pairs.filter(
    (p) =>
      (p.referenceResidueId && refSite.has(p.referenceResidueId)) ||
      (p.comparisonResidueId && cmpSite.has(p.comparisonResidueId)),
  );
  const sigmaRef = reference.quality?.coordinateErrorAngstrom,
    sigmaCmp = comparison.quality?.coordinateErrorAngstrom;
  const sigma =
    sigmaRef !== undefined && sigmaCmp !== undefined
      ? Math.hypot(sigmaRef, sigmaCmp)
      : undefined;
  const residues: SiteResidueDifference[] = [];
  let unpaired = 0;
  for (const pair of pairs) {
    if (pair.status !== "paired") {
      unpaired++;
      continue;
    }
    const refResidue = reference.residues.find(
      (r) => r.id === pair.referenceResidueId,
    )!;
    const cmpResidue = comparison.residues.find(
      (r) => r.id === pair.comparisonResidueId,
    )!;
    const ref = residueAtoms(reference, refResidue.id);
    const cmpRaw = residueAtoms(comparison, cmpResidue.id);
    const cmp = new Map(
      [...cmpRaw].map(([n, x]) => [n, applyTransform(t, x)] as [string, Vec]),
    );
    const ca =
      ref.has("CA") && cmp.has("CA")
        ? distance(ref.get("CA")!, cmp.get("CA")!)
        : undefined;
    // Side chains and torsions only compare like with like.
    const same = refResidue.componentId === cmpResidue.componentId;
    const side = same
      ? sideChainRmsd(refResidue.componentId, ref, cmp)
      : { rmsd: undefined, matched: 0 };
    const chiRef = same ? chiAngles(refResidue.componentId, ref) : [],
      chiCmp = same ? chiAngles(cmpResidue.componentId, cmpRaw) : [];
    const chi = chiRef.flatMap((a, k) => {
      const b = chiCmp[k];
      if (a === undefined || b === undefined) return [];
      const period = CHI_PERIOD[refResidue.componentId]?.[k + 1] ?? 360;
      return [
        {
          index: k + 1,
          reference: a,
          comparison: b,
          delta: angleDelta(a, b, period),
        },
      ];
    });
    const shift = Math.max(ca ?? 0, side.rmsd ?? 0);
    const significance: ShiftSignificance =
      sigma === undefined || (ca === undefined && side.rmsd === undefined)
        ? "not_assessable"
        : shift < policy.significanceFactor * sigma
          ? "within_coordinate_error"
          : "exceeds_coordinate_error";
    residues.push({
      accession: pair.accession,
      uniprotPosition: pair.uniprotPosition,
      referenceChainId: pair.referenceChainId,
      referenceResidueId: refResidue.id,
      comparisonResidueId: cmpResidue.id,
      ...(ca !== undefined ? { caDisplacementAngstrom: ca } : {}),
      ...(side.rmsd !== undefined ? { sideChainRmsdAngstrom: side.rmsd } : {}),
      matchedSideChainAtoms: side.matched,
      chi,
      significance,
      rotamerChange: chi.some((c) => c.delta > policy.rotamerChangeDegrees),
    });
  }
  residues.sort(
    (a, b) =>
      Math.max(b.caDisplacementAngstrom ?? 0, b.sideChainRmsdAngstrom ?? 0) -
        Math.max(a.caDisplacementAngstrom ?? 0, a.sideChainRmsdAngstrom ?? 0) ||
      a.uniprotPosition - b.uniprotPosition,
  );
  // Waters: the site in the reference frame is the reference ligand and site residues,
  // plus the superposed comparison ligand and site residues.
  const siteAtoms = [
    ...heavyAtoms(reference, [...referenceLigandIds, ...refSite]),
    ...heavyAtoms(comparison, [...comparisonLigandIds, ...cmpSite]).map((x) =>
      applyTransform(t, x),
    ),
  ];
  const refLigand = heavyAtoms(reference, referenceLigandIds);
  const refWaters = waters(reference).filter(([, x]) =>
    near(x, siteAtoms, policy.waterRadius),
  );
  const cmpWaters = waters(comparison, t).filter(([, x]) =>
    near(x, siteAtoms, policy.waterRadius),
  );
  const closest = (x: Vec, others: [string, Vec][]) => {
    let best: [string, number] | undefined;
    for (const [id, y] of others) {
      const d = distance(x, y);
      if (!best || d < best[1]) best = [id, d];
    }
    return best;
  };
  const describe = (x: Vec, others: [string, Vec][], id: string): SiteWater => {
    const c = closest(x, others);
    return {
      residueId: id,
      status: c && c[1] <= policy.waterMatch ? "conserved" : "not_conserved",
      ...(c ? { distanceAngstrom: c[1], partnerResidueId: c[0] } : {}),
    };
  };
  return {
    version: COMPARISON_VERSION,
    superpositionScope: superposition.scope,
    siteRadiusAngstrom: policy.siteRadius,
    referenceLigandIds: [...referenceLigandIds],
    comparisonLigandIds: [...comparisonLigandIds],
    ...(sigma !== undefined ? { combinedCoordinateErrorAngstrom: sigma } : {}),
    residues,
    unpairedSiteResidues: unpaired,
    referenceWaters: refWaters.map(([id, x]) => describe(x, cmpWaters, id)),
    comparisonWaters: cmpWaters.map(([id, x]) => ({
      ...describe(x, refWaters, id),
      overlapsReferenceLigand: near(x, refLigand, policy.ligandOverlap),
    })),
  };
}
