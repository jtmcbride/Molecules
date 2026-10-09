import type { AnalysisRequest, ChemicalDefinition } from '../domain/analysis';
import type { StructureSnapshot } from '../domain/types';
import { STANDARD_COMPONENTS, eligibleAtoms } from '../analysis/policy';
import { database } from './repository';
import { hashBytes } from './provider';
export async function loadChemicalDefinitions(snapshot:StructureSnapshot,request:AnalysisRequest,signal:AbortSignal):Promise<ChemicalDefinition[]> {
  if (!request.parameters.classifyChemistry || snapshot.ligands.find(l => l.residueId === request.ligandResidueId)?.kind === 'ion') return [];
  const {context}=eligibleAtoms(snapshot,request);
  const embedded=new Set(snapshot.chemistry.embeddedBondComponentIds);
  const needed=[...new Set(context.filter(i=>snapshot.residues[snapshot.atomBuffer.residueIndices[i]].kind!=='water').map(i=>snapshot.residues[snapshot.atomBuffer.residueIndices[i]].componentId))]
    .filter(id=>!embedded.has(id)&&!STANDARD_COMPONENTS.has(id)&&/^[A-Z0-9]{1,8}$/.test(id));
  const definitions:ChemicalDefinition[]=[];
  // Bound network work; unsupported components remain explicitly untyped.
  for(const componentId of needed.slice(0,32)) {
    if(signal.aborted) throw new DOMException('Analysis cancelled.','AbortError');
    const cached=await database.chemicalDefinitions.get(componentId).catch(()=>undefined);
    if(cached){definitions.push(cached);continue;}
    try {
      const url=`https://files.rcsb.org/ligands/download/${componentId}.cif`;
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
      if(!response.ok) continue;
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.byteLength>2*1024*1024) continue;
      const definition={componentId,bytes,contentHash:await hashBytes(bytes),url,retrievedAt:new Date().toISOString()};
      definitions.push(definition);
      // Only the worker accepts a parsed, matching definition. Cache after successful analysis.
    } catch(error) { if(signal.aborted) throw error; }
  }
  return definitions;
}
