import { incompleteResidues } from "../analysis/completeness";
import { cutoffMargin } from "../analysis/uncertainty";
import {
  evaluationOf,
  type AnalysisRun,
  type MolecularInteraction,
} from "../domain/analysis";
import type { ResidueMapping } from "../domain/biology";
import {
  COMPARISON_VERSION,
  FINGERPRINT_MARGIN_ANGSTROM,
  FINGERPRINT_TYPES,
  type FingerprintChange,
  type Correspondence,
  type FingerprintCell,
  type FingerprintColumn,
  type FingerprintMatrix,
  type FingerprintRow,
  type FingerprintType,
} from "../domain/comparison";
import type { StructureSnapshot } from "../domain/types";

export interface FingerprintReference {
  label: string;
  snapshot: StructureSnapshot;
  run: AnalysisRun;
  mappings: ResidueMapping[];
}
export interface FingerprintMember {
  id: string;
  label: string;
  snapshot: StructureSnapshot;
  run: AnalysisRun | null;
  correspondence: Correspondence | null;
}

const TYPES = new Set<string>(FINGERPRINT_TYPES);
const isFingerprinted = (
  i: MolecularInteraction,
): i is MolecularInteraction & { type: FingerprintType } => TYPES.has(i.type);

/** Engine, ruleset and parameter differences that make two runs incomparable. */
export function comparability(reference: AnalysisRun, run: AnalysisRun) {
  const differences: string[] = [];
  if (run.engineVersion !== reference.engineVersion)
    differences.push(
      `engine ${run.engineVersion} vs ${reference.engineVersion}`,
    );
  if (run.ruleSetVersion !== reference.ruleSetVersion)
    differences.push(
      `ruleset ${run.ruleSetVersion} vs ${reference.ruleSetVersion}`,
    );
  const a = reference.request.parameters as unknown as Record<string, unknown>,
    b = run.request.parameters as unknown as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
  if (changed.length) differences.push(`parameters ${changed.join(", ")}`);
  return differences;
}

function ligandLabel(snapshot: StructureSnapshot, run: AnalysisRun) {
  const ids = run.request.ligandResidueIds?.length
    ? run.request.ligandResidueIds
    : [run.request.ligandResidueId];
  const residues = ids.map((id) => snapshot.residues.find((r) => r.id === id));
  const first = residues[0],
    chain = snapshot.chains.find((c) => c.id === first?.chainId);
  return `${residues.map((r) => r?.componentId ?? "?").join("–")} ${chain?.authAsymId ?? "?"}:${first?.authSeqId ?? "?"}`;
}

/** Per-column measurement context: which residues were receptor and complete. */
class ColumnContext {
  readonly receptorChains: Set<string>;
  readonly components: Set<string>;
  readonly incomplete: Map<string, string[]>;
  readonly present = new Set<string>();
  private readonly residues: Map<string, StructureSnapshot["residues"][number]>;
  constructor(
    readonly snapshot: StructureSnapshot,
    readonly run: AnalysisRun,
  ) {
    this.receptorChains = new Set(run.request.receptorChainIds);
    this.residues = new Map(snapshot.residues.map((r) => [r.id, r]));
    this.components = new Set(
      (run.request.receptorComponentResidueIds ?? []).map(
        (id) => this.residues.get(id)?.componentId ?? "",
      ),
    );
    // The engine's completeness check, on the preferred conformer above the occupancy floor.
    const preferred = Array.from(
      snapshot.atomBuffer.preferredAtomIndices,
    ).filter((i) => {
      const occupancy = snapshot.atomBuffer.occupancies[i];
      return (
        occupancy > 0 && occupancy >= run.request.parameters.minimumOccupancy
      );
    });
    this.incomplete = incompleteResidues(snapshot, preferred);
    for (const i of run.interactions)
      if (isFingerprinted(i))
        this.present.add(JSON.stringify([i.receptor.residueId, i.type]));
  }
  residue(id: string) {
    return this.residues.get(id);
  }
  /** Smallest distance of a present interaction inside its cutoff (Å). */
  presentMargin(residueId: string, type: FingerprintType) {
    const margins = this.run.interactions
      .filter((i) => i.type === type && i.receptor.residueId === residueId)
      .map((i) => cutoffMargin(i, this.run.request.parameters))
      .filter((m): m is number => m !== undefined);
    return margins.length ? Math.max(...margins) : undefined;
  }
  /**
   * How far beyond the cutoff the closest candidate atoms of an absent interaction lie (Å):
   * carbon pairs for hydrophobic contacts, N/O pairs for hydrogen bonds and salt bridges.
   * Other types are not estimated.
   */
  absentExcess(residueId: string, type: FingerprintType) {
    const p = this.run.request.parameters;
    const rule =
      type === "hydrophobic_contact"
        ? { cutoff: p.hydrophobicCutoff, elements: ["C"] }
        : type === "hydrogen_bond"
          ? { cutoff: p.hydrogenBondCutoff, elements: ["N", "O"] }
          : type === "salt_bridge"
            ? { cutoff: p.saltBridgeCutoff, elements: ["N", "O"] }
            : null;
    const residue = this.residues.get(residueId);
    if (!rule || !residue) return undefined;
    const ligandIds = new Set(
      this.run.request.ligandResidueIds?.length
        ? this.run.request.ligandResidueIds
        : [this.run.request.ligandResidueId],
    );
    const { atoms, atomBuffer } = this.snapshot;
    const preferred = new Set(atomBuffer.preferredAtomIndices);
    const pick = (indices: number[]) =>
      indices.filter(
        (i) => preferred.has(i) && rule.elements.includes(atoms[i].element),
      );
    const ligand = pick(
      [...ligandIds].flatMap((id) => this.residues.get(id)?.atomIndices ?? []),
    );
    const receptor = pick(residue.atomIndices);
    const x = atomBuffer.positions;
    let best = Infinity;
    for (const i of receptor)
      for (const j of ligand)
        best = Math.min(
          best,
          Math.hypot(
            x[i * 3] - x[j * 3],
            x[i * 3 + 1] - x[j * 3 + 1],
            x[i * 3 + 2] - x[j * 3 + 2],
          ),
        );
    return Number.isFinite(best) ? best - rule.cutoff : undefined;
  }
  /** Measurement state of `type` at one observed polymer residue. */
  polymerCell(residueId: string, type: FingerprintType): FingerprintCell {
    const residue = this.residues.get(residueId);
    if (!residue || !this.receptorChains.has(residue.chainId))
      return "not_evaluated";
    const status = evaluationOf(this.run, type).status;
    if (status === "not_evaluated") return "not_evaluated";
    if (
      status === "partially_evaluated" &&
      type !== "metal_coordination" &&
      this.incomplete.has(residueId)
    )
      return "not_evaluated";
    return this.present.has(JSON.stringify([residueId, type]))
      ? "present"
      : "absent";
  }
  componentCell(componentId: string, type: FingerprintType): FingerprintCell {
    if (!this.components.has(componentId)) return "not_evaluated";
    if (evaluationOf(this.run, type).status === "not_evaluated")
      return "not_evaluated";
    return this.run.interactions.some(
      (i) =>
        i.type === type &&
        this.residues.get(i.receptor.residueId)?.componentId === componentId,
    )
      ? "present"
      : "absent";
  }
}

const polymerKey = (
  chainId: string,
  accession: string,
  position: number,
  type: string,
) => JSON.stringify(["polymer", chainId, accession, position, type]);
const positionKey = (chainId: string, accession: string, position: number) =>
  JSON.stringify([chainId, accession, position]);

/**
 * Interaction fingerprints of the reference and comparison structures, keyed by reference
 * chain, UniProt position and interaction type. A comparison column is refused unless its
 * analysis has the reference's engine, ruleset and parameters. Cells that are not measured
 * (not evaluated, not observed, not comparable) are reported as such and excluded from the
 * similarity.
 */
export function buildFingerprint(
  reference: FingerprintReference,
  members: FingerprintMember[],
): FingerprintMatrix {
  const refContext = new ColumnContext(reference.snapshot, reference.run);
  // Reference residue → its exactly mapped UniProt position (and back).
  const refPlace = new Map<string, string>(),
    refResidueAt = new Map<string, string>();
  for (const m of reference.mappings)
    if (m.status === "exact" && m.residueId) {
      const key = positionKey(
        m.chainInstanceId,
        m.accession,
        m.uniprotPosition,
      );
      refPlace.set(m.residueId, key);
      refResidueAt.set(key, m.residueId);
    }
  const rows = new Map<string, Omit<FingerprintRow, "cells">>();
  const addPolymerRow = (place: string, type: FingerprintType) => {
    const [chainId, accession, position] = JSON.parse(place) as [
      string,
      string,
      number,
    ];
    const key = polymerKey(chainId, accession, position, type);
    if (!rows.has(key))
      rows.set(key, {
        key,
        kind: "polymer",
        type,
        referenceChainId: chainId,
        accession,
        uniprotPosition: position,
      });
  };
  const addComponentRow = (componentId: string, type: FingerprintType) => {
    const key = JSON.stringify(["component", componentId, type]);
    if (!rows.has(key))
      rows.set(key, { key, kind: "component", type, componentId });
  };
  // Collect rows from every comparable column's interactions.
  const columns: FingerprintColumn[] = [];
  const contexts: (ColumnContext | null)[] = [];
  const places: Map<string, string>[] = [];
  const memberPairs: (Correspondence["pairs"] | null)[] = [];
  const collect = (
    context: ColumnContext,
    place: Map<string, string>,
  ): number => {
    let unplaced = 0;
    for (const i of context.run.interactions) {
      if (!isFingerprinted(i)) continue;
      const residue = context.residue(i.receptor.residueId);
      if (residue?.kind !== "polymer") {
        if (residue) addComponentRow(residue.componentId, i.type);
        continue;
      }
      const p = place.get(residue.id);
      if (p) addPolymerRow(p, i.type);
      else unplaced++;
    }
    return unplaced;
  };
  columns.push({
    id: "reference",
    label: reference.label,
    analysisCacheKey: reference.run.cacheKey,
    ligandLabel: ligandLabel(reference.snapshot, reference.run),
    unplacedInteractions: collect(refContext, refPlace),
  });
  contexts.push(refContext);
  places.push(refPlace);
  memberPairs.push(null);
  for (const member of members) {
    const base = { id: member.id, label: member.label };
    if (!member.run) {
      columns.push({
        ...base,
        refusal: "Not analyzed",
        unplacedInteractions: 0,
      });
      contexts.push(null);
      places.push(new Map());
      memberPairs.push(null);
      continue;
    }
    const differences = comparability(reference.run, member.run);
    const refusal = !member.correspondence
      ? "No residue correspondence with the reference"
      : differences.length
        ? `Different ${differences.join("; ")}`
        : undefined;
    const ligand = ligandLabel(member.snapshot, member.run);
    if (refusal) {
      columns.push({
        ...base,
        analysisCacheKey: member.run.cacheKey,
        ligandLabel: ligand,
        refusal,
        unplacedInteractions: 0,
      });
      contexts.push(null);
      places.push(new Map());
      memberPairs.push(null);
      continue;
    }
    const context = new ColumnContext(member.snapshot, member.run);
    // Comparison residue → reference chain, accession and position, through the pairing.
    const place = new Map<string, string>();
    for (const pair of member.correspondence!.pairs)
      if (pair.comparisonResidueId && pair.status !== "not_comparable")
        place.set(
          pair.comparisonResidueId,
          positionKey(
            pair.referenceChainId,
            pair.accession,
            pair.uniprotPosition,
          ),
        );
    columns.push({
      ...base,
      analysisCacheKey: member.run.cacheKey,
      ligandLabel: ligand,
      unplacedInteractions: collect(context, place),
    });
    contexts.push(context);
    places.push(place);
    memberPairs.push(member.correspondence!.pairs);
  }
  // Fill cells.
  const pairIndex = memberPairs.map(
    (pairs) =>
      new Map(
        (pairs ?? []).map((p) => [
          positionKey(p.referenceChainId, p.accession, p.uniprotPosition),
          p,
        ]),
      ),
  );
  const chainOrder = new Map(
    reference.snapshot.chains.map((c, i) => [c.id, i]),
  );
  const typeOrder = new Map(FINGERPRINT_TYPES.map((t, i) => [t as string, i]));
  const sorted = [...rows.values()].sort((a, b) =>
    a.kind !== b.kind
      ? a.kind === "polymer"
        ? -1
        : 1
      : a.kind === "polymer"
        ? (chainOrder.get(a.referenceChainId!) ?? 0) -
            (chainOrder.get(b.referenceChainId!) ?? 0) ||
          a.accession!.localeCompare(b.accession!) ||
          a.uniprotPosition! - b.uniprotPosition! ||
          typeOrder.get(a.type)! - typeOrder.get(b.type)!
        : a.componentId!.localeCompare(b.componentId!) ||
          typeOrder.get(a.type)! - typeOrder.get(b.type)!,
  );
  const result: FingerprintRow[] = sorted.map((row) => ({
    ...row,
    cells: columns.map((_, c): FingerprintCell => {
      const context = contexts[c];
      if (!context) return "not_evaluated";
      if (row.kind === "component")
        return context.componentCell(row.componentId!, row.type);
      const place = positionKey(
        row.referenceChainId!,
        row.accession!,
        row.uniprotPosition!,
      );
      if (c === 0) {
        const residueId = refResidueAt.get(place);
        return residueId
          ? context.polymerCell(residueId, row.type)
          : "not_observed";
      }
      const pair = pairIndex[c].get(place);
      if (!pair) return "not_observed";
      if (pair.status === "not_comparable") return "not_comparable";
      if (!pair.comparisonResidueId) return "not_observed";
      return context.polymerCell(pair.comparisonResidueId, row.type);
    }),
  }));
  // Distance margins of every gained or lost cell.
  const residueFor = (row: FingerprintRow, c: number) => {
    const place = positionKey(
      row.referenceChainId!,
      row.accession!,
      row.uniprotPosition!,
    );
    return c === 0
      ? refResidueAt.get(place)
      : pairIndex[c].get(place)?.comparisonResidueId;
  };
  for (const row of result) {
    if (row.kind !== "polymer") continue;
    const changes: FingerprintChange[] = [];
    row.cells.forEach((cell, c) => {
      const ref = row.cells[0];
      if (c === 0 || cell === ref) return;
      if (![cell, ref].every((x) => x === "present" || x === "absent")) return;
      const [presentColumn, absentColumn] =
        cell === "present" ? [c, 0] : [0, c];
      const presentResidue = residueFor(row, presentColumn),
        absentResidue = residueFor(row, absentColumn);
      const present = presentResidue
        ? contexts[presentColumn]!.presentMargin(presentResidue, row.type)
        : undefined;
      const absent = absentResidue
        ? contexts[absentColumn]!.absentExcess(absentResidue, row.type)
        : undefined;
      changes.push({
        column: c,
        ...(present !== undefined ? { presentMarginAngstrom: present } : {}),
        ...(absent !== undefined ? { absentExcessAngstrom: absent } : {}),
        marginal:
          (present !== undefined && present < FINGERPRINT_MARGIN_ANGSTROM) ||
          (absent !== undefined && absent < FINGERPRINT_MARGIN_ANGSTROM),
      });
    });
    if (changes.length) row.changes = changes;
  }
  // Similarity of each comparable column with the reference.
  columns.forEach((column, c) => {
    if (c === 0 || !contexts[c]) return;
    let shared = 0,
      gained = 0,
      lost = 0,
      compared = 0;
    const measured = (x: FingerprintCell) => x === "present" || x === "absent";
    for (const row of result) {
      if (row.kind !== "polymer") continue;
      const a = row.cells[0],
        b = row.cells[c];
      if (!measured(a) || !measured(b)) continue;
      compared++;
      if (a === "present" && b === "present") shared++;
      else if (b === "present") gained++;
      else if (a === "present") lost++;
    }
    const union = shared + gained + lost;
    column.similarity = {
      tanimoto: union ? shared / union : null,
      shared,
      gained,
      lost,
      compared,
      excluded: result.filter((r) => r.kind === "polymer").length - compared,
    };
  });
  return { version: COMPARISON_VERSION, columns, rows: result };
}
