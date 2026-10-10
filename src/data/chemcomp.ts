import { chemCompSchema } from "./biologySchemas";
import { resourceEvidence } from "../biology/evidence";
import type { LigandIdentity, ResourceSnapshot } from "../domain/biology";

/** "ChEBI:CHEBI:29108", "CHEBI:29108" or "29108" → "CHEBI:29108"; undefined when not a ChEBI identifier. */
export function normalizeChebi(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(?:ChEBI:)?(?:CHEBI:)?(\d+)$/i);
  return match ? `CHEBI:${match[1]}` : undefined;
}

/** Chemical identity of one deposited component from its RCSB chemical component record. */
export function parseChemComp(
  value: unknown,
  componentId: string,
  resource: ResourceSnapshot,
) {
  const data = chemCompSchema.parse(value);
  if (data.chem_comp.id.toUpperCase() !== componentId.toUpperCase())
    throw Error(
      `RCSB returned component ${data.chem_comp.id} for ${componentId}.`,
    );
  const evidence = resourceEvidence(resource);
  const chebiIds = [
    ...new Set(
      (data.rcsb_chem_comp_related ?? [])
        .filter((r) => r.resource_name === "ChEBI")
        .map((r) => normalizeChebi(r.resource_accession_code))
        .filter((id): id is string => id !== undefined),
    ),
  ].sort();
  const ligand: LigandIdentity = {
    componentId: data.chem_comp.id,
    name: data.chem_comp.name,
    chebiIds,
    evidenceIds: [evidence.id],
  };
  return { ligand, evidence };
}
