import type {
  AnalysisRequest,
  AnalysisRun,
  MolecularInteraction,
  RejectionReason,
} from "../domain/analysis";
import type { StructureSnapshot } from "../domain/types";
import { summarizeInteractions } from "./policy";

/** Above this many alternate-conformer labels the preferred conformer per residue is used. */
export const MAX_CONFORMER_LABELS = 4;

/** Alternate-conformer labels present in the target ligand, the receptor chains or (when used) waters. */
export function conformerLabels(
  snapshot: StructureSnapshot,
  request: AnalysisRequest,
): string[] {
  const chains = new Set(request.receptorChainIds);
  const labels = new Set<string>();
  for (const residue of snapshot.residues) {
    const relevant =
      residue.id === request.ligandResidueId ||
      (residue.kind === "polymer" && chains.has(residue.chainId)) ||
      (residue.kind === "water" && request.parameters.includeWaters);
    if (!relevant) continue;
    for (const i of residue.atomIndices) {
      const altId = snapshot.atoms[i].altId;
      if (altId !== null) labels.add(altId);
    }
  }
  return [...labels].sort();
}

/**
 * Atoms of conformer `label`: shared atoms plus the label's alternate atoms. A residue with
 * alternate conformers but not this label contributes its preferred conformer; that pairing
 * is an assumed combination, since altloc labels are not guaranteed to be consistent across
 * residues.
 */
export function conformerSelection(snapshot: StructureSnapshot, label: string) {
  const preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const atoms = new Set<number>(),
    assumed = new Set<string>();
  for (const residue of snapshot.residues) {
    const alts = new Set(
      residue.atomIndices
        .map((i) => snapshot.atoms[i].altId)
        .filter((a): a is string => a !== null),
    );
    if (!alts.size) residue.atomIndices.forEach((i) => atoms.add(i));
    else if (alts.has(label)) {
      for (const i of residue.atomIndices) {
        const altId = snapshot.atoms[i].altId;
        if (altId === null || altId === label) atoms.add(i);
      }
    } else {
      residue.atomIndices
        .filter((i) => preferred.has(i))
        .forEach((i) => atoms.add(i));
      assumed.add(residue.id);
    }
  }
  return { atoms, assumed };
}

/** Interactions are the same across conformers when type, residues and atom names agree. */
function nameKey(snapshot: StructureSnapshot, i: MolecularInteraction) {
  const names = (atoms: number[]) =>
    atoms.map((a) => snapshot.atoms[a].name).sort();
  return JSON.stringify([
    i.type,
    i.ligand.residueId,
    names(i.ligand.atomIndices),
    i.receptor.residueId,
    names(i.receptor.atomIndices),
    i.mediator?.residueId ?? null,
    i.mediator ? names(i.mediator.atomIndices) : null,
  ]);
}

/** Occupancy of the interaction's atoms that belong to conformer `label` (undefined if none do). */
function labelOccupancy(
  snapshot: StructureSnapshot,
  i: MolecularInteraction,
  label: string,
) {
  const atoms = [
    ...i.ligand.atomIndices,
    ...i.receptor.atomIndices,
    ...(i.mediator?.atomIndices ?? []),
  ].filter((a) => snapshot.atoms[a].altId === label);
  return atoms.length
    ? Math.min(...atoms.map((a) => snapshot.atomBuffer.occupancies[a]))
    : undefined;
}

/**
 * Merges per-conformer runs. Each interaction keeps the representative from the first label
 * containing it, plus every label it appears in and that label's occupancy; presence is
 * "all" when found in every conformer.
 */
export function mergeEnsemble(
  runs: { label: string; run: AnalysisRun; assumed: Set<string> }[],
  snapshot: StructureSnapshot,
): AnalysisRun {
  const base = runs[0].run;
  const merged = new Map<string, MolecularInteraction>();
  for (const { label, run } of runs)
    for (const interaction of run.interactions) {
      const key = nameKey(snapshot, interaction);
      const existing = merged.get(key) ?? {
        ...interaction,
        conformers: [] as NonNullable<MolecularInteraction["conformers"]>,
      };
      const occupancy = labelOccupancy(snapshot, interaction, label);
      existing.conformers!.push(
        occupancy === undefined
          ? { altId: label }
          : { altId: label, occupancy },
      );
      merged.set(key, existing);
    }
  const interactions = [...merged.values()].map((i) => ({
    ...i,
    conformerPresence: (i.conformers!.length === runs.length
      ? "all"
      : "partial") as "all" | "partial",
  }));
  interactions.sort(
    (a, b) =>
      a.distanceAngstrom - b.distanceAngstrom || a.id.localeCompare(b.id),
  );
  const bonds = new Map<string, AnalysisRun["bonds"][number]>();
  for (const { run } of runs)
    for (const b of run.bonds) bonds.set(`${b.atomA}:${b.atomB}`, b);
  const attachments = new Map<
    string,
    NonNullable<AnalysisRun["covalentAttachments"]>[number]
  >();
  for (const { run } of runs)
    for (const a of run.covalentAttachments ?? [])
      attachments.set(`${a.ligandAtom}:${a.receptorAtom}`, a);
  const rejections: Partial<Record<RejectionReason, number>> = {};
  for (const { run } of runs)
    for (const [reason, count] of Object.entries(run.stats.rejections ?? {}))
      rejections[reason as RejectionReason] =
        (rejections[reason as RejectionReason] ?? 0) + count;
  const contacted = new Set(
    interactions.flatMap((i) => [
      i.ligand.residueId,
      i.receptor.residueId,
      i.mediator?.residueId ?? "",
    ]),
  );
  const assumed = [...new Set(runs.flatMap((r) => [...r.assumed]))].filter(
    (id) => contacted.has(id),
  );
  const residues = new Map(snapshot.residues.map((r) => [r.id, r]));
  const flags = [...new Set(runs.flatMap((r) => r.run.qualityFlags))];
  flags.push(
    `Per-conformer ensemble over alternate-conformer labels ${runs.map((r) => r.label).join(", ")}. ${interactions.filter((i) => i.conformerPresence === "partial").length} interactions occur in only some conformers.`,
  );
  if (assumed.length)
    flags.push(
      `Assumed conformer combinations: ${assumed
        .map((id) => {
          const r = residues.get(id)!;
          return `${r.componentId} ${r.authSeqId ?? "?"}`;
        })
        .join(
          ", ",
        )} lack some labels and contribute their preferred conformer to those runs.`,
    );
  const summary = summarizeInteractions(interactions);
  return {
    ...base,
    qualityFlags: flags,
    bindingSite: {
      ...base.bindingSite,
      residueIds: summary.residues.map((r) => r.residueId),
    },
    stats: {
      ...base.stats,
      elapsedMilliseconds: runs.reduce(
        (t, r) => t + r.run.stats.elapsedMilliseconds,
        0,
      ),
      rejections,
      conformerLabels: runs.map((r) => r.label),
    },
    covalentAttachments: [...attachments.values()],
    interactions,
    ...summary,
    bonds: [...bonds.values()].sort(
      (a, b) => a.atomA - b.atomA || a.atomB - b.atomB,
    ),
  };
}
