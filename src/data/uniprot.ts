import { uniprotSchema } from "./biologySchemas";
import { resourceEvidence, attachedEvidence } from "../biology/evidence";
import type {
  Evidence,
  FeatureBoundary,
  FunctionalAnnotation,
  ProteinRecord,
  ResourceSnapshot,
} from "../domain/biology";
import { hashBytes } from "./provider";
function boundary(raw: { value?: number; modifier?: string }): FeatureBoundary {
  const modifier =
    raw.modifier ?? (raw.value === undefined ? "UNKNOWN" : "EXACT");
  return {
    position: raw.value,
    modifier:
      modifier === "EXACT"
        ? "exact"
        : modifier === "LESS_THAN"
          ? "less_than"
          : modifier === "GREATER_THAN"
            ? "greater_than"
            : "unknown",
  };
}
export async function parseUniProt(
  value: unknown,
  accession: string,
  resource: ResourceSnapshot,
) {
  const data = uniprotSchema.parse(value);
  // The JSON endpoint can resolve an isoform to its canonical record. Never use
  // canonical positions to impersonate an isoform-specific sequence.
  if (data.primaryAccession !== accession)
    throw Error(
      `UniProt returned ${data.primaryAccession} for ${accession}; exact isoform correspondence is unavailable.`,
    );
  if (data.sequence.value.length !== data.sequence.length)
    throw Error("UniProt sequence length is inconsistent.");
  const record = resourceEvidence(resource),
    evidence: Evidence[] = [record],
    id = `${accession}:${resource.contentHash}`;
  const protein: ProteinRecord = {
    id,
    accession,
    canonicalAccession: accession.split("-")[0],
    name:
      data.proteinDescription?.recommendedName?.fullName.value ??
      data.proteinDescription?.submissionNames?.[0]?.fullName.value ??
      accession,
    organism: {
      name: data.organism.scientificName,
      taxonomyId: data.organism.taxonId,
    },
    reviewed:
      data.entryType.includes("reviewed") &&
      !data.entryType.includes("unreviewed"),
    sequence: data.sequence.value,
    sequenceVersion: data.entryAudit?.sequenceVersion,
    entryVersion: data.entryAudit?.entryVersion,
    sequenceHash: await hashBytes(
      new TextEncoder().encode(data.sequence.value),
    ),
    evidenceIds: [record.id],
    notes: [],
  };
  const annotations: FunctionalAnnotation[] = (data.features ?? []).map(
    (feature, index) => {
      const featureId = `${id}:feature:${index}`,
        attached = attachedEvidence(record, feature.evidences ?? [], featureId);
      evidence.push(...attached);
      const start = boundary(feature.location.start),
        end = boundary(feature.location.end);
      const valid =
        start.position === undefined || end.position === undefined
          ? true
          : start.position <= end.position &&
            start.position >= 1 &&
            end.position <= protein.sequence.length;
      return {
        id: featureId,
        proteinId: id,
        type: feature.type,
        description: feature.description ?? "",
        start,
        end,
        sourceFeatureId: feature.featureId,
        ligand: feature.ligand
          ? {
              name: feature.ligand.name,
              identifier: feature.ligand.id,
              label: feature.ligand.label,
            }
          : undefined,
        evidenceIds: [record.id, ...attached.map((e) => e.id)],
        valid,
        qualityFlags: valid
          ? []
          : ["Feature boundaries fall outside this sequence or are reversed."],
      };
    },
  );
  for (const [i, comment] of (data.comments ?? []).entries())
    if (["FUNCTION", "CATALYTIC ACTIVITY"].includes(comment.commentType)) {
      const texts =
        comment.texts ??
        (comment.reaction
          ? [
              {
                value: comment.reaction.name,
                evidences: comment.reaction.evidences,
              },
            ]
          : []);
      for (const [j, text] of texts.entries()) {
        const attached = attachedEvidence(
          record,
          text.evidences ?? [],
          `${id}:note:${i}:${j}`,
        );
        evidence.push(...attached);
        protein.notes.push({
          type: comment.commentType,
          description: text.value,
          evidenceIds: [record.id, ...attached.map((e) => e.id)],
        });
      }
    }
  return { protein, annotations, evidence };
}
