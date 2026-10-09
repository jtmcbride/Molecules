import type { AnalysisRun } from '../domain/analysis';
import type { StructureSnapshot, StructureSource } from '../domain/types';
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export function analysisCsv(run: AnalysisRun, snapshot: StructureSnapshot) {
  const rows: unknown[][] = [['source_sha256','model','assembly','run_id','generated_at','engine_version','rule_set_version','type','classification','ligand_residue_id','receptor_residue_id','ligand_atoms','receptor_atoms','minimum_distance_angstrom','hydrogen_mode','donor_hydrogen_acceptor_angle_degrees','notes']];
  for (const i of run.interactions) rows.push([run.sourceHash,run.modelNumber,run.assemblyId||'asymmetric-unit',run.id,run.generatedAt,run.engineVersion,run.ruleSetVersion,i.type,i.classification,i.ligand.residueId,i.receptor.residueId,i.ligand.atomIndices.map(a=>snapshot.atoms[a].name).join(';'),i.receptor.atomIndices.map(a=>snapshot.atoms[a].name).join(';'),i.distanceAngstrom,i.hydrogenMode,i.donorHydrogenAcceptorAngle,i.notes.join('; ')]);
  return rows.map(row=>row.map(csv).join(',')).join('\r\n');
}
export function analysisJson(run: AnalysisRun, snapshot: StructureSnapshot, source: StructureSource) {
  return JSON.stringify({ schemaVersion:1,analysis:run,source:{id:source.id,name:source.name,url:source.url,contentHash:source.contentHash,fetchedAt:source.fetchedAt},
    structure:{id:snapshot.id,chains:snapshot.chains,residues:snapshot.residues,atoms:snapshot.atoms,positionsAngstrom:Array.from(snapshot.atomBuffer.positions),occupancies:Array.from(snapshot.atomBuffer.occupancies),preferredAtomIndices:Array.from(snapshot.atomBuffer.preferredAtomIndices),provenance:snapshot.provenance}},null,2);
}
export function downloadAnalysis(run:AnalysisRun,snapshot:StructureSnapshot,source:StructureSource,format:'json'|'csv') {
  const blob=new Blob([format==='json'?analysisJson(run,snapshot,source):analysisCsv(run,snapshot)],{type:format==='json'?'application/json':'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${source.id.replace(/[^a-z0-9_-]/gi,'_')}-interactions.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
