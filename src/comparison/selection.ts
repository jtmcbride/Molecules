import type { AnalysisRun, MolecularInteraction } from "../domain/analysis";
import type { InterpretationSnapshot } from "../domain/biology";
import type {
  FingerprintRow,
  FingerprintType,
  ResiduePair,
} from "../domain/comparison";
import type {
  InvestigationCorrespondence,
  InvestigationInteractions,
  InvestigationRequest,
  InvestigationResult,
  InvestigationSide,
  InvestigationView,
  StructureRef,
} from "../domain/selection";
import type { StructureSnapshot } from "../domain/types";
import type { ComparisonSlot } from "../state/comparison";
import { slotCorrespondence, slotSiteDifferences } from "./derived";
import { buildFingerprint } from "./fingerprint";

/** The workspace inputs an investigation is resolved from. */
export interface InvestigationWorkspace {
  reference: {
    snapshot: StructureSnapshot | null;
    interpretation: InterpretationSnapshot | null;
    analysis: AnalysisRun | null;
    targetLigandId: string | null;
    ligandGroupId: string | null;
  };
  slots: readonly ComparisonSlot[];
}

const UNLOADED = "The selected structure is no longer loaded.";

function slotOf(request: InvestigationRequest) {
  if (request.kind === "reference_residues") return null;
  return request.kind === "residue"
    ? request.target.structure.kind === "comparison"
      ? request.target.structure.slotId
      : null
    : request.slotId;
}

/**
 * Identities of every input `request` resolves from. A changed revision means a resolved
 * view is stale: structures, mappings, pairings, fit, ligands or analyses changed.
 */
export function investigationRevision(
  request: InvestigationRequest,
  workspace: InvestigationWorkspace,
) {
  const r = workspace.reference;
  const slotId = slotOf(request);
  const slot = slotId
    ? workspace.slots.find((s) => s.id === slotId)
    : undefined;
  return JSON.stringify([
    r.snapshot?.id ?? null,
    r.interpretation?.id ?? null,
    r.analysis?.cacheKey ?? null,
    r.targetLigandId,
    r.ligandGroupId,
    slotId,
    slot
      ? [
          slot.phase,
          slot.snapshot?.id ?? null,
          slot.interpretation?.id ?? null,
          slot.analysis?.cacheKey ?? null,
          slot.pairingOverrides,
          slot.superposition?.transform ?? null,
          slot.targetLigandId,
          slot.ligandGroupId,
        ]
      : null,
  ]);
}

const byDistance = (a: MolecularInteraction, b: MolecularInteraction) =>
  a.distanceAngstrom - b.distanceAngstrom ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Interactions of `run` selected by `keep`, nearest first; a typed reason without a run. */
function interactionsOf(
  snapshot: StructureSnapshot,
  run: AnalysisRun | null,
  keep: (i: MolecularInteraction) => boolean,
): InvestigationInteractions {
  if (!run) return { status: "not_available", reason: "Not analyzed." };
  if (run.snapshotId !== snapshot.id)
    return {
      status: "not_available",
      reason: "The analysis belongs to different coordinates.",
    };
  return {
    status: "evaluated",
    analysisCacheKey: run.cacheKey,
    ids: run.interactions
      .filter(keep)
      .sort(byDistance)
      .map((i) => i.id),
  };
}

const involves = (ids: Set<string>) => (i: MolecularInteraction) =>
  ids.has(i.receptor.residueId) ||
  ids.has(i.ligand.residueId) ||
  (!!i.mediator && ids.has(i.mediator.residueId));

function residueSide(
  structure: StructureRef,
  snapshot: StructureSnapshot,
  run: AnalysisRun | null,
  residueId: string | undefined,
  unavailable?: string,
): InvestigationSide {
  if (!residueId)
    return {
      structure,
      residueIds: [],
      unavailable: unavailable ?? "No corresponding residue.",
      interactions: {
        status: "not_available",
        reason: "No residue to measure.",
      },
    };
  return {
    structure,
    residueIds: [residueId],
    interactions: interactionsOf(snapshot, run, involves(new Set([residueId]))),
  };
}

function correspondenceOf(pair: ResiduePair): InvestigationCorrespondence {
  return {
    basis: "sifts_exact",
    accession: pair.accession,
    uniprotPosition: pair.uniprotPosition,
    referenceChainId: pair.referenceChainId,
    comparisonChainId: pair.comparisonChainId,
    status: pair.status,
    ...(pair.reason ? { reason: pair.reason } : {}),
    ...(pair.residueChange ? { residueChange: pair.residueChange } : {}),
  };
}

/** Why one side of a pair has no residue, from the correspondence status. */
function pairGap(pair: ResiduePair, side: "reference" | "comparison") {
  if (pair.status === "not_comparable")
    return `Not comparable: ${pair.reason ?? "ambiguous mapping"}.`;
  return side === "reference"
    ? "This UniProt position has no observed residue in the reference."
    : "This UniProt position has no observed residue in the comparison structure.";
}

/** Why a slot has no correspondence with the reference yet. */
function missingCorrespondence(
  workspace: InvestigationWorkspace,
  slot: ComparisonSlot,
) {
  if (!workspace.reference.interpretation)
    return "Load the reference's protein annotations to pair residues by UniProt position.";
  if (slot.source?.kind === "local")
    return "A local file has no validated protein mapping, so its residues cannot be paired.";
  if (!slot.interpretation)
    return slot.biologyPhase === "loading"
      ? "Residue correspondence is still loading."
      : "This structure's residue correspondence is unavailable.";
  return "No residue correspondence with the reference.";
}

/**
 * Resolves an investigation request against the current workspace into the residues,
 * exact interaction IDs and correspondence on each side. It never touches the viewer or
 * any store; a request whose inputs are gone resolves to `unavailable` with a reason.
 */
export function resolveInvestigation(
  request: InvestigationRequest,
  workspace: InvestigationWorkspace,
): InvestigationResult {
  const revision = investigationRevision(request, workspace);
  const unavailable = (reason: string): InvestigationResult => ({
    status: "unavailable",
    request,
    reason,
    revision,
  });
  const reference = workspace.reference;
  const refSnapshot = reference.snapshot;
  if (!refSnapshot) return unavailable(UNLOADED);
  const refRun =
    reference.analysis?.snapshotId === refSnapshot.id
      ? reference.analysis
      : null;
  const refStructure: StructureRef = {
    kind: "reference",
    snapshotId: refSnapshot.id,
  };
  const resolved = (
    view: Omit<InvestigationView, "request" | "revision">,
  ): InvestigationResult => ({
    status: "resolved",
    view: { request, revision, ...view },
  });

  if (request.kind === "reference_residues") {
    const requested = new Set(request.residueIds);
    const residueIds = refSnapshot.residues
      .filter((r) => requested.has(r.id))
      .map((r) => r.id);
    if (
      request.snapshotId !== refSnapshot.id ||
      !residueIds.length ||
      residueIds.length !== requested.size
    )
      return unavailable(UNLOADED);
    return resolved({
      slotId: null,
      reference: {
        structure: refStructure,
        residueIds,
        interactions: interactionsOf(refSnapshot, refRun, involves(requested)),
      },
      comparison: null,
      correspondence: null,
    });
  }

  if (
    request.kind === "residue" &&
    request.target.structure.kind === "reference"
  ) {
    const { residueId, structure } = request.target;
    if (
      structure.snapshotId !== refSnapshot.id ||
      !refSnapshot.residues.some((r) => r.id === residueId)
    )
      return unavailable(UNLOADED);
    return resolved({
      slotId: null,
      reference: residueSide(refStructure, refSnapshot, refRun, residueId),
      comparison: null,
      correspondence: null,
    });
  }

  const slotId = slotOf(request)!;
  const slot = workspace.slots.find((s) => s.id === slotId);
  if (!slot || slot.phase !== "ready" || !slot.snapshot)
    return unavailable(UNLOADED);
  const cmpSnapshot = slot.snapshot;
  const cmpRun =
    slot.analysis?.snapshotId === cmpSnapshot.id ? slot.analysis : null;
  const cmpStructure: StructureRef = {
    kind: "comparison",
    slotId,
    snapshotId: cmpSnapshot.id,
  };
  const corr = slotCorrespondence(reference, slot);

  if (request.kind === "residue") {
    const { residueId, structure } = request.target;
    const residue =
      structure.snapshotId === cmpSnapshot.id
        ? cmpSnapshot.residues.find((r) => r.id === residueId)
        : undefined;
    if (!residue) return unavailable(UNLOADED);
    const comparison = residueSide(
      cmpStructure,
      cmpSnapshot,
      cmpRun,
      residueId,
    );
    if (!corr) {
      const reason = missingCorrespondence(workspace, slot);
      return resolved({
        slotId,
        reference: residueSide(
          refStructure,
          refSnapshot,
          refRun,
          undefined,
          reason,
        ),
        comparison,
        correspondence: null,
        correspondenceUnavailable: reason,
      });
    }
    // A not-comparable pair carries no residue ID; find it by the residue's own mappings.
    const mapped = new Set(
      slot.interpretation?.mappings
        .filter((m) => m.residueId === residueId)
        .map((m) =>
          JSON.stringify([m.chainInstanceId, m.accession, m.uniprotPosition]),
        ),
    );
    const pairs = corr.pairs.filter(
      (p) =>
        p.comparisonResidueId === residueId ||
        (!p.comparisonResidueId &&
          mapped.has(
            JSON.stringify([
              p.comparisonChainId,
              p.accession,
              p.uniprotPosition,
            ]),
          )),
    );
    if (pairs.length !== 1) {
      const chainPaired = corr.pairings.some(
        (p) => p.comparisonChainId === residue.chainId,
      );
      const reason =
        pairs.length > 1
          ? "Several UniProt positions correspond to this residue."
          : residue.kind !== "polymer"
            ? "Only polymer residues are paired by UniProt position."
            : !chainPaired
              ? "This chain is not paired with a reference chain."
              : "This residue has no exact SIFTS mapping to a UniProt position.";
      return resolved({
        slotId,
        reference: residueSide(
          refStructure,
          refSnapshot,
          refRun,
          undefined,
          reason,
        ),
        comparison,
        correspondence: null,
        correspondenceUnavailable: reason,
      });
    }
    const pair = pairs[0];
    return resolved({
      slotId,
      reference: residueSide(
        refStructure,
        refSnapshot,
        refRun,
        pair.status === "paired" ? pair.referenceResidueId : undefined,
        pairGap(pair, "reference"),
      ),
      comparison,
      correspondence: correspondenceOf(pair),
    });
  }

  if (request.kind === "site_difference") {
    const site = slotSiteDifferences(reference, slot);
    if (!site)
      return unavailable(
        "Binding-site differences need a superposed comparison structure and a ligand.",
      );
    const difference = site.residues.find(
      (r) => r.referenceResidueId === request.referenceResidueId,
    );
    if (!difference)
      return unavailable(
        "This residue is no longer part of the binding-site comparison.",
      );
    const pair = corr?.pairs.find(
      (p) =>
        p.referenceResidueId === difference.referenceResidueId &&
        p.comparisonResidueId === difference.comparisonResidueId,
    );
    return resolved({
      slotId,
      reference: residueSide(
        refStructure,
        refSnapshot,
        refRun,
        difference.referenceResidueId,
      ),
      comparison: residueSide(
        cmpStructure,
        cmpSnapshot,
        cmpRun,
        difference.comparisonResidueId,
      ),
      correspondence: pair ? correspondenceOf(pair) : null,
      siteDifference: difference,
    });
  }

  // Fingerprint row: rebuilt from the exact current runs for this slot only.
  if (!refRun)
    return unavailable("Run the reference analysis to compare interactions.");
  if (!reference.interpretation)
    return unavailable(
      "Load the reference's protein annotations: fingerprints are keyed by UniProt position.",
    );
  const matrix = buildFingerprint(
    {
      label: "reference",
      snapshot: refSnapshot,
      run: refRun,
      mappings: reference.interpretation.mappings,
    },
    [
      {
        id: slotId,
        label: slot.label,
        snapshot: cmpSnapshot,
        run: cmpRun,
        correspondence: corr,
      },
    ],
  );
  const row = matrix.rows.find((r) => r.key === request.rowKey);
  if (!row)
    return unavailable(
      "This fingerprint row is not in the current comparison.",
    );
  const refusal = matrix.columns[1].refusal;
  const change = row.changes?.find((c) => c.column === 1);
  if (row.kind === "component")
    return resolved({
      slotId,
      ...componentSides(
        row,
        refStructure,
        refSnapshot,
        refRun,
        cmpStructure,
        cmpSnapshot,
        cmpRun,
        refusal,
      ),
      correspondence: null,
    });
  const place = (p: { accession: string; uniprotPosition: number }) =>
    p.accession === row.accession && p.uniprotPosition === row.uniprotPosition;
  const refResidueId = reference.interpretation.mappings.find(
    (m) =>
      m.status === "exact" &&
      m.residueId &&
      m.chainInstanceId === row.referenceChainId &&
      place(m),
  )?.residueId;
  const pair = corr?.pairs.find(
    (p) => p.referenceChainId === row.referenceChainId && place(p),
  );
  const ofType = (residueId: string) => (i: MolecularInteraction) =>
    i.type === row.type && i.receptor.residueId === residueId;
  const side = (
    structure: StructureRef,
    snapshot: StructureSnapshot,
    run: AnalysisRun | null,
    residueId: string | undefined,
    gap: string,
    cell: FingerprintRow["cells"][number],
    reason?: string,
  ): InvestigationSide => ({
    structure,
    residueIds: residueId ? [residueId] : [],
    ...(residueId ? {} : { unavailable: gap }),
    interactions:
      reason || !residueId
        ? { status: "not_available", reason: reason ?? gap }
        : interactionsOf(snapshot, run, ofType(residueId)),
    cell,
  });
  const cmpResidueId =
    pair && pair.status !== "not_comparable"
      ? pair.comparisonResidueId
      : undefined;
  return resolved({
    slotId,
    reference: side(
      refStructure,
      refSnapshot,
      refRun,
      refResidueId,
      "This UniProt position has no observed residue in the reference.",
      row.cells[0],
    ),
    comparison: {
      ...side(
        cmpStructure,
        cmpSnapshot,
        cmpRun,
        cmpResidueId,
        pair
          ? pairGap(pair, "comparison")
          : "This UniProt position has no paired residue in the comparison structure.",
        row.cells[1],
        refusal,
      ),
      ...(change ? { change } : {}),
    },
    correspondence: pair ? correspondenceOf(pair) : null,
    ...(corr
      ? {}
      : { correspondenceUnavailable: missingCorrespondence(workspace, slot) }),
  });
}

/**
 * Component rows are keyed by component ID, which can have several deposited instances.
 * Every instance in the run's receptor components is listed; none is singled out.
 */
function componentSides(
  row: FingerprintRow,
  refStructure: StructureRef,
  refSnapshot: StructureSnapshot,
  refRun: AnalysisRun,
  cmpStructure: StructureRef,
  cmpSnapshot: StructureSnapshot,
  cmpRun: AnalysisRun | null,
  refusal: string | undefined,
) {
  const side = (
    structure: StructureRef,
    snapshot: StructureSnapshot,
    run: AnalysisRun | null,
    cell: FingerprintRow["cells"][number],
    refused?: string,
  ): InvestigationSide => {
    const requested = new Set(run?.request.receptorComponentResidueIds ?? []);
    const instances = snapshot.residues
      .filter((r) => requested.has(r.id) && r.componentId === row.componentId)
      .map((r) => r.id);
    const ids = new Set(instances);
    return {
      structure,
      residueIds: instances,
      ...(instances.length
        ? {}
        : {
            unavailable: `${row.componentId} was not a receptor component of this analysis.`,
          }),
      interactions: refused
        ? { status: "not_available", reason: refused }
        : interactionsOf(
            snapshot,
            run,
            (i) =>
              i.type === (row.type as FingerprintType) &&
              ids.has(i.receptor.residueId),
          ),
      cell,
    };
  };
  const reference = side(refStructure, refSnapshot, refRun, row.cells[0]);
  const comparison = side(
    cmpStructure,
    cmpSnapshot,
    cmpRun,
    row.cells[1],
    refusal,
  );
  return {
    reference,
    comparison,
    instanceAmbiguous:
      reference.residueIds.length > 1 || comparison.residueIds.length > 1,
  };
}

/**
 * Re-resolves a previous result when its inputs changed. Returns null when the structure it
 * targets is gone (reference replaced, model/assembly changed, slot removed or reloaded):
 * the investigation must then be cleared rather than moved to another structure.
 */
export function refreshInvestigation(
  previous: InvestigationResult,
  workspace: InvestigationWorkspace,
): InvestigationResult | null {
  const request =
    previous.status === "resolved" ? previous.view.request : previous.request;
  const revision =
    previous.status === "resolved" ? previous.view.revision : previous.revision;
  const refId = workspace.reference.snapshot?.id;
  const structures: StructureRef[] =
    previous.status === "resolved"
      ? [previous.view.reference, previous.view.comparison].flatMap((s) =>
          s ? [s.structure] : [],
        )
      : request.kind === "residue"
        ? [request.target.structure]
        : request.kind === "reference_residues"
          ? [{ kind: "reference", snapshotId: request.snapshotId }]
          : [];
  for (const s of structures) {
    if (s.kind === "reference" && s.snapshotId !== refId) return null;
    if (
      s.kind === "comparison" &&
      workspace.slots.find((x) => x.id === s.slotId)?.snapshot?.id !==
        s.snapshotId
    )
      return null;
  }
  const slotId = slotOf(request);
  if (slotId && !workspace.slots.some((s) => s.id === slotId)) return null;
  if (investigationRevision(request, workspace) === revision) return previous;
  return resolveInvestigation(request, workspace);
}

/** The interaction drawn on each side of a comparison investigation. */
export interface DrawnInteractions {
  reference: string | null;
  comparison: string | null;
}

/**
 * Which listed interaction each side draws: the user's earlier choice while it is still
 * listed, otherwise the nearest chemical interaction, otherwise the nearest of any type
 * (lists are nearest first). A side without a measured interaction draws nothing; a
 * missing bond is never drawn. Reference-only selections draw nothing here: the analysis
 * panel owns its own interaction drawing. `chemical` tells which IDs are chemical
 * interactions (not proximity or clashes); without it the nearest is drawn.
 */
export function drawnInteractions(
  result: InvestigationResult | null,
  previous?: DrawnInteractions | null,
  chemical?: (id: string) => boolean,
): DrawnInteractions {
  const none = { reference: null, comparison: null };
  if (result?.status !== "resolved" || !result.view.slotId) return none;
  const pick = (
    side: InvestigationSide | null,
    chosen: string | null | undefined,
  ) => {
    if (side?.interactions.status !== "evaluated") return null;
    const ids = side.interactions.ids;
    if (chosen && ids.includes(chosen)) return chosen;
    return (chemical && ids.find(chemical)) ?? ids[0] ?? null;
  };
  return {
    reference: pick(result.view.reference, previous?.reference),
    comparison: pick(result.view.comparison, previous?.comparison),
  };
}
