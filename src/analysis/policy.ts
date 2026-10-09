import type { AnalysisRequest, MolecularInteraction, ResidueInteractionSummary } from '../domain/analysis';
import type { StructureSnapshot } from '../domain/types';
export const STANDARD_COMPONENTS = new Set(['ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE','LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL','A','C','G','U','DA','DC','DG','DT']);
export function validateRequest(snapshot: StructureSnapshot, request: AnalysisRequest) {
  if (!snapshot.ligands.some(l => l.residueId === request.ligandResidueId)) throw new Error('Select a ligand instance from this structure.');
  if (!request.receptorChainIds.length || request.receptorChainIds.some(id => !snapshot.chains.some(c => c.id === id && c.type === 'polymer'))) throw new Error('Choose at least one polymer chain as the receptor.');
  const p = request.parameters;
  for (const cutoff of [p.proximityCutoff, p.hydrogenBondCutoff, p.hydrophobicCutoff, p.saltBridgeCutoff]) if (!Number.isFinite(cutoff) || cutoff < 1 || cutoff > 8) throw new Error('Distance cutoffs must be between 1 and 8 Å.');
  if (!Number.isFinite(p.minimumOccupancy) || p.minimumOccupancy < 0 || p.minimumOccupancy > 1) throw new Error('Minimum occupancy must be between 0 and 1.');
  if (!['exclude_disordered', 'preferred_residue'].includes(p.conformerPolicy)) throw new Error('Unknown alternate-conformer policy.');
}
export function eligibleAtoms(snapshot: StructureSnapshot, request: AnalysisRequest) {
  validateRequest(snapshot, request);
  const preferred = new Set(snapshot.atomBuffer.preferredAtomIndices);
  const receptorChains = new Set(request.receptorChainIds);
  const context: number[] = [], ligand: number[] = [], receptor: number[] = [];
  let excludedDisorderedResidues = 0, excludedOccupancyAtoms = 0;
  for (const residue of snapshot.residues) {
    const isTarget = residue.id === request.ligandResidueId;
    const isReceptor = residue.kind === 'polymer' && receptorChains.has(residue.chainId);
    if (!isTarget && !isReceptor) continue;
    const disordered = residue.atomIndices.some(i => snapshot.atoms[i].altId !== null);
    if (disordered && request.parameters.conformerPolicy === 'exclude_disordered') {
      if (isTarget) throw new Error('This ligand has alternate conformers. Choose “Preferred per residue” for an exploratory analysis.');
      excludedDisorderedResidues++; continue;
    }
    for (const index of residue.atomIndices) {
      if (!preferred.has(index)) continue;
      const occupancy = snapshot.atomBuffer.occupancies[index];
      if (!Number.isFinite(occupancy) || occupancy <= 0 || occupancy < request.parameters.minimumOccupancy) { excludedOccupancyAtoms++; continue; }
      context.push(index);
      if (['H', 'D', 'T'].includes(snapshot.atoms[index].element.toUpperCase())) continue;
      (isTarget ? ligand : receptor).push(index);
    }
  }
  if (!ligand.length) throw new Error('The chosen ligand has no eligible heavy atoms under these settings.');
  if (!receptor.length) throw new Error('The receptor has no eligible heavy atoms under these settings.');
  return { context, ligand, receptor, excludedDisorderedResidues, excludedOccupancyAtoms };
}
export function summarizeInteractions(interactions: MolecularInteraction[]) {
  const grouped = new Map<string, ResidueInteractionSummary>();
  const graph: Record<string, string[]> = {};
  for (const interaction of interactions) {
    const id = interaction.receptor.residueId;
    const summary = grouped.get(id) ?? { residueId: id, proximityPairCount: 0, chemicalInteractionCount: 0, minimumDistance: Infinity, types: [], interactionIds: [] };
    if (interaction.type === 'proximity_contact') summary.proximityPairCount++; else summary.chemicalInteractionCount++;
    summary.minimumDistance = Math.min(summary.minimumDistance, interaction.distanceAngstrom);
    if (!summary.types.includes(interaction.type)) summary.types.push(interaction.type);
    summary.interactionIds.push(interaction.id); grouped.set(id, summary);
    for (const residueId of [interaction.ligand.residueId, interaction.receptor.residueId]) (graph[residueId] ??= []).push(interaction.id);
  }
  return { residues: [...grouped.values()].sort((a, b) => a.minimumDistance - b.minimumDistance || a.residueId.localeCompare(b.residueId)), graph };
}
