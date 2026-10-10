import type { AnalysisRun, InteractionType } from "../domain/analysis";

type Evaluation = AnalysisRun["evaluation"];
type Status = Evaluation[InteractionType];

export interface EvaluationInputs {
  classifyChemistry: boolean;
  includeWaters: boolean;
  chemicalEnabled: boolean;
  metalEnabled: boolean;
  targetIncomplete: boolean;
  targetComponentId: string;
  unknownComponents: string[];
  incompleteResidueCount: number;
  ligandAtoms: number;
  receptorAtoms: number;
  supportedLigandAtoms: number;
  supportedReceptorAtoms: number;
}

const ORDER: InteractionType[] = [
  "proximity_contact",
  "hydrogen_bond",
  "hydrophobic_contact",
  "salt_bridge",
  "pi_stacking",
  "cation_pi",
  "metal_coordination",
  "water_bridge",
  "steric_clash",
];
const NONMETAL_CHEMISTRY: InteractionType[] = [
  "hydrogen_bond",
  "hydrophobic_contact",
  "salt_bridge",
  "pi_stacking",
  "cation_pi",
  "water_bridge",
];

/** The exclusion reason is kept even when no atom has a radius (e.g. a zinc-only target). */
function clashStatus(x: EvaluationInputs): Status {
  const partial =
    x.supportedLigandAtoms < x.ligandAtoms ||
    x.supportedReceptorAtoms < x.receptorAtoms;
  return {
    status:
      !x.supportedLigandAtoms || !x.supportedReceptorAtoms
        ? "not_evaluated"
        : partial
          ? "partially_evaluated"
          : "evaluated",
    reason: partial
      ? "Metals and atoms without a published radius were excluded."
      : undefined,
  };
}

function chemistryReason(x: EvaluationInputs): string | undefined {
  if (x.targetIncomplete)
    return "Target heavy atoms are missing or excluded; only proximity, supported clashes and metal candidates are evaluated.";
  if (!x.classifyChemistry) return "Chemical classification was disabled.";
  if (!x.chemicalEnabled)
    return "Chemical definitions are unavailable for this target, or it is an ion.";
  if (x.unknownComponents.length || x.incompleteResidueCount)
    return `Chemical typing was skipped for ${x.unknownComponents.length} unknown components and ${x.incompleteResidueCount} residues with missing/excluded expected heavy atoms.`;
  return undefined;
}

function metalStatus(x: EvaluationInputs): Status {
  if (!x.metalEnabled)
    return {
      status: "not_evaluated",
      reason: "Chemical classification was disabled.",
    };
  const unknownReceptor =
    x.unknownComponents.filter((c) => c !== x.targetComponentId).length > 0;
  return unknownReceptor
    ? {
        status: "partially_evaluated",
        reason: "Unknown receptor chemistry was skipped.",
      }
    : { status: "evaluated", reason: undefined };
}

/** Evaluation status per interaction type: evaluated, partially evaluated (with reason) or not evaluated. */
export function evaluationStatus(x: EvaluationInputs): Evaluation {
  const evaluation = Object.fromEntries(
    ORDER.map((type) => [type, { status: "not_evaluated" }]),
  ) as Evaluation;
  evaluation.proximity_contact = { status: "evaluated" };
  evaluation.steric_clash = clashStatus(x);
  const reason = chemistryReason(x);
  const partial =
    x.unknownComponents.length > 0 || x.incompleteResidueCount > 0;
  for (const type of NONMETAL_CHEMISTRY)
    evaluation[type] = {
      status: x.chemicalEnabled
        ? partial
          ? "partially_evaluated"
          : "evaluated"
        : "not_evaluated",
      reason,
    };
  if (!x.includeWaters)
    evaluation.water_bridge = {
      status: "not_evaluated",
      reason: "Deposited-water analysis was disabled.",
    };
  evaluation.metal_coordination = metalStatus(x);
  return evaluation;
}
