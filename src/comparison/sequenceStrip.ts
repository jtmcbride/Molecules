import type {
  Correspondence,
  CorrespondenceStatus,
} from "../domain/comparison";
import type { InvestigationCorrespondence } from "../domain/selection";
import type { StructureSnapshot } from "../domain/types";

/** One UniProt position of a paired sequence strip. */
export interface StripColumn {
  uniprotPosition: number;
  /** Correspondence status, or `unmapped` when neither chain maps this position. */
  status: CorrespondenceStatus | "unmapped";
  /** Deposited one-letter code of the observed residue; null when there is none. */
  reference: string | null;
  comparison: string | null;
  selected: boolean;
  /** The paired residues differ (SIFTS records a residue change). */
  differs: boolean;
}

export interface PairedSequenceStrip {
  accession: string;
  referenceChainId: string;
  comparisonChainId: string;
  columns: StripColumn[];
}

const codes = new WeakMap<StructureSnapshot, Map<string, string>>();

/** Deposited one-letter code of each observed polymer residue, from the chain sequences. */
function codeOf(snapshot: StructureSnapshot, residueId: string | undefined) {
  if (!residueId) return null;
  let map = codes.get(snapshot);
  if (!map) {
    map = new Map();
    for (const chain of snapshot.chains)
      for (const position of chain.sequence)
        for (const id of position.residueIds) map.set(id, position.code);
    codes.set(snapshot, map);
  }
  return map.get(residueId) ?? null;
}

/**
 * The UniProt positions around a selected correspondence, for both paired chains: each
 * column holds what each structure deposited there by exact SIFTS mapping. Nothing is
 * aligned or inferred; positions neither chain maps are shown as unmapped.
 */
export function pairedSequenceStrip(
  correspondence: Correspondence,
  selected: InvestigationCorrespondence,
  reference: StructureSnapshot,
  comparison: StructureSnapshot,
  radius = 7,
): PairedSequenceStrip {
  const pairs = new Map(
    correspondence.pairs
      .filter(
        (p) =>
          p.accession === selected.accession &&
          p.referenceChainId === selected.referenceChainId &&
          p.comparisonChainId === selected.comparisonChainId,
      )
      .map((p) => [p.uniprotPosition, p]),
  );
  const columns: StripColumn[] = [];
  for (
    let position = Math.max(1, selected.uniprotPosition - radius);
    position <= selected.uniprotPosition + radius;
    position++
  ) {
    const pair = pairs.get(position);
    columns.push({
      uniprotPosition: position,
      status: pair?.status ?? "unmapped",
      reference: codeOf(reference, pair?.referenceResidueId),
      comparison: codeOf(comparison, pair?.comparisonResidueId),
      selected: position === selected.uniprotPosition,
      differs: !!pair?.residueChange,
    });
  }
  return {
    accession: selected.accession,
    referenceChainId: selected.referenceChainId,
    comparisonChainId: selected.comparisonChainId,
    columns,
  };
}
