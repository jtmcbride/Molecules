import {
  LIGAND_POSE_VERSION,
  POSE_ALGORITHM_VERSION,
  type PoseChemicalGraph,
  type LigandPoseInput,
  type PreparedPoseLigand,
} from "../../src/domain/ligandPose";
import reference from "../fixtures/ligand-pose/reference.json";
export function ligand(
  graph: PoseChemicalGraph,
  names: string[],
  coordinates: number[][],
  side: string,
): PreparedPoseLigand {
  return {
    sourceHash: side,
    snapshotId: side,
    parser: "synthetic",
    modelIndex: 0,
    modelNumber: 1,
    assemblyId: "",
    residueId: side,
    componentId: graph.componentId,
    conformerId: null,
    minimumOccupancy: 0,
    chemistryId: "fixture",
    chemistryHash: "fixture",
    graphHash: "fixture",
    graph: structuredClone(graph),
    attachment: {
      sourceHash: side,
      snapshotId: side,
      residueId: side,
      status: "no_recorded_link",
      connectionIds: [],
    },
    atomIds: names.map((n) => `${side}:${n}`),
    atomNames: [...names],
    sourceRows: names.map((_, i) => i),
    positions: new Float64Array(coordinates.flat()),
  };
}
export function input(c = reference.cases[0]): LigandPoseInput {
  return {
    version: LIGAND_POSE_VERSION,
    algorithmVersion: POSE_ALGORITHM_VERSION,
    inputKey: c.name,
    reference: ligand(
      c.graph as PoseChemicalGraph,
      c.atomNames,
      c.reference,
      "reference",
    ),
    comparison: ligand(
      c.graph as PoseChemicalGraph,
      c.atomNames,
      c.comparison,
      "comparison",
    ),
    fit: {
      scope: c.name.endsWith("-site") ? "binding_site" : "global",
      transform: [...c.transform],
      method: "frozen numpy protein fit or synthetic transform",
      atoms: "CA",
      rmsdAll: 0,
      rmsdCore: 0,
      fitted: 3,
      total: 3,
      cycles: 0,
      rejected: [],
    },
    fitInputKey: "frozen-fit",
  };
}
