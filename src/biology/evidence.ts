import type { Evidence, ResourceSnapshot } from "../domain/biology";
import type { AttachedEvidence } from "../data/biologySchemas";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import type { AnalysisRun } from "../domain/analysis";
export function resourceEvidence(resource: ResourceSnapshot): Evidence {
  return {
    id: `record:${resource.id}`,
    kind: "database_annotation",
    provider: resource.provider,
    sourceIdentifier: resource.identifier,
    url: resource.url,
    contentHash: resource.contentHash,
    retrievedAt: resource.retrievedAt,
    release: resource.release,
  };
}
export function attachedEvidence(
  record: Evidence,
  attached: AttachedEvidence[],
  scope: string,
): Evidence[] {
  return attached.map((e, i) => ({
    id: `${scope}:evidence:${i}`,
    kind: "database_annotation",
    provider: record.provider,
    sourceIdentifier: e.id,
    url:
      e.source === "PubMed" && /^\d+$/.test(e.id ?? "")
        ? `https://pubmed.ncbi.nlm.nih.gov/${e.id}/`
        : e.source === "UniProtKB" && /^[A-Z0-9-]+$/.test(e.id ?? "")
          ? `https://www.uniprot.org/uniprotkb/${e.id}/entry`
          : record.url,
    contentHash: record.contentHash,
    retrievedAt: record.retrievedAt,
    ecoCode: e.evidenceCode,
    citationIds: e.id ? [`${e.source ?? "source"}:${e.id}`] : [],
  }));
}
export function structureEvidence(
  snapshot: StructureSnapshot,
  source: StructureSource,
): Evidence {
  return {
    id: `structure:${snapshot.id}`,
    kind:
      source.kind !== "local" &&
      source.metadata?.method &&
      /X-RAY|NMR|ELECTRON|NEUTRON|DIFFRACTION|SCATTERING/i.test(
        source.metadata.method,
      )
        ? "experimental_structure"
        : "structure_coordinates",
    provider: source.kind === "local" ? "Local coordinates" : "RCSB PDB",
    sourceIdentifier: source.id,
    url: source.url,
    contentHash: source.contentHash,
    retrievedAt: source.fetchedAt,
    assumptions: [
      "Structure coordinates do not establish experimental support for each functional annotation. Source method should be checked separately.",
    ],
    quality: snapshot.quality,
  };
}
export function analysisEvidence(run: AnalysisRun): Evidence {
  return {
    id: `analysis:${run.id}`,
    kind: "computed_geometry",
    provider: "Molecular Interaction Explorer",
    sourceIdentifier: run.id,
    contentHash: run.sourceHash,
    algorithmVersion: run.engineVersion,
    assumptions: run.assumptions,
  };
}
