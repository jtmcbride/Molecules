import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareStructure } from '../src/analysis/prepare';
import { analyze } from '../src/analysis/engine';
import { DEFAULT_PARAMETERS, type AnalysisParameters } from '../src/domain/analysis';
import { clashRadius, planeNormal, ringGeometry } from '../src/analysis/geometry';
import { analysisCsv, analysisJson } from '../src/analysis/export';
import type { StructureSource } from '../src/domain/types';
async function runFixture(name:string,params:Partial<AnalysisParameters>={},transform?:(s:string)=>string) {
  let text=await readFile(`tests/fixtures/${name}.cif`,'utf8');if(transform)text=transform(text);
  const bytes=new TextEncoder().encode(text);
  const source:StructureSource={id:name,name,kind:'local',format:'mmcif',binary:false,bytes,contentHash:createHash('sha256').update(bytes).digest('hex'),fetchedAt:'2026-10-09T00:00:00Z'};
  const p=await prepareStructure(source,0,'');
  const request={ligandResidueId:p.snapshot.ligands[0].residueId,receptorChainIds:p.snapshot.chains.filter(c=>c.type==='polymer').map(c=>c.id),parameters:{...DEFAULT_PARAMETERS,...params}};
  return {...p,source,run:await analyze(p.structure,p.snapshot,p.selectionIndex,request,[])};
}
function moveLigand(s:string,delta:number) {return s.split('\n').map(line=>{if(!line.startsWith('HETATM')||line.includes('HOH'))return line;const a=line.split(/\s+/);a[10]=String(Number(a[10])+delta);return a.join(' ');}).join('\n');}
describe('additional interaction categories',()=>{
  it('detects parallel aromatic rings with centroids and planes and rejects distance/offset failures',async()=>{
    const {run}=await runFixture('pi-stacking');const pi=run.interactions.filter(i=>i.type==='pi_stacking');
    expect(pi).toHaveLength(1);expect(pi[0].geometry!.centroidDistanceAngstrom).toBeCloseTo(3.6,5);
    expect(pi[0].geometry!.planeAngleDegrees).toBeCloseTo(0,5);expect(pi[0].geometry!.offsetAngstrom).toBeCloseTo(0,5);
    expect(pi[0].ligand.atomIndices).toHaveLength(6);expect(pi[0].receptor.atomIndices).toHaveLength(6);
    expect((await runFixture('pi-stacking',{piStackingCutoff:3.5})).run.interactions.filter(i=>i.type==='pi_stacking')).toHaveLength(0);
    expect((await runFixture('pi-stacking',{},s=>moveLigand(s,3))).run.interactions.filter(i=>i.type==='pi_stacking')).toHaveLength(0);
  });
  it('detects a charged group over an aromatic ring and rejects lateral offset',async()=>{
    const {run}=await runFixture('cation-pi');const pi=run.interactions.filter(i=>i.type==='cation_pi');
    expect(pi).toHaveLength(1);expect(pi[0].classification).toBe('candidate');expect(pi[0].geometry!.centroidDistanceAngstrom).toBeCloseTo(3.6,5);
    expect((await runFixture('cation-pi',{cationPiCutoff:3.5})).run.interactions.filter(i=>i.type==='cation_pi')).toHaveLength(0);
    expect((await runFixture('cation-pi',{},s=>moveLigand(s,3))).run.interactions.filter(i=>i.type==='cation_pi')).toHaveLength(0);
  });
  it('detects a metal partner without treating zinc as a steric clash',async()=>{
    const {run}=await runFixture('metal-coordination');const metal=run.interactions.find(i=>i.type==='metal_coordination');
    expect(metal).toBeDefined();expect(metal!.distanceAngstrom).toBeCloseTo(2.2,5);expect(metal!.geometry!.metalElement).toBe('ZN');
    expect(metal!.geometry!.selectedReceptorPartnerCount).toBeGreaterThan(0);expect(run.interactions.filter(i=>i.type==='steric_clash')).toHaveLength(0);
    expect((await runFixture('metal-coordination',{metalDistancePolicy:'uniform',metalCutoff:2.1})).run.interactions.filter(i=>i.type==='metal_coordination')).toHaveLength(0);
    // Element-specific default: Zn–N target 2.04 Å; tolerance 0.1 Å rejects the 2.2 Å pair, the default 0.5 Å accepts it.
    expect(metal!.geometry).toMatchObject({metalTargetAngstrom:2.04,metalLimitSource:'element_specific'});expect(metal!.geometry!.metalLimitAngstrom).toBeCloseTo(2.54,10);
    expect((await runFixture('metal-coordination',{metalTolerance:0.1})).run.interactions.filter(i=>i.type==='metal_coordination')).toHaveLength(0);
    expect((await runFixture('metal-coordination',{classifyChemistry:false})).run.evaluation.metal_coordination.status).toBe('not_evaluated');
  });
  it('records two deposited-water legs, mediator identity and graph adjacency, with independent enablement',async()=>{
    const {run,snapshot,source}=await runFixture('water-bridge');const water=run.interactions.filter(i=>i.type==='water_bridge');
    expect(water.length).toBeGreaterThan(0);const bridge=water.find(i=>i.geometry!.waterAngleDegrees!>89&&i.geometry!.waterAngleDegrees!<91)!;
    expect(bridge).toBeDefined();expect(bridge.geometry!.waterLegDistancesAngstrom![0]).toBeCloseTo(2.8,5);expect(bridge.geometry!.waterLegDistancesAngstrom![1]).toBeCloseTo(2.8,5);
    expect(snapshot.residues.find(r=>r.id===bridge.mediator!.residueId)!.kind).toBe('water');expect(run.graph[bridge.mediator!.residueId]).toContain(bridge.id);
    const disabled=(await runFixture('water-bridge',{includeWaters:false})).run;expect(disabled.interactions.filter(i=>i.type==='water_bridge')).toHaveLength(0);expect(disabled.evaluation.water_bridge.status).toBe('not_evaluated');
    expect((await runFixture('water-bridge',{waterAngleMin:100})).run.interactions.filter(i=>i.type==='water_bridge')).toHaveLength(0);
    expect((await runFixture('water-bridge',{waterLegMax:2.6})).run.interactions.filter(i=>i.type==='water_bridge')).toHaveLength(0);
    expect(JSON.parse(analysisJson(run,snapshot,source)).schemaVersion).toBe(2);expect(analysisCsv(run,snapshot)).toContain('water_legs_angstrom');expect(analysisCsv(run,snapshot)).toContain(bridge.mediator!.residueId.replaceAll('"','""'));
  });
  it('calculates clash overlap independently of the proximity cutoff and does not infer unknown radii',async()=>{
    const {run}=await runFixture('hydrogen-geometry',{proximityCutoff:1,classifyChemistry:false,clashOverlapMin:0.1});
    expect(run.interactions.filter(i=>i.type==='proximity_contact')).toHaveLength(0);
    const clashes=run.interactions.filter(i=>i.type==='steric_clash');expect(clashes.length).toBeGreaterThan(0);
    for(const c of clashes)expect(c.geometry!.overlapAngstrom).toBeCloseTo(c.geometry!.vdwRadiiAngstrom!.reduce((a,b)=>a+b)-c.distanceAngstrom,6);
    expect(run.residues.every(r=>r.chemicalInteractionCount===0)).toBe(true);
    expect(clashRadius('ZN')).toBeUndefined();expect(clashRadius('XX')).toBeUndefined();expect(clashRadius('O')).toBeGreaterThan(1);
  });
  it('handles perpendicular and degenerate ring geometry without invalid numerical results',()=>{
    const p=new Float32Array([1,0,0,0,1,0,-1,0,0,0,0,3,0,1,4,0,-1,4]);
    expect(ringGeometry(p,[0,1,2],[3,4,5],true,true)!.planeAngleDegrees).toBeCloseTo(90,5);
    expect(planeNormal(new Float32Array(9),[0,1,2])).toBeUndefined();
  });
});

describe('incomplete and unsupported input',()=>{
  it('reports missing receptor atoms and preserves measured proximity',async()=>{
    const p=await runFixture('hydrogen-geometry',{},s=>s.split('\n').filter(line=>!line.startsWith('ATOM 6 ')).join('\n'));
    expect(p.run.qualityFlags.some(f=>f.includes('OG')&&f.includes('Nonmetal chemical classification skipped'))).toBe(true);
    expect(p.run.evaluation.hydrogen_bond.status).toBe('partially_evaluated');
    expect(p.run.interactions.some(i=>i.type==='proximity_contact')).toBe(true);
    expect(p.run.interactions.filter(i=>i.type==='hydrogen_bond')).toHaveLength(0);
  });
  it('checks ligand dictionary heavy atoms without inventing missing coordinates',async()=>{
    const dictionary='\nloop_\n_chem_comp_atom.comp_id\n_chem_comp_atom.atom_id\n_chem_comp_atom.type_symbol\nACM C1 C\nACM C2 C\nACM N1 N\nACM O1 O\n#\n';
    const p=await runFixture('hydrogen-geometry',{},s=>s.split('\n').filter(line=>!line.startsWith('HETATM 8 ')).join('\n')+dictionary);
    expect(p.run.evaluation.hydrogen_bond.status).toBe('not_evaluated');
    expect(p.run.qualityFlags.some(f=>f.includes('O1'))).toBe(true);
    expect(p.run.interactions.some(i=>i.type==='proximity_contact')).toBe(true);
  });
  it('excludes zero-occupancy water mediators',async()=>{
    const p=await runFixture('water-bridge',{},s=>s.replace('2.8 0 0 1 10 2 HOH','2.8 0 0 0 10 2 HOH'));
    expect(p.run.interactions.filter(i=>i.type==='water_bridge')).toHaveLength(0);expect(p.run.stats.waterAtomCount).toBe(0);
  });
  it('rejects invalid water ranges before computing a partial result',async()=>{
    await expect(runFixture('water-bridge',{waterLegMin:4,waterLegMax:3})).rejects.toThrow('minimums');
    await expect(runFixture('pi-stacking',{piAngleDeviation:NaN})).rejects.toThrow('Geometry settings');
  });
  it('does not attribute rejected CCD bytes to chemistry already present in the source',async()=>{
    const p=await runFixture('hydrogen-geometry');
    const definition={componentId:'ACM',bytes:new TextEncoder().encode('not a chemical dictionary'),contentHash:'invalid-dictionary-test',url:'https://example.test/ACM.cif',retrievedAt:'2026-10-09T00:00:00Z'};
    const parsed=await prepareStructure(p.source,0,'',[definition]);
    const run=await analyze(parsed.structure,parsed.snapshot,parsed.selectionIndex,p.run.request,[definition]);
    expect(run.chemistrySources.find(c=>c.componentId==='ACM')!.source).toBe('embedded');
    expect(run.qualityFlags.some(f=>f.includes('Rejected optional chemistry ACM'))).toBe(true);
    expect(run.interactions.some(i=>i.type==='hydrogen_bond')).toBe(true);
  });
});
describe('element-specific metal distances (R3)',()=>{
  it('derives limits from the Bazayeva et al. 2024 targets plus tolerance, with a uniform fallback',async()=>{
    const {metalDistanceLimit,metalSearchDistance}=await import('../src/analysis/metalDistances');
    const p={...DEFAULT_PARAMETERS};
    expect(metalDistanceLimit('ZN','N',p)).toEqual({limit:2.54,target:2.04,source:'element_specific'});
    expect(metalDistanceLimit('K','O',p).limit).toBeCloseTo(3.2,10);
    expect(metalDistanceLimit('ZN','S',p).limit).toBeCloseTo(2.82,10);
    expect(metalDistanceLimit('CO','N',p)).toEqual({limit:3,source:'uniform_fallback'});
    expect(metalDistanceLimit('ZN','N',{...p,metalDistancePolicy:'uniform'})).toEqual({limit:3,source:'uniform'});
    expect(metalSearchDistance(p)).toBeCloseTo(3.2,10);
  });
  it('rejects a second-shell zinc partner that the uniform cutoff accepted',async()=>{
    // Artificial: zinc moved along z from 2.2 Å to 2.8 Å above His ND1 (NE2 then 3.49 Å).
    const far=(s:string)=>s.split('\n').map(line=>{if(!line.startsWith('HETATM'))return line;const a=line.split(/\s+/);a[12]=String(Number(a[12])+0.6);return a.join(' ');}).join('\n');
    expect((await runFixture('metal-coordination',{},far)).run.interactions.filter(i=>i.type==='metal_coordination')).toHaveLength(0);
    expect((await runFixture('metal-coordination',{metalDistancePolicy:'uniform'},far)).run.interactions.filter(i=>i.type==='metal_coordination').length).toBeGreaterThan(0);
  });
});
describe('halogen bonds (R4)',()=>{
  // Artificial fixture: C1–Br···O=C with Br···O 3.0 Å, C–Br···O 180°, Br···O=C 120°.
  const bend=(degrees:number)=>(s:string)=>s.split('\n').map(line=>{if(!line.startsWith('HETATM')||!line.includes(' C1 '))return line;const a=line.split(/\s+/);const t=(180-degrees)*Math.PI/180;a[10]=(-1.94*Math.cos(t)).toFixed(3);a[11]=(1.94*Math.sin(t)).toFixed(3);return a.join(' ');}).join('\n');
  it('detects a linear C–Br···O=C contact and records its angle',async()=>{
    const {run}=await runFixture('halogen-bond');const x=run.interactions.filter(i=>i.type==='halogen_bond');
    expect(x).toHaveLength(1);expect(x[0].distanceAngstrom).toBeCloseTo(3.0,5);expect(x[0].geometry!.halogenAngleDegrees).toBeCloseTo(180,4);
    expect(x[0].ligand.role).toBe('halogen_donor');expect(x[0].receptor.role).toBe('halogen_acceptor');expect(x[0].classification).toBe('geometry_supported');
    expect(run.evaluation.halogen_bond.status).toBe('evaluated');
  });
  it('rejects bent and distant contacts at the Mol* angle and distance limits',async()=>{
    expect((await runFixture('halogen-bond',{},bend(140))).run.interactions.filter(i=>i.type==='halogen_bond')).toHaveLength(0);
    expect((await runFixture('halogen-bond',{},bend(155))).run.interactions.filter(i=>i.type==='halogen_bond')).toHaveLength(1);
    expect((await runFixture('halogen-bond',{halogenBondCutoff:2.9})).run.interactions.filter(i=>i.type==='halogen_bond')).toHaveLength(0);
    expect((await runFixture('halogen-bond',{halogenAngleDeviation:20},bend(155))).run.interactions.filter(i=>i.type==='halogen_bond')).toHaveLength(0);
  });
  it('reports halogen bonds as evaluated with no result for ligands without halogens',async()=>{
    const {run}=await runFixture('hydrogen-geometry');
    expect(run.interactions.filter(i=>i.type==='halogen_bond')).toHaveLength(0);expect(run.evaluation.halogen_bond.status).toBe('evaluated');
  });
});
