import type { AnalysisRun } from "../domain/analysis";
import type { StructureSnapshot, StructureSource } from "../domain/types";
const csv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
export function analysisCsv(run: AnalysisRun, snapshot: StructureSnapshot) {
  const rows: unknown[][] = [
    [
      "source_sha256",
      "model",
      "assembly",
      "run_id",
      "generated_at",
      "engine_version",
      "rule_set_version",
      "type",
      "classification",
      "ligand_residue_id",
      "receptor_residue_id",
      "ligand_atoms",
      "receptor_atoms",
      "minimum_distance_angstrom",
      "hydrogen_mode",
      "donor_hydrogen_acceptor_angle_degrees",
      "mediator_residue_id",
      "mediator_atoms",
      "centroid_distance_angstrom",
      "plane_angle_degrees",
      "offset_angstrom",
      "water_legs_angstrom",
      "water_angle_degrees",
      "overlap_angstrom",
      "vdw_radii_angstrom",
      "metal_element",
      "selected_protein_partners",
      "selected_partner_angles_degrees",
      "notes",
    ],
  ];
  for (const i of run.interactions)
    rows.push([
      run.sourceHash,
      run.modelNumber,
      run.assemblyId || "asymmetric-unit",
      run.id,
      run.generatedAt,
      run.engineVersion,
      run.ruleSetVersion,
      i.type,
      i.classification,
      i.ligand.residueId,
      i.receptor.residueId,
      i.ligand.atomIndices.map((a) => snapshot.atoms[a].name).join(";"),
      i.receptor.atomIndices.map((a) => snapshot.atoms[a].name).join(";"),
      i.distanceAngstrom,
      i.hydrogenMode,
      i.donorHydrogenAcceptorAngle,
      i.mediator?.residueId,
      i.mediator?.atomIndices.map((a) => snapshot.atoms[a].name).join(";"),
      i.geometry?.centroidDistanceAngstrom,
      i.geometry?.planeAngleDegrees,
      i.geometry?.offsetAngstrom,
      i.geometry?.waterLegDistancesAngstrom?.join(";"),
      i.geometry?.waterAngleDegrees,
      i.geometry?.overlapAngstrom,
      i.geometry?.vdwRadiiAngstrom?.join(";"),
      i.geometry?.metalElement,
      i.geometry?.selectedReceptorPartnerCount,
      i.geometry?.selectedReceptorAnglesDegrees?.join(";"),
      i.notes.join("; "),
    ]);
  return rows.map((row) => row.map(csv).join(",")).join("\r\n");
}
export function analysisJson(
  run: AnalysisRun,
  snapshot: StructureSnapshot,
  source: StructureSource,
) {
  return JSON.stringify(
    {
      schemaVersion: 2,
      analysis: run,
      source: {
        id: source.id,
        name: source.name,
        url: source.url,
        contentHash: source.contentHash,
        fetchedAt: source.fetchedAt,
      },
      structure: {
        id: snapshot.id,
        chains: snapshot.chains,
        residues: snapshot.residues,
        atoms: snapshot.atoms,
        positionsAngstrom: Array.from(snapshot.atomBuffer.positions),
        occupancies: Array.from(snapshot.atomBuffer.occupancies),
        preferredAtomIndices: Array.from(
          snapshot.atomBuffer.preferredAtomIndices,
        ),
        provenance: snapshot.provenance,
      },
    },
    null,
    2,
  );
}
export function downloadAnalysis(
  run: AnalysisRun,
  snapshot: StructureSnapshot,
  source: StructureSource,
  format: "json" | "csv",
) {
  const blob = new Blob(
    [
      format === "json"
        ? analysisJson(run, snapshot, source)
        : analysisCsv(run, snapshot),
    ],
    { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `${source.id.replace(/[^a-z0-9_-]/gi, "_")}-interactions.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
