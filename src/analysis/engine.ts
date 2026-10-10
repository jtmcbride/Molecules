import type { Structure } from "molstar/lib/mol-model/structure";
import { RuntimeContext } from "molstar/lib/mol-task";
import { AssetManager } from "molstar/lib/mol-util/assets";
import { computeInteractions } from "molstar/lib/mol-model-props/computed/interactions/interactions";
import { InteractionType as MolType } from "molstar/lib/mol-model-props/computed/interactions/common";
import type { StructureSnapshot } from "../domain/types";
import {
  ENGINE_VERSION,
  RULESET_VERSION,
  type AnalysisRequest,
  type AnalysisRun,
  type ChemicalDefinition,
} from "../domain/analysis";
import type { SelectionIndex } from "../structure/extract";
import {
  classifyContact,
  classifyWaterBridge,
  type ClassificationContext,
} from "./classify";
import { InteractionCollector } from "./collector";
import { incompleteResidues } from "./completeness";
import { atomLocations, buildConnectivity, selectAtoms } from "./connectivity";
import {
  exemptPolarClashes,
  proximityContacts,
  stericClashes,
  unrecordedCovalentContacts,
} from "./contacts";
import { evaluationStatus } from "./evaluation";
import { featureReader, orient, polarTyping } from "./features";
import {
  annotateMetalGroups,
  metalCoordinatingSites,
  metalFeaturePairs,
} from "./metal";
import {
  analysisKey,
  chemicalParameters,
  effectiveParameters,
} from "./parameters";
import { eligibleAtoms, summarizeInteractions } from "./policy";
import {
  conformerLabels,
  conformerSelection,
  MAX_CONFORMER_LABELS,
  mergeEnsemble,
} from "./ensemble";
import { ASSUMPTIONS, chemistrySources, qualityFlags } from "./provenance";
import { metalSearchDistance } from "./metalDistances";

/*
 * Orchestration only: eligibility → connectivity → proximity → clashes → Mol* features
 * → per-type classification → metal grouping → evaluation and provenance. Each step
 * lives in its own module; tests/engine-golden.test.ts pins the combined output.
 */
export { analysisKey, chemicalParameters } from "./parameters";

/** Mol* edge flag bit 1: the refinement step marked this contact redundant. */
const FILTERED = 1;

/**
 * Entry point. Ensemble mode runs the pipeline once per alternate-conformer label and merges
 * the results; structures without alternate conformers take the single-pass path.
 */
export async function analyze(
  structure: Structure,
  snapshot: StructureSnapshot,
  index: SelectionIndex,
  request: AnalysisRequest,
  definitions: ChemicalDefinition[],
  progress: (message: string) => void = () => {},
): Promise<AnalysisRun> {
  if (request.parameters.conformerPolicy !== "ensemble")
    return analyzeSelection(
      structure,
      snapshot,
      index,
      request,
      definitions,
      progress,
    );
  const labels = conformerLabels(snapshot, request);
  if (!labels.length)
    return analyzeSelection(
      structure,
      snapshot,
      index,
      request,
      definitions,
      progress,
    );
  if (labels.length > MAX_CONFORMER_LABELS) {
    const run = await analyzeSelection(
      structure,
      snapshot,
      index,
      request,
      definitions,
      progress,
    );
    run.qualityFlags.push(
      `${labels.length} alternate-conformer labels exceed the ensemble limit of ${MAX_CONFORMER_LABELS}; the preferred conformer per residue was analyzed instead.`,
    );
    return run;
  }
  const runs = [];
  for (const label of labels) {
    progress(`Analyzing conformer ${label}`);
    const { atoms, assumed } = conformerSelection(snapshot, label);
    runs.push({
      label,
      assumed,
      run: await analyzeSelection(
        structure,
        snapshot,
        index,
        request,
        definitions,
        progress,
        atoms,
      ),
    });
  }
  return mergeEnsemble(runs, snapshot);
}

async function analyzeSelection(
  structure: Structure,
  snapshot: StructureSnapshot,
  index: SelectionIndex,
  request: AnalysisRequest,
  definitions: ChemicalDefinition[],
  progress: (message: string) => void = () => {},
  selection?: Set<number>,
): Promise<AnalysisRun> {
  const started = performance.now();
  const parameters = request.parameters;
  const eligible = eligibleAtoms(snapshot, request, selection);
  const incomplete = incompleteResidues(snapshot, eligible.context);
  const ligandSet = new Set(eligible.ligand),
    receptorSet = new Set(eligible.receptor);
  const positions = snapshot.atomBuffer.positions;
  const residueOf = (i: number) =>
    snapshot.residues[snapshot.atomBuffer.residueIndices[i]];
  const target = snapshot.residues.find(
    (r) => r.id === request.ligandResidueId,
  )!;
  const locations = atomLocations(index);
  const selected = selectAtoms(structure, index, eligible.context);

  progress("Building chemical connectivity");
  const connectivity = buildConnectivity(selected, locations);
  const collector = new InteractionCollector();
  const contactContext = {
    snapshot,
    ligandResidueId: request.ligandResidueId,
    ligand: eligible.ligand,
    receptor: eligible.receptor,
    connectivity,
    residueOf,
    parameters,
  };
  progress("Searching nearby heavy atoms");
  const excludedBondedPairs = proximityContacts(contactContext, collector);
  progress("Checking nonmetal van der Waals overlaps");
  const clashSupport = stericClashes(contactContext, collector);

  const components = new Set(
    eligible.context
      .filter((i) => residueOf(i).kind !== "water")
      .map((i) => residueOf(i).componentId),
  );
  const sources = chemistrySources(snapshot, components, definitions);
  const known = new Set(sources.map((s) => s.componentId));
  const unknown = [...components].filter((c) => !known.has(c));
  const isIon =
    snapshot.ligands.find((l) => l.residueId === target.id)?.kind === "ion";
  const chemicalEnabled =
    parameters.classifyChemistry &&
    known.has(target.componentId) &&
    !isIon &&
    !incomplete.has(target.id);
  const metalEnabled = parameters.classifyChemistry;
  const effectiveParams = effectiveParameters(
    chemicalParameters(request),
    chemicalEnabled,
    metalEnabled,
  );

  const donors = new Set<number>(),
    acceptors = new Set<number>();
  if (chemicalEnabled || metalEnabled) {
    progress("Classifying geometry and chemical features");
    const assets = new AssetManager();
    try {
      const targetUnits = new Set(
        eligible.ligand.map((i) => index.locationsByAtom[i].unitId),
      );
      const receptorUnits = new Set(
        eligible.receptor.map((i) => index.locationsByAtom[i].unitId),
      );
      const computed = await computeInteractions(
        { runtime: RuntimeContext.Synchronous, assetManager: assets },
        selected,
        effectiveParams,
        {
          skipIntraContacts: ![...targetUnits].some((id) =>
            receptorUnits.has(id),
          ),
          unitPairTest: (a, b) =>
            (targetUnits.has(a.id) && receptorUnits.has(b.id)) ||
            (targetUnits.has(b.id) && receptorUnits.has(a.id)),
        },
      );
      const read = featureReader(computed, selected, locations);
      if (chemicalEnabled) polarTyping(computed, read, donors, acceptors);
      const ctx: ClassificationContext = {
        snapshot,
        target,
        connectivity,
        residueOf,
        knownComponents: known,
        incomplete,
        chemicalEnabled,
        metalSites: metalCoordinatingSites(
          snapshot,
          eligible.receptor,
          parameters,
        ),
        parameters,
      };
      const edge = (
        unitA: number,
        featureA: number,
        unitB: number,
        featureB: number,
        type: number,
        flag: number,
      ) => {
        if (flag & FILTERED) return collector.reject("mol_refinement_filtered");
        const oriented = orient(
          read(unitA, featureA),
          read(unitB, featureB),
          ligandSet,
          receptorSet,
        );
        if (!oriented) return collector.reject("not_ligand_receptor");
        collector.accept(classifyContact(ctx, oriented[0], oriented[1], type));
      };
      for (const [a, b] of metalFeaturePairs(
        computed,
        read,
        ligandSet,
        receptorSet,
        positions,
        metalSearchDistance(parameters),
      ))
        edge(
          a.unit,
          a.feature,
          b.unit,
          b.feature,
          MolType.MetalCoordination,
          0,
        );
      if (chemicalEnabled && parameters.includeWaters)
        for (const bridge of computed.bridges) {
          if (bridge.props.flag & FILTERED) {
            collector.reject("mol_refinement_filtered");
            continue;
          }
          const oriented = orient(
            read(bridge.unitA, bridge.indexA),
            read(bridge.unitB, bridge.indexB),
            ligandSet,
            receptorSet,
          );
          if (!oriented) {
            collector.reject("not_ligand_receptor");
            continue;
          }
          collector.accept(
            classifyWaterBridge(
              ctx,
              oriented[0],
              oriented[1],
              read(bridge.unitM, bridge.indexMA),
            ),
          );
        }
      for (const e of computed.contacts.edges)
        edge(e.unitA, e.indexA, e.unitB, e.indexB, e.props.type, e.props.flag);
      for (const unitId of computed.unitsContacts.keys()) {
        const c = computed.unitsContacts.get(unitId)!;
        for (let j = 0; j < c.a.length; j++)
          if (c.a[j] < c.b[j])
            edge(
              unitId,
              c.a[j],
              unitId,
              c.b[j],
              c.edgeProps.type[j],
              c.edgeProps.flag[j],
            );
      }
    } finally {
      assets.dispose();
      selected.customPropertyDescriptors.dispose();
    }
  }

  const interactions = collector.interactions;
  // Typed donor–acceptor overlaps are strong hydrogen bonds, not clashes (requires typing).
  const exemptedClashes = chemicalEnabled
    ? exemptPolarClashes(interactions, donors, acceptors)
    : 0;
  const covalentAttachments = connectivity
    .crossLinks(ligandSet, receptorSet)
    .map((b) => {
      const ligandAtom = ligandSet.has(b.atomA) ? b.atomA : b.atomB;
      return {
        ligandAtom,
        receptorAtom: ligandAtom === b.atomA ? b.atomB : b.atomA,
        provenance: b.provenance,
      };
    });
  const unrecordedCovalent = unrecordedCovalentContacts(interactions, snapshot);
  interactions.sort(
    (a, b) =>
      a.distanceAngstrom - b.distanceAngstrom || a.id.localeCompare(b.id),
  );
  annotateMetalGroups(interactions, positions);
  const evaluation = evaluationStatus({
    classifyChemistry: parameters.classifyChemistry,
    includeWaters: parameters.includeWaters,
    chemicalEnabled,
    metalEnabled,
    targetIncomplete: incomplete.has(target.id),
    targetComponentId: target.componentId,
    unknownComponents: unknown,
    incompleteResidueCount: incomplete.size,
    ligandAtoms: eligible.ligand.length,
    receptorAtoms: eligible.receptor.length,
    supportedLigandAtoms: clashSupport.supportedLigand,
    supportedReceptorAtoms: clashSupport.supportedReceptor,
  });
  const summary = summarizeInteractions(interactions);
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    cacheKey: analysisKey(snapshot, request, definitions),
    snapshotId: snapshot.id,
    sourceId: snapshot.sourceId,
    sourceHash: snapshot.provenance.contentHash,
    modelNumber: snapshot.modelNumber,
    assemblyId: snapshot.assemblyId,
    request,
    engineVersion: ENGINE_VERSION,
    ruleSetVersion: RULESET_VERSION,
    parserVersion: snapshot.provenance.parser,
    chemicalParameters: effectiveParams as unknown as Record<string, unknown>,
    chemistrySources: sources,
    generatedAt: new Date().toISOString(),
    assumptions: [...ASSUMPTIONS],
    qualityFlags: qualityFlags({
      snapshot,
      request,
      incomplete,
      unknownComponents: unknown,
      excludedDisorderedResidues: eligible.excludedDisorderedResidues,
      excludedOccupancyAtoms: eligible.excludedOccupancyAtoms,
      covalentAttachments,
      unrecordedCovalent,
      exemptedClashes,
    }),
    evaluation,
    bindingSite: {
      ligandResidueId: target.id,
      residueIds: summary.residues.map((r) => r.residueId),
      definition: "computed_contact_union",
      cutoffsAngstrom: {
        proximity: parameters.proximityCutoff,
        hydrogenBond: parameters.hydrogenBondCutoff,
        hydrophobic: parameters.hydrophobicCutoff,
        saltBridge: parameters.saltBridgeCutoff,
        piStacking: parameters.piStackingCutoff,
        cationPi: parameters.cationPiCutoff,
        halogenBond: parameters.halogenBondCutoff,
        metal: parameters.metalCutoff,
        waterLegMax: parameters.waterLegMax,
        clashOverlapMin: parameters.clashOverlapMin,
      },
    },
    stats: {
      ligandAtomCount: eligible.ligand.length,
      receptorAtomCount: eligible.receptor.length,
      waterAtomCount: eligible.waters.length,
      excludedDisorderedResidues: eligible.excludedDisorderedResidues,
      excludedOccupancyAtoms: eligible.excludedOccupancyAtoms,
      excludedBondedPairs,
      elapsedMilliseconds: performance.now() - started,
      rejections: collector.rejections,
    },
    covalentAttachments,
    interactions,
    ...summary,
    bonds: connectivity.bonds,
  };
}
