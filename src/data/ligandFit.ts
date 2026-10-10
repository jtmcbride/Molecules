import { ligandInstanceSchema } from "./biologySchemas";
import { resourceEvidence } from "../biology/evidence";
import type { LigandFit, ResourceSnapshot } from "../domain/biology";

/** Validation scores of one deposited ligand instance from its RCSB record. */
export function parseLigandFit(
  value: unknown,
  entryId: string,
  labelAsymId: string,
  resource: ResourceSnapshot,
) {
  const data = ligandInstanceSchema.parse(value);
  const ids = data.rcsb_nonpolymer_entity_instance_container_identifiers;
  if (
    ids.entry_id.toUpperCase() !== entryId.toUpperCase() ||
    ids.asym_id !== labelAsymId
  )
    throw Error(
      `RCSB returned ${ids.entry_id}/${ids.asym_id} for ${entryId}/${labelAsymId}.`,
    );
  const evidence = {
    ...resourceEvidence(resource),
    assumptions: [
      "Fit and geometry scores describe the deposited coordinates. They are unavailable when no structure factors were deposited.",
    ],
  };
  const score = data.rcsb_nonpolymer_instance_validation_score?.[0];
  const value_ = (x: number | null | undefined) =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const fit: LigandFit = {
    labelAsymId,
    componentId: ids.comp_id,
    rscc: value_(score?.RSCC),
    rsr: value_(score?.RSR),
    completeness: value_(score?.completeness),
    mogulBondsRmsz: value_(score?.mogul_bonds_RMSZ),
    mogulAnglesRmsz: value_(score?.mogul_angles_RMSZ),
    rankingModelFit: value_(score?.ranking_model_fit),
    rankingModelGeometry: value_(score?.ranking_model_geometry),
    scoreType: score?.type,
    evidenceIds: [evidence.id],
  };
  for (const key of Object.keys(fit) as (keyof LigandFit)[])
    if (fit[key] === undefined) delete fit[key];
  return { fit, evidence };
}
