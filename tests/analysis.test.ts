import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareStructure } from '../src/analysis/prepare';
import { analyze, analysisKey } from '../src/analysis/engine';
import { angleDegrees, atomDistance, SpatialGrid } from '../src/analysis/spatial';
import { loadChemicalDefinitions } from '../src/data/chemistry';
import { eligibleAtoms } from '../src/analysis/policy';
import { DEFAULT_PARAMETERS, type AnalysisRequest, type ChemicalDefinition } from '../src/domain/analysis';
import type { StructureSource } from '../src/domain/types';
async function fixture(path:string,assemblyId='') {
  const bytes=new Uint8Array(await readFile(path));
  const source:StructureSource={id:path,name:path,kind:'local',format:'mmcif',binary:path.endsWith('.bcif'),bytes,contentHash:createHash('sha256').update(bytes).digest('hex'),fetchedAt:'2026-01-01T00:00:00Z'};
  return prepareStructure(source,0,assemblyId);
}
function requestFor(snapshot:Awaited<ReturnType<typeof fixture>>['snapshot']):AnalysisRequest {
  return {ligandResidueId:snapshot.ligands.find(l=>l.componentId==='BEN')!.residueId,receptorChainIds:snapshot.chains.filter(c=>c.type==='polymer').map(c=>c.id),parameters:{...DEFAULT_PARAMETERS}};
}
describe('ligand interaction engine',()=>{
  it('matches brute-force neighborhoods at boundaries, negative coordinates and varying cell sizes',()=>{
    const p=new Float32Array(Array.from({length:300},(_,i)=>Math.sin(i*19)*14));
    p.set([0,0,0,-5,0,0,5,0,0],0);
    for(const size of [1.5,5,8]) for(const cutoff of [2,5,7]) {
      const grid=new SpatialGrid(p,Array.from({length:99},(_,i)=>i+1),size);
      for(let a=0;a<8;a++) {
        const brute=Array.from({length:99},(_,i)=>i+1).filter(b=>atomDistance(p,a,b)<=cutoff);
        expect(grid.neighbors(a,cutoff).map(n=>n.index)).toEqual(brute);
      }
    }
    expect(angleDegrees(new Float32Array([0,0,0,1,0,0,2,0,0]),0,1,2)).toBe(180);
    expect(angleDegrees(new Float32Array(9),0,1,2)).toBeUndefined();
  });
  it('classifies the known benzamidine–ASP189 ionic contact with reproducible group geometry',async()=>{
    const p=await fixture('public/structures/3PTB.cif'),q=requestFor(p.snapshot);
    const run=await analyze(p.structure,p.snapshot,p.selectionIndex,q,[]);
    const salts=run.interactions.filter(i=>i.type==='salt_bridge');
    expect(salts.length).toBeGreaterThan(0);
    const asp=salts.find(i=>p.snapshot.residues.find(r=>r.id===i.receptor.residueId)?.authSeqId==='189')!;
    expect(asp).toBeDefined();expect(asp.classification).toBe('candidate');
    expect(asp.distanceAngstrom).toBeCloseTo(atomDistance(p.snapshot.atomBuffer.positions,...asp.closestAtomPair),6);
    expect(asp.ligand.role).toBe('positive_group');expect(asp.receptor.role).toBe('negative_group');
    expect(run.interactions.some(i=>i.type==='hydrophobic_contact')).toBe(true);
    expect(run.interactions.some(i=>i.type==='hydrogen_bond')).toBe(true);
    expect(run.evaluation.hydrogen_bond.status).toBe('partially_evaluated');
    expect(run.qualityFlags.some(f=>f.startsWith('Missing/excluded heavy atoms'))).toBe(true);
    expect(run.interactions.filter(i=>i.type==='hydrogen_bond').every(i=>i.hydrogenMode==='implicit'&&i.classification==='candidate')).toBe(true);
    expect(new Set(run.interactions.map(i=>i.id)).size).toBe(run.interactions.length);
    expect(run.stats.ligandAtomCount).toBe(9);
    expect(run.residues.every(r=>run.graph[r.residueId].length===r.interactionIds.length)).toBe(true);
    const again=await analyze(p.structure,p.snapshot,p.selectionIndex,q,[]);
    expect(again.interactions).toEqual(run.interactions);expect(again.cacheKey).toBe(run.cacheKey);
  });
  it('separates unknown chemistry from an evaluated zero and honors occupancy and conformer policies',async()=>{
    const p=await fixture('tests/fixtures/identity-edge-cases.cif'),q=requestFor(p.snapshot);
    const atoms=eligibleAtoms(p.snapshot,q);expect(atoms.excludedDisorderedResidues).toBe(1);
    const run=await analyze(p.structure,p.snapshot,p.selectionIndex,q,[]);
    expect(run.evaluation.hydrogen_bond.status).toBe('not_evaluated');
    expect(run.interactions.every(i=>i.type==='proximity_contact'||i.type==='steric_clash')).toBe(true);
    q.parameters.conformerPolicy='preferred_residue';
    expect(eligibleAtoms(p.snapshot,q).receptor.length).toBeGreaterThan(atoms.receptor.length);
    for(const ligandAtom of atoms.ligand) p.snapshot.atomBuffer.occupancies[ligandAtom]=0;
    expect(()=>eligibleAtoms(p.snapshot,q)).toThrow('no eligible heavy atoms');
  });
  it('analyzes an ion for proximity and metal partners without requesting unsupported bond chemistry',async()=>{
    const p=await fixture('public/structures/3PTB.cif'),q=requestFor(p.snapshot);
    q.ligandResidueId=p.snapshot.ligands.find(l=>l.kind==='ion')!.residueId;
    const definitions=await loadChemicalDefinitions(p.snapshot,q,new AbortController().signal);
    expect(definitions).toEqual([]);
    const run=await analyze(p.structure,p.snapshot,p.selectionIndex,q,definitions);
    expect(run.stats.ligandAtomCount).toBe(1);expect(run.interactions.length).toBeGreaterThan(0);
    expect(run.interactions.every(i=>i.type==='proximity_contact'||i.type==='metal_coordination')).toBe(true);
    expect(run.evaluation.metal_coordination.status).toBe('evaluated');
    expect(run.evaluation.salt_bridge.status).toBe('not_evaluated');
  });
  it('loads a pinned CCD definition when embedded ligand bonds are missing',async()=>{
    const bytes=new Uint8Array(await readFile('public/structures/3PTB.cif'));
    // Remove the deposited chem_comp_bond category without changing coordinates.
    const stripped=new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/loop_\s+_chem_comp_bond[\s\S]*?(?=#)/,''));
    const source:StructureSource={id:'3PTB-no-bonds',name:'3ptb.cif',kind:'local',format:'mmcif',binary:false,bytes:stripped,contentHash:createHash('sha256').update(stripped).digest('hex'),fetchedAt:'2026-01-01T00:00:00Z'};
    const ccdBytes=new Uint8Array(await readFile('tests/fixtures/BEN-ccd.cif'));
    const definition:ChemicalDefinition={componentId:'BEN',bytes:ccdBytes,contentHash:createHash('sha256').update(ccdBytes).digest('hex'),url:'https://files.rcsb.org/ligands/download/BEN.cif',retrievedAt:'2026-10-09T00:00:00Z'};
    const without=await prepareStructure(source,0,'');
    expect(without.snapshot.chemistry.embeddedBondComponentIds).not.toContain('BEN');
    const withCcd=await prepareStructure(source,0,'',[definition]);
    const q=requestFor(withCcd.snapshot),run=await analyze(withCcd.structure,withCcd.snapshot,withCcd.selectionIndex,q,[definition]);
    expect(run.chemistrySources.find(c=>c.componentId==='BEN')).toMatchObject({source:'ccd',contentHash:definition.contentHash,url:definition.url});
    expect(run.interactions.some(i=>i.type==='salt_bridge')).toBe(true);
    expect(analysisKey(without.snapshot,q,[])).not.toBe(run.cacheKey);
    const rejected=await prepareStructure(source,0,'',[{...definition,componentId:'BAD'}]);
    expect(rejected.snapshot.provenance.qualityFlags.some(f=>f.includes('Rejected optional chemistry BAD'))).toBe(true);
    const fallback=await analyze(rejected.structure,rejected.snapshot,rejected.selectionIndex,requestFor(rejected.snapshot),[{...definition,componentId:'BAD'}]);
    expect(fallback.evaluation.hydrogen_bond.status).toBe('not_evaluated');
    expect(fallback.interactions.some(i=>i.type==='proximity_contact')).toBe(true);
  });
  it('excludes deposited covalent and two-bond neighbors from noncovalent proximity',async()=>{
    const text=await readFile('tests/fixtures/hydrogen-geometry.cif','utf8');
    const connection=`
loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_auth_seq_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr1_symmetry
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_auth_seq_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr2_symmetry
_struct_conn.pdbx_dist_value
_struct_conn.pdbx_value_order
1 covale A 1 OG 1_555 B 1 O1 1_555 2.8 sing
#
`;
    // Intentionally artificial covalent assignment at 2.8 Å exercises declared connectivity.
    const bytes=new TextEncoder().encode(text+connection);
    const source:StructureSource={id:'covalent',name:'covalent.cif',kind:'local',format:'mmcif',binary:false,bytes,contentHash:createHash('sha256').update(bytes).digest('hex'),fetchedAt:'2026-01-01T00:00:00Z'};
    const p=await prepareStructure(source,0,'');
    const q:AnalysisRequest={ligandResidueId:p.snapshot.ligands[0].residueId,receptorChainIds:p.snapshot.chains.filter(c=>c.type==='polymer').map(c=>c.id),parameters:{...DEFAULT_PARAMETERS,classifyChemistry:false}};
    const run=await analyze(p.structure,p.snapshot,p.selectionIndex,q,[]);
    expect(run.stats.excludedBondedPairs).toBeGreaterThan(0);
    const names=(a:number,b:number)=>[p.snapshot.atoms[a].name,p.snapshot.atoms[b].name].sort().join(':');
    expect(run.bonds.some(b=>names(b.atomA,b.atomB)==='O1:OG'&&b.provenance==='dictionary_or_explicit')).toBe(true);
    expect(run.interactions.some(i=>names(...i.closestAtomPair)==='O1:OG')).toBe(false);
    expect(run.interactions.some(i=>names(...i.closestAtomPair)==='C1:OG')).toBe(false);
  });
  it('uses explicit hydrogen orientation rather than distance alone',async()=>{
    const p=await fixture('tests/fixtures/hydrogen-geometry.cif');
    const q:AnalysisRequest={ligandResidueId:p.snapshot.ligands[0].residueId,receptorChainIds:p.snapshot.chains.filter(c=>c.type==='polymer').map(c=>c.id),parameters:{...DEFAULT_PARAMETERS}};
    const run=await analyze(p.structure,p.snapshot,p.selectionIndex,q,[]);
    const hbond=run.interactions.find(i=>i.type==='hydrogen_bond'&&i.receptor.atomIndices.some(a=>p.snapshot.atoms[a].name==='OG'));
    expect(hbond).toBeDefined();expect(hbond!.hydrogenMode).toBe('explicit');expect(hbond!.donorHydrogenAcceptorAngle).toBeCloseTo(180,5);expect(hbond!.classification).toBe('geometry_supported');
    // Same heavy-atom coordinates, hydrogen points away from the acceptor.
    const bytes=new TextEncoder().encode(new TextDecoder().decode((await readFile('tests/fixtures/hydrogen-geometry.cif'))).replace('SER A 1 1 ? 1 0 0','SER A 1 1 ? -1 0 0'));
    const source:StructureSource={id:'reverse-hydrogen',name:'reverse.cif',kind:'local',format:'mmcif',binary:false,bytes,contentHash:createHash('sha256').update(bytes).digest('hex'),fetchedAt:'2026-01-01T00:00:00Z'};
    const reverse=await prepareStructure(source,0,'');
    const qr={...q,ligandResidueId:reverse.snapshot.ligands[0].residueId,receptorChainIds:reverse.snapshot.chains.filter(c=>c.type==='polymer').map(c=>c.id)};
    const negative=await analyze(reverse.structure,reverse.snapshot,reverse.selectionIndex,qr,[]);
    expect(negative.interactions.filter(i=>i.type==='hydrogen_bond'&&i.receptor.atomIndices.some(a=>reverse.snapshot.atoms[a].name==='OG'))).toHaveLength(0);
    expect(negative.interactions.filter(i=>i.type==='proximity_contact').map(i=>i.distanceAngstrom)).toEqual(run.interactions.filter(i=>i.type==='proximity_contact').map(i=>i.distanceAngstrom));
  });
  it('distinguishes assembly ligand copies and cache settings',async()=>{
    const p=await fixture('tests/fixtures/identity-edge-cases.cif','1'),q=requestFor(p.snapshot);
    const run=await analyze(p.structure,p.snapshot,p.selectionIndex,q,[]);
    expect(run.interactions.every(i=>i.ligand.residueId===q.ligandResidueId)).toBe(true);
    const key=analysisKey(p.snapshot,q,[]);
    expect(analysisKey(p.snapshot,{...q,receptorChainIds:[...q.receptorChainIds].reverse()},[])).toBe(key);
    expect(analysisKey(p.snapshot,{...q,parameters:{...q.parameters,proximityCutoff:4}},[])).not.toBe(key);
    expect(analysisKey(p.snapshot,{...q,ligandResidueId:p.snapshot.ligands[1].residueId},[])).not.toBe(key);
  });
});
