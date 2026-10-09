import { Structure, StructureElement, Unit } from 'molstar/lib/mol-model/structure';
import { OrderedSet } from 'molstar/lib/mol-data/int';
import { RuntimeContext } from 'molstar/lib/mol-task';
import { AssetManager } from 'molstar/lib/mol-util/assets';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition';
import { computeInteractions, InteractionsParams, type InteractionsProps } from 'molstar/lib/mol-model-props/computed/interactions/interactions';
import { InteractionType as MolType, FeatureTypes } from 'molstar/lib/mol-model-props/computed/interactions/common';
import type { StructureSnapshot } from '../domain/types';
import { ENGINE_VERSION, RULESET_VERSION, type AnalysisRequest, type AnalysisRun, type ChemicalDefinition, type MolecularInteraction, type Participant } from '../domain/analysis';
import { eligibleAtoms, STANDARD_COMPONENTS, summarizeInteractions } from './policy';
import { angleDegrees, atomDistance, SpatialGrid } from './spatial';
import type { SelectionIndex } from '../structure/extract';

export function chemicalParameters(request: AnalysisRequest): InteractionsProps {
  // Mol*'s mapped-parameter declaration retains parameter definitions in this release;
  // runtime defaults contain values. Keep the compatibility cast at this boundary.
  const defaults = PD.getDefaultValues(InteractionsParams) as unknown as { providers: Record<string,{name:string;params:Record<string,unknown>}>; bridges: unknown; contacts: unknown };
  const h = defaults.providers['hydrogen-bonds'];
  if (h.name !== 'on') throw new Error('Unsupported Mol* hydrogen-bond defaults.');
  return { ...defaults, providers: {
    ionic: { name: 'on', params: { distanceMax: request.parameters.saltBridgeCutoff } },
    hydrophobic: { name: 'on', params: { distanceMax: request.parameters.hydrophobicCutoff } },
    'hydrogen-bonds': { name: 'on', params: { ...h.params, distanceMax: request.parameters.hydrogenBondCutoff, sulfurDistanceMax: request.parameters.hydrogenBondCutoff, water: false } },
    'pi-stacking': { name: 'off', params: {} }, 'cation-pi': { name: 'off', params: {} }, 'halogen-bonds': { name: 'off', params: {} },
    'weak-hydrogen-bonds': { name: 'off', params: {} }, 'metal-coordination': { name: 'off', params: {} },
  }, bridges: { 'water-bridges': { name: 'off', params: {} } } } as unknown as InteractionsProps;
}
export function analysisKey(snapshot: StructureSnapshot, request: AnalysisRequest, definitions: ChemicalDefinition[]) {
  return JSON.stringify([ENGINE_VERSION, RULESET_VERSION, snapshot.provenance.parser, snapshot.id, request.ligandResidueId,
    [...new Set(request.receptorChainIds)].sort(), Object.entries(request.parameters).sort(([a], [b]) => a.localeCompare(b)),
    chemicalParameters(request), definitions.map(d => [d.componentId, d.contentHash]).sort()]);
}
export async function analyze(structure: Structure, snapshot: StructureSnapshot, index: SelectionIndex, request: AnalysisRequest, definitions: ChemicalDefinition[], progress: (message: string) => void = () => {}) : Promise<AnalysisRun> {
  const started = performance.now();
  const eligible = eligibleAtoms(snapshot, request);
  const ligandSet = new Set(eligible.ligand), receptorSet = new Set(eligible.receptor);
  const positions = snapshot.atomBuffer.positions;
  const atomByLocation = new Map(index.locationsByAtom.map((l, i) => [`${l.unitId}:${l.element}`, i]));
  const grouped = new Map<number, number[]>();
  for (const atom of eligible.context) { const l = index.locationsByAtom[atom]; (grouped.get(l.unitId) ?? (grouped.set(l.unitId, []), grouped.get(l.unitId)!)).push(l.unitIndex); }
  const selected = StructureElement.Loci.toStructure(StructureElement.Loci(structure, [...grouped].map(([id, indices]) => ({ unit: structure.unitMap.get(id)!, indices: OrderedSet.ofSortedArray(indices.sort((a,b) => a-b) as StructureElement.UnitIndex[]) }))));
  const bonds: AnalysisRun['bonds'] = [];
  const adjacency = new Map<number, Set<number>>();
  const seenBonds = new Set<string>();
  const addBond = (a: number | undefined, b: number | undefined, order: number, flags: number) => {
    if (a === undefined || b === undefined || !(flags & 1)) return;
    const atomA = Math.min(a,b), atomB = Math.max(a,b), key = `${atomA}:${atomB}`;
    if (seenBonds.has(key)) return; seenBonds.add(key);
    bonds.push({ atomA, atomB, order, provenance: flags & 32 ? 'geometry_inferred' : 'dictionary_or_explicit' });
    for (const [x,y] of [[a,b],[b,a]]) { if (!adjacency.has(x)) adjacency.set(x,new Set()); adjacency.get(x)!.add(y); }
  };
  progress('Building chemical connectivity');
  for (const unit of selected.units) if (Unit.isAtomic(unit)) {
    const { a,b,edgeProps } = unit.bonds;
    for (let i=0;i<a.length;i++) if (a[i]<b[i]) addBond(atomByLocation.get(`${unit.id}:${unit.elements[a[i]]}`),atomByLocation.get(`${unit.id}:${unit.elements[b[i]]}`),edgeProps.order[i],edgeProps.flags[i]);
  }
  for (const edge of selected.interUnitBonds.edges) {
    const ua=selected.unitMap.get(edge.unitA)!,ub=selected.unitMap.get(edge.unitB)!;
    addBond(atomByLocation.get(`${ua.id}:${ua.elements[edge.indexA]}`),atomByLocation.get(`${ub.id}:${ub.elements[edge.indexB]}`),edge.props.order,edge.props.flag);
  }
  const bonded = (a: number,b: number) => adjacency.get(a)?.has(b) || [...(adjacency.get(a) ?? [])].some(n=>adjacency.get(n)?.has(b));
  const interactions: MolecularInteraction[] = [], seen = new Set<string>();
  const residueOf = (i: number) => snapshot.residues[snapshot.atomBuffer.residueIndices[i]];
  const record = (interaction: Omit<MolecularInteraction,'id'>) => {
    const key=JSON.stringify([interaction.type,interaction.ligand.atomIndices,interaction.ligand.role,interaction.receptor.atomIndices,interaction.receptor.role]);
    if (seen.has(key)) return;
    if (interactions.length >= 1_000_000) throw new Error('This selection produces too many contacts. Use a smaller receptor or cutoff. No partial results were returned.');
    seen.add(key); interactions.push({ ...interaction,id:key });
  };
  let excludedBondedPairs=0;
  progress('Searching nearby heavy atoms');
  const grid = new SpatialGrid(positions,eligible.receptor,request.parameters.proximityCutoff);
  for (const a of eligible.ligand) for (const near of grid.neighbors(a,request.parameters.proximityCutoff)) {
    const b=near.index;
    if (bonded(a,b)) { excludedBondedPairs++;continue; }
    record({type:'proximity_contact',ligand:{residueId:request.ligandResidueId,atomIndices:[a],role:'ligand'},receptor:{residueId:residueOf(b).id,atomIndices:[b],role:'receptor'},distanceAngstrom:near.distance,closestAtomPair:[a,b],classification:'measured_proximity',notes:[]});
  }
  const chemistrySources: AnalysisRun['chemistrySources'] = [];
  const embedded = new Set(snapshot.chemistry.embeddedBondComponentIds);
  const components = new Set(eligible.context.map(i=>residueOf(i).componentId));
  for (const componentId of [...components].sort()) {
    const ccd=definitions.find(d=>d.componentId===componentId);
    if (ccd) chemistrySources.push({componentId,source:'ccd',contentHash:ccd.contentHash,url:ccd.url,retrievedAt:ccd.retrievedAt});
    else if (embedded.has(componentId)) chemistrySources.push({componentId,source:'embedded',contentHash:snapshot.provenance.contentHash});
    else if (STANDARD_COMPONENTS.has(componentId)) chemistrySources.push({componentId,source:'standard_template',contentHash:RULESET_VERSION});
  }
  const known=new Set(chemistrySources.map(s=>s.componentId));
  const target=snapshot.residues.find(r=>r.id===request.ligandResidueId)!;
  const unknown=[...components].filter(c=>!known.has(c));
  const chemicalEnabled=request.parameters.classifyChemistry && known.has(target.componentId) && snapshot.ligands.find(l=>l.residueId===target.id)?.kind !== 'ion';
  const params=chemicalParameters(request);
  if (chemicalEnabled) {
    progress('Classifying geometry and chemical features');
    const assets=new AssetManager();
    try {
      const targetUnits=new Set(eligible.ligand.map(i=>index.locationsByAtom[i].unitId));
      const recUnits=new Set(eligible.receptor.map(i=>index.locationsByAtom[i].unitId));
      const computed=await computeInteractions({ runtime:RuntimeContext.Synchronous,assetManager:assets }, selected,params,{
        skipIntraContacts: ![...targetUnits].some(id=>recUnits.has(id)),
        unitPairTest:(a,b)=>(targetUnits.has(a.id)&&recUnits.has(b.id))||(targetUnits.has(b.id)&&recUnits.has(a.id)),
      });
      const feature = (unitId:number, fi:number) => {
        const f=computed.unitsFeatures.get(unitId)!,unit=selected.unitMap.get(unitId)!;
        const atoms:number[]=[];
        for (let j=f.offsets[fi];j<f.offsets[fi+1];j++) { const atom=atomByLocation.get(`${unitId}:${unit.elements[f.members[j]]}`); if(atom!==undefined) atoms.push(atom); }
        return {atoms:atoms.sort((a,b)=>a-b),type:f.types[fi]};
      };
      const edge=(ua:number,fa:number,ub:number,fb:number,type:number,flag:number) => {
        if (flag & 1) return;
        const a=feature(ua,fa),b=feature(ub,fb);
        const [l,r]=a.atoms.every(i=>ligandSet.has(i))&&b.atoms.every(i=>receptorSet.has(i)) ? [a,b] : b.atoms.every(i=>ligandSet.has(i))&&a.atoms.every(i=>receptorSet.has(i)) ? [b,a] : [null,null];
        if(!l?.atoms.length||!r?.atoms.length||!known.has(residueOf(r.atoms[0]).componentId)) return;
        if (new Set(r.atoms.map(i=>residueOf(i).id)).size !== 1) return;
        let distance=Infinity,closest:[number,number]=[l.atoms[0],r.atoms[0]];
        for(const x of l.atoms) for(const y of r.atoms) { if(bonded(x,y)) return;const d=atomDistance(positions,x,y);if(d<distance){distance=d;closest=[x,y];} }
        const role=(t:number,fallback:Participant['role']):Participant['role'] => t===FeatureTypes.HydrogenDonor?'donor':t===FeatureTypes.HydrogenAcceptor?'acceptor':t===FeatureTypes.PositiveCharge?'positive_group':t===FeatureTypes.NegativeCharge?'negative_group':fallback;
        // Reject Mol*'s uncharged nonpolymer N negative feature unless an explicit
        // negative formal charge supports it. Such nitrogen typing is outside this ruleset.
        if (type===MolType.Ionic) {
          const negative=Number(l.type)===FeatureTypes.NegativeCharge?l:r;
          if (negative.atoms.every(i=>snapshot.atoms[i].element==='N' && !(snapshot.atoms[i].formalCharge!==null && snapshot.atoms[i].formalCharge!<0))) return;
        }
        const base={ligand:{residueId:target.id,atomIndices:l.atoms,role:role(l.type,'ligand')},receptor:{residueId:residueOf(r.atoms[0]).id,atomIndices:r.atoms,role:role(r.type,'receptor')},distanceAngstrom:distance,closestAtomPair:closest};
        const disordered=[...l.atoms,...r.atoms].some(i=>residueOf(i).preferredAltId!==null);
        if(type===MolType.Ionic) record({...base,type:'salt_bridge',classification:'candidate',notes:['Charge and protonation are assigned by the Mol* rules; solution pH is not modeled.']});
        else if(type===MolType.Hydrophobic) record({...base,type:'hydrophobic_contact',classification:disordered?'candidate':'geometry_supported',notes:['Nonpolar atom proximity; no interaction energy is calculated.']});
        else if(type===MolType.HydrogenBond) {
          const donor=Number(l.type)===FeatureTypes.HydrogenDonor?closest[0]:closest[1],acceptor=donor===closest[0]?closest[1]:closest[0];
          const hydrogen=[...(adjacency.get(donor) ?? [])].filter(i=>['H','D','T'].includes(snapshot.atoms[i].element)).sort((x,y)=>atomDistance(positions,x,acceptor)-atomDistance(positions,y,acceptor))[0];
          record({...base,type:'hydrogen_bond',classification:hydrogen!==undefined&&!disordered?'geometry_supported':'candidate',hydrogenMode:hydrogen===undefined?'implicit':'explicit',donorHydrogenAcceptorAngle:hydrogen===undefined?undefined:angleDegrees(positions,donor,hydrogen,acceptor),notes:[hydrogen===undefined?'Hydrogen position is absent; donor/acceptor and heavy-atom orientation rules were applied.':'Explicit hydrogen and donor/acceptor orientation rules were applied.']});
        }
      };
      for(const e of computed.contacts.edges) edge(e.unitA,e.indexA,e.unitB,e.indexB,e.props.type,e.props.flag);
      for(const unitId of computed.unitsContacts.keys()) { const c=computed.unitsContacts.get(unitId)!; for(let j=0;j<c.a.length;j++) if(c.a[j]<c.b[j]) edge(unitId,c.a[j],unitId,c.b[j],c.edgeProps.type[j],c.edgeProps.flag[j]); }
    } finally { assets.dispose(); selected.customPropertyDescriptors.dispose(); }
  }
  interactions.sort((a,b)=>a.distanceAngstrom-b.distanceAngstrom||a.id.localeCompare(b.id));
  const evaluation:AnalysisRun['evaluation']={proximity_contact:{status:'evaluated'},hydrogen_bond:{status:'not_evaluated'},hydrophobic_contact:{status:'not_evaluated'},salt_bridge:{status:'not_evaluated'}};
  const reason=!request.parameters.classifyChemistry?'Chemical classification was disabled.':!chemicalEnabled?'Chemical definitions are unavailable for this target, or it is an ion.':unknown.length?`Chemical typing was skipped for: ${unknown.join(', ')}.`:undefined;
  for(const type of ['hydrogen_bond','hydrophobic_contact','salt_bridge'] as const) evaluation[type]={status:chemicalEnabled?(unknown.length?'partially_evaluated':'evaluated'):'not_evaluated',reason};
  const generatedAt=new Date().toISOString(),key=analysisKey(snapshot,request,definitions);
  return {schemaVersion:1,id:crypto.randomUUID(),cacheKey:key,snapshotId:snapshot.id,sourceId:snapshot.sourceId,sourceHash:snapshot.provenance.contentHash,modelNumber:snapshot.modelNumber,assemblyId:snapshot.assemblyId,request,engineVersion:ENGINE_VERSION,ruleSetVersion:RULESET_VERSION,parserVersion:snapshot.provenance.parser,chemicalParameters:params as unknown as Record<string,unknown>,chemistrySources,generatedAt,
    assumptions:['Coordinates are in Å and include the selected assembly transformations.','Only the selected ligand and polymer receptor chains are analyzed. Waters, other ligands and ions are excluded.','Missing atoms and hydrogens are not added. Zero and unknown occupancies are excluded. Chemical completeness of each residue is not established; missing bonded atoms can affect typing.','Noncovalent pairs separated by one or two covalent bonds are excluded.','Mol* infers connectivity/valence when deposited chemistry is incomplete. Standard residue templates treat ARG/LYS/HIS as positive and ASP/GLU as negative for ionic candidates.','Mol* contact refinement suppresses redundant hydrophobic contacts and hydrogen bonds overlapping ionic contacts. Negative nitrogen features require an explicit negative formal charge in this ruleset.','Distance measurements and chemical candidates do not estimate affinity or binding energy.'],
    qualityFlags:[...snapshot.provenance.qualityFlags,...(unknown.length?[`Unknown component chemistry: ${unknown.join(', ')}.`]:[]),...(request.parameters.conformerPolicy==='preferred_residue'?['Preferred conformers are selected independently per residue. Compatibility across residues is unverified.']:[]),...(eligible.excludedDisorderedResidues?[`${eligible.excludedDisorderedResidues} disordered residues were excluded.`]:[]),...(eligible.excludedOccupancyAtoms?[`${eligible.excludedOccupancyAtoms} atoms were excluded by occupancy.`]:[])],
    evaluation,bindingSite:{ligandResidueId:target.id,residueIds:summarizeInteractions(interactions).residues.map(r=>r.residueId),definition:'computed_contact_union',cutoffsAngstrom:{proximity:request.parameters.proximityCutoff,hydrogenBond:request.parameters.hydrogenBondCutoff,hydrophobic:request.parameters.hydrophobicCutoff,saltBridge:request.parameters.saltBridgeCutoff}},stats:{ligandAtomCount:eligible.ligand.length,receptorAtomCount:eligible.receptor.length,excludedDisorderedResidues:eligible.excludedDisorderedResidues,excludedOccupancyAtoms:eligible.excludedOccupancyAtoms,excludedBondedPairs,elapsedMilliseconds:performance.now()-started},interactions,...summarizeInteractions(interactions),bonds};
}
