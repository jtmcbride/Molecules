import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { prepareStructure } from '../src/analysis/prepare';
import { analyze } from '../src/analysis/engine';
import { DEFAULT_PARAMETERS } from '../src/domain/analysis';
import type { StructureSource } from '../src/domain/types';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe('independent PLIP observations',()=>{
  it('compares deposited-coordinate cases and preserves identified shared contacts',async()=>{
    const reference=JSON.parse(await readFile('validation/plip-reference.json','utf8'));
    const summaries: unknown[] = [];
    for(const c of reference.cases) {
      const bytes=new Uint8Array(await readFile(`tests/fixtures/reference/${c.accession}.cif`));
      expect(sha(bytes)).toBe(c.cifSha256);expect(sha(new Uint8Array(await readFile(`tests/fixtures/reference/${c.accession}.pdb`)))).toBe(c.pdbSha256);
      const source:StructureSource={id:c.accession,name:c.accession,kind:'local',format:'mmcif',binary:false,bytes,contentHash:sha(bytes),fetchedAt:'2026-10-09T00:00:00Z'};
      const p=await prepareStructure(source,0,'');
      const ligand=p.snapshot.ligands.find(l=>l.componentId===c.ligand.component&&p.snapshot.residues.find(r=>r.id===l.residueId)?.authSeqId===c.ligand.authNumber)!;
      expect(ligand).toBeDefined();
      const run=await analyze(p.structure,p.snapshot,p.selectionIndex,{ligandResidueId:ligand.residueId,receptorChainIds:p.snapshot.chains.filter(c=>c.type==='polymer').map(c=>c.id),parameters:{...DEFAULT_PARAMETERS}},[]);
      const observed=(i:typeof run.interactions[number])=>{const r=p.snapshot.residues.find(r=>r.id===i.receptor.residueId)!;return `${i.type}:${r.componentId}:${r.authSeqId}`;};
      const ours=run.interactions.filter(i=>i.type!=='proximity_contact'&&i.type!=='steric_clash');
      const theirs=c.observations.map((o:{type:string;receptor:{component:string;authNumber:string}})=>`${o.type}:${o.receptor.component}:${o.receptor.authNumber}`);
      const shared=[...new Set(ours.map(observed).filter(k=>theirs.includes(k)))];
      summaries.push({case:c.accession,counts:Object.fromEntries([...new Set(ours.map(i=>i.type))].map(t=>[t,ours.filter(i=>i.type===t).length])),referenceCounts:Object.fromEntries([...new Set<string>(c.observations.map((i:{type:string})=>i.type))].map(t=>[t,c.observations.filter((i:{type:string})=>i.type===t).length])),shared,oursOnly:ours.map(observed).filter(k=>!theirs.includes(k)),referenceOnly:theirs.filter((k:string)=>!ours.map(observed).includes(k)),milliseconds:run.stats.elapsedMilliseconds,qualityFlags:run.qualityFlags});
      expect(shared.length).toBeGreaterThan(0);
      if(c.accession==='3PTB')expect(shared).toContain('hydrogen_bond:GLY:219');
      if(c.accession==='1EVE'){expect(shared).toContain('pi_stacking:TRP:279');expect(shared).toContain('cation_pi:PHE:330');expect(ours.map(observed)).toContain('pi_stacking:TRP:84');}
      if(c.accession==='1RMD')expect(shared.filter(k=>k.startsWith('metal_coordination'))).toHaveLength(4);
      // PLIP rounded distances are an independent deposited-coordinate check for
      // direct atom endpoints, independent of classification/count agreement.
      for(const o of c.observations)if(['hydrogen_bond','hydrophobic_contact','metal_coordination'].includes(o.type)) {
        const a=o.fields.ligcoo??o.fields.metalcoo,b=o.fields.protcoo??o.fields.targetcoo;
        if(!a||!b)continue;
        const dist=Math.hypot(...a.map((v:number,k:number)=>v-b[k]));
        expect(dist).toBeCloseTo(Number(o.fields.dist??o.fields['dist_d-a']),1);
        const direct=ours.find(i=>i.type===o.type&&i.closestAtomPair.every((index,j)=>[0,1,2].every(k=>Math.abs(p.snapshot.atomBuffer.positions[index*3+k]-[a,b][j][k])<0.002)));
        if(direct)expect(direct.distanceAngstrom).toBeCloseTo(dist,4);
        for(const point of [a,b])expect(p.snapshot.atoms.some((_atom,index)=>[0,1,2].every(k=>Math.abs(p.snapshot.atomBuffer.positions[index*3+k]-point[k])<0.002))).toBe(true);
      }
    }
    if(process.env.RECORD_REFERENCE)await writeFile('/tmp/molecules-reference-comparison.json',JSON.stringify(summaries,null,2));
  });
});
