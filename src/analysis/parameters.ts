import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import {
  InteractionsParams,
  type InteractionsProps,
} from "molstar/lib/mol-model-props/computed/interactions/interactions";
import { WaterBridgesParams } from "molstar/lib/mol-model-props/computed/interactions/water-bridges";
import type { StructureSnapshot } from "../domain/types";
import {
  ENGINE_VERSION,
  RULESET_VERSION,
  type AnalysisRequest,
  type ChemicalDefinition,
} from "../domain/analysis";

/** Mol* interaction provider settings for this request. */
export function chemicalParameters(
  request: AnalysisRequest,
): InteractionsProps {
  // Mol*'s mapped-parameter declaration retains parameter definitions in this release;
  // runtime defaults contain values. Keep the compatibility cast at this boundary.
  const defaults = PD.getDefaultValues(InteractionsParams) as unknown as {
    providers: Record<
      string,
      { name: string; params: Record<string, unknown> }
    >;
    bridges: unknown;
    contacts: unknown;
  };
  const h = defaults.providers["hydrogen-bonds"];
  if (h.name !== "on")
    throw new Error("Unsupported Mol* hydrogen-bond defaults.");
  return {
    ...defaults,
    providers: {
      ionic: {
        name: "on",
        params: { distanceMax: request.parameters.saltBridgeCutoff },
      },
      hydrophobic: {
        name: "on",
        params: { distanceMax: request.parameters.hydrophobicCutoff },
      },
      "hydrogen-bonds": {
        name: "on",
        params: {
          ...h.params,
          distanceMax: request.parameters.hydrogenBondCutoff,
          sulfurDistanceMax: request.parameters.hydrogenBondCutoff,
          water: false,
        },
      },
      "pi-stacking": {
        name: "on",
        params: {
          distanceMax: request.parameters.piStackingCutoff,
          offsetMax: request.parameters.piOffsetMax,
          angleDevMax: request.parameters.piAngleDeviation,
        },
      },
      "cation-pi": {
        name: "on",
        params: {
          distanceMax: request.parameters.cationPiCutoff,
          offsetMax: request.parameters.piOffsetMax,
        },
      },
      "halogen-bonds": { name: "off", params: {} },
      "weak-hydrogen-bonds": { name: "off", params: {} },
      "metal-coordination": {
        name: "on",
        params: { distanceMax: request.parameters.metalCutoff },
      },
    },
    bridges: {
      "water-bridges": request.parameters.includeWaters
        ? {
            name: "on",
            params: {
              ...PD.getDefaultValues(WaterBridgesParams),
              ignoreHydrogens: false,
              legDistMin: request.parameters.waterLegMin,
              legDistMax: request.parameters.waterLegMax,
              omegaMin: request.parameters.waterAngleMin,
              omegaMax: request.parameters.waterAngleMax,
            },
          }
        : { name: "off", params: {} },
    },
  } as unknown as InteractionsProps;
}
export function analysisKey(
  snapshot: StructureSnapshot,
  request: AnalysisRequest,
  definitions: ChemicalDefinition[],
) {
  return JSON.stringify([
    ENGINE_VERSION,
    RULESET_VERSION,
    snapshot.provenance.parser,
    snapshot.id,
    request.ligandResidueId,
    [...new Set(request.receptorChainIds)].sort(),
    Object.entries(request.parameters).sort(([a], [b]) => a.localeCompare(b)),
    chemicalParameters(request),
    definitions.map((d) => [d.componentId, d.contentHash]).sort(),
  ]);
}

/**
 * Providers actually run: everything when nonmetal chemistry is enabled; otherwise only
 * metal coordination (when chemistry classification is on) and no water bridges.
 */
export function effectiveParameters(
  params: InteractionsProps,
  chemicalEnabled: boolean,
  metalEnabled: boolean,
): InteractionsProps {
  if (chemicalEnabled) return params;
  return {
    ...params,
    providers: Object.fromEntries(
      Object.entries(params.providers).map(([key, value]) => [
        key,
        key === "metal-coordination" && metalEnabled
          ? value
          : { name: "off", params: {} },
      ]),
    ) as InteractionsProps["providers"],
    bridges: { "water-bridges": { name: "off", params: {} } },
  };
}
