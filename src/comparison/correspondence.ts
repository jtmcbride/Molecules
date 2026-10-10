import type { InterpretationSnapshot, ResidueMapping } from "../domain/biology";
import {
  COMPARISON_VERSION,
  type ChainPairing,
  type ChainPairingOverride,
  type Correspondence,
  type CorrespondenceStatus,
  type ResiduePair,
} from "../domain/comparison";
import type { StructureSnapshot } from "../domain/types";

export interface ComparisonSide {
  snapshot: StructureSnapshot;
  interpretation: Pick<InterpretationSnapshot, "mappings" | "coverage">;
}
type Side = ComparisonSide;

/** Polymer chain instances carrying `accession`, in snapshot order. */
function chainsFor(side: Side, accession: string) {
  return side.snapshot.chains.filter(
    (c) =>
      c.type === "polymer" &&
      side.interpretation.coverage.some(
        (cov) =>
          cov.chainInstanceId === c.id && cov.accessions.includes(accession),
      ),
  );
}

/**
 * Pairs chain instances per shared UniProt accession. User overrides come first, then the
 * same author chain ID and assembly operator, then order of appearance. Homo-oligomers are
 * thereby paired chain by chain, never by accession alone.
 */
export function pairChains(
  reference: Side,
  comparison: Side,
  overrides: ChainPairingOverride[] = [],
): { pairings: ChainPairing[]; sharedAccessions: string[] } {
  const accessionsOf = (side: Side) =>
    new Set(side.interpretation.coverage.flatMap((c) => c.accessions));
  const comparisonAccessions = accessionsOf(comparison);
  const sharedAccessions = [...accessionsOf(reference)]
    .filter((a) => comparisonAccessions.has(a))
    .sort();
  const pairings: ChainPairing[] = [];
  for (const accession of sharedAccessions) {
    const refChains = chainsFor(reference, accession),
      cmpChains = chainsFor(comparison, accession);
    const usedRef = new Set<string>(),
      usedCmp = new Set<string>();
    const add = (
      referenceChainId: string,
      comparisonChainId: string,
      basis: ChainPairing["basis"],
    ) => {
      pairings.push({ accession, referenceChainId, comparisonChainId, basis });
      usedRef.add(referenceChainId);
      usedCmp.add(comparisonChainId);
    };
    for (const o of overrides) {
      if (o.accession !== accession) continue;
      if (!refChains.some((c) => c.id === o.referenceChainId)) continue;
      usedRef.add(o.referenceChainId);
      if (
        o.comparisonChainId &&
        cmpChains.some((c) => c.id === o.comparisonChainId) &&
        !usedCmp.has(o.comparisonChainId)
      )
        add(o.referenceChainId, o.comparisonChainId, "user");
    }
    for (const r of refChains) {
      if (usedRef.has(r.id)) continue;
      const same = cmpChains.find(
        (c) =>
          !usedCmp.has(c.id) &&
          c.authAsymId === r.authAsymId &&
          c.operatorId === r.operatorId,
      );
      if (same) add(r.id, same.id, "same_author_chain");
    }
    for (const r of refChains) {
      if (usedRef.has(r.id)) continue;
      const next = cmpChains.find((c) => !usedCmp.has(c.id));
      if (next) add(r.id, next.id, "chain_order");
    }
  }
  return { pairings, sharedAccessions };
}

/** Mappings of one chain instance and accession, grouped by UniProt position. */
function byPosition(
  interpretation: Side["interpretation"],
  chainId: string,
  accession: string,
) {
  const positions = new Map<number, ResidueMapping[]>();
  for (const m of interpretation.mappings)
    if (m.chainInstanceId === chainId && m.accession === accession)
      positions.set(m.uniprotPosition, [
        ...(positions.get(m.uniprotPosition) ?? []),
        m,
      ]);
  return positions;
}

type Usable =
  | { kind: "observed"; mapping: ResidueMapping }
  | { kind: "unobserved" }
  | { kind: "not_comparable"; reason: string };

/** Whether one side's mappings at a position give a single exactly mapped residue. */
function usable(mappings: ResidueMapping[] | undefined): Usable {
  if (!mappings?.length) return { kind: "unobserved" };
  if (mappings.length > 1)
    return {
      kind: "not_comparable",
      reason: "several residues or positions correspond",
    };
  const m = mappings[0];
  if (m.status !== "exact")
    return { kind: "not_comparable", reason: m.status.replaceAll("_", " ") };
  return m.residueId
    ? { kind: "observed", mapping: m }
    : { kind: "unobserved" };
}

/** One-letter deposited residue at an exactly mapped position. */
function deposited(m: ResidueMapping) {
  return m.residueChange?.deposited;
}

/**
 * Residue correspondence between a reference and a comparison structure. Residues pair
 * only when both are observed and exactly mapped by SIFTS to the same UniProt position in
 * paired chains. Positions observed in neither structure are omitted.
 */
export function correspondence(
  reference: Side,
  comparison: Side,
  overrides: ChainPairingOverride[] = [],
): Correspondence {
  const { pairings, sharedAccessions } = pairChains(
    reference,
    comparison,
    overrides,
  );
  const pairs: ResiduePair[] = [];
  for (const p of pairings) {
    const ref = byPosition(
        reference.interpretation,
        p.referenceChainId,
        p.accession,
      ),
      cmp = byPosition(
        comparison.interpretation,
        p.comparisonChainId,
        p.accession,
      );
    const positions = [...new Set([...ref.keys(), ...cmp.keys()])].sort(
      (a, b) => a - b,
    );
    for (const position of positions) {
      const a = usable(ref.get(position)),
        b = usable(cmp.get(position));
      if (a.kind === "unobserved" && b.kind === "unobserved") continue;
      const base = {
        accession: p.accession,
        uniprotPosition: position,
        referenceChainId: p.referenceChainId,
        comparisonChainId: p.comparisonChainId,
        ...(a.kind === "observed"
          ? { referenceResidueId: a.mapping.residueId }
          : {}),
        ...(b.kind === "observed"
          ? { comparisonResidueId: b.mapping.residueId }
          : {}),
      };
      let status: CorrespondenceStatus;
      let reason: string | undefined;
      if (a.kind === "not_comparable" || b.kind === "not_comparable") {
        status = "not_comparable";
        reason = [
          a.kind === "not_comparable" ? `reference: ${a.reason}` : null,
          b.kind === "not_comparable" ? `comparison: ${b.reason}` : null,
        ]
          .filter(Boolean)
          .join("; ");
      } else if (a.kind === "observed" && b.kind === "observed")
        status = "paired";
      else
        status = a.kind === "observed" ? "reference_only" : "comparison_only";
      const pair: ResiduePair = { ...base, status };
      if (reason) pair.reason = reason;
      if (a.kind === "observed" && b.kind === "observed") {
        const ra = deposited(a.mapping),
          rb = deposited(b.mapping);
        // Each structure records a difference from UniProt only where it has one.
        const uniprot =
          a.mapping.residueChange?.uniprot ?? b.mapping.residueChange?.uniprot;
        if ((ra ?? uniprot) !== (rb ?? uniprot))
          pair.residueChange = {
            reference: ra ?? uniprot ?? "?",
            comparison: rb ?? uniprot ?? "?",
          };
      }
      pairs.push(pair);
    }
  }
  const pairedRef = new Set(pairings.map((p) => p.referenceChainId)),
    pairedCmp = new Set(pairings.map((p) => p.comparisonChainId));
  const unpaired = (side: Side, used: Set<string>) =>
    side.snapshot.chains
      .filter((c) => c.type === "polymer" && !used.has(c.id))
      .map((c) => ({
        chainId: c.id,
        accessions:
          side.interpretation.coverage.find(
            (cov) => cov.chainInstanceId === c.id,
          )?.accessions ?? [],
      }));
  const counts: Record<CorrespondenceStatus, number> = {
    paired: 0,
    reference_only: 0,
    comparison_only: 0,
    not_comparable: 0,
  };
  for (const p of pairs) counts[p.status]++;
  return {
    version: COMPARISON_VERSION,
    referenceSnapshotId: reference.snapshot.id,
    comparisonSnapshotId: comparison.snapshot.id,
    sharedAccessions,
    pairings,
    unpairedReferenceChains: unpaired(reference, pairedRef),
    unpairedComparisonChains: unpaired(comparison, pairedCmp),
    pairs,
    counts,
  };
}
