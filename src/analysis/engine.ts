import { Structure, StructureElement, Unit } from 'molstar/lib/mol-model/structure';
import { OrderedSet } from 'molstar/lib/mol-data/int';
import { RuntimeContext } from 'molstar/lib/mol-task';
import { AssetManager } from 'molstar/lib/mol-util/assets';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition';
import { computeInteractions, InteractionsParams, type InteractionsProps } from 'molstar/lib/mol-model-props/computed/interactions/interactions';
import { WaterBridgesParams } from 'molstar/lib/mol-model-props/computed/interactions/water-bridges';
import { InteractionType as MolType, FeatureTypes } from 'molstar/lib/mol-model-props/computed/interactions/common';
import type { StructureSnapshot } from '../domain/types';
import { ENGINE_VERSION, RULESET_VERSION, type AnalysisRequest, type AnalysisRun, type ChemicalDefinition, type MolecularInteraction, type Participant } from '../domain/analysis';
import { incompleteResidues } from './completeness';
import { clashRadius, ringGeometry } from './geometry';
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
    'pi-stacking': { name: 'on', params: { distanceMax: request.parameters.piStackingCutoff, offsetMax: request.parameters.piOffsetMax, angleDevMax: request.parameters.piAngleDeviation } }, 'cation-pi': { name: 'on', params: { distanceMax: request.parameters.cationPiCutoff, offsetMax: request.parameters.piOffsetMax } }, 'halogen-bonds': { name: 'off', params: {} },
    'weak-hydrogen-bonds': { name: 'off', params: {} }, 'metal-coordination': { name: 'on', params: { distanceMax: request.parameters.metalCutoff } },
  }, bridges: { 'water-bridges': request.parameters.includeWaters ? { name: 'on', params: { ...PD.getDefaultValues(WaterBridgesParams), ignoreHydrogens: false, legDistMin: request.parameters.waterLegMin, legDistMax: request.parameters.waterLegMax, omegaMin: request.parameters.waterAngleMin, omegaMax: request.parameters.waterAngleMax } } : { name: 'off', params: {} } } } as unknown as InteractionsProps;
}
export function analysisKey(snapshot: StructureSnapshot, request: AnalysisRequest, definitions: ChemicalDefinition[]) {
  return JSON.stringify([ENGINE_VERSION, RULESET_VERSION, snapshot.provenance.parser, snapshot.id, request.ligandResidueId,
    [...new Set(request.receptorChainIds)].sort(), Object.entries(request.parameters).sort(([a], [b]) => a.localeCompare(b)),
    chemicalParameters(request), definitions.map(d => [d.componentId, d.contentHash]).sort()]);
}
export async function analyze(structure: Structure, snapshot: StructureSnapshot, index: SelectionIndex, request: AnalysisRequest, definitions: ChemicalDefinition[], progress: (message: string) => void = () => {}) : Promise<AnalysisRun> {
  const started = performance.now();
  const eligible = eligibleAtoms(snapshot, request);
  const incomplete=incompleteResidues(snapshot,eligible.context);
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
    const key=JSON.stringify([interaction.type,interaction.ligand.atomIndices,interaction.ligand.role,interaction.receptor.atomIndices,interaction.receptor.role,interaction.mediator?.atomIndices]);
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
  progress('Checking nonmetal van der Waals overlaps');
  const ligandRadii=eligible.ligand.map(i=>clashRadius(snapshot.atoms[i].element)),receptorRadii=eligible.receptor.map(i=>clashRadius(snapshot.atoms[i].element));
  const supportedLigand=eligible.ligand.filter((_,i)=>ligandRadii[i]!==undefined),supportedReceptor=eligible.receptor.filter((_,i)=>receptorRadii[i]!==undefined);
  const clashCutoff=ligandRadii.reduce<number>((maximum,radius)=>Math.max(maximum,radius ?? 0),0)+receptorRadii.reduce<number>((maximum,radius)=>Math.max(maximum,radius ?? 0),0)-request.parameters.clashOverlapMin;
  if(supportedLigand.length&&supportedReceptor.length&&clashCutoff>0) {
    const clashGrid=new SpatialGrid(positions,supportedReceptor,clashCutoff);
    for(const a of supportedLigand) for(const {index:b,distance} of clashGrid.neighbors(a,clashCutoff)) {
      if(bonded(a,b))continue;
      const radii:[number,number]=[clashRadius(snapshot.atoms[a].element)!,clashRadius(snapshot.atoms[b].element)!],overlap=radii[0]+radii[1]-distance;
      if(overlap+1e-6<request.parameters.clashOverlapMin)continue;
      record({type:'steric_clash',ligand:{residueId:request.ligandResidueId,atomIndices:[a],role:'ligand'},receptor:{residueId:residueOf(b).id,atomIndices:[b],role:'receptor'},distanceAngstrom:distance,closestAtomPair:[a,b],geometry:{overlapAngstrom:overlap,vdwRadiiAngstrom:radii},classification:'candidate',notes:['Heavy-atom van der Waals overlap using the Mol* radii table (doi:10.1021/jp8111556). Metals and unknown radii are excluded; this is not an energetic clash score.']});
    }
  }
  const chemistrySources: AnalysisRun['chemistrySources'] = [];
  const embedded = new Set(snapshot.chemistry.embeddedBondComponentIds);
  const components = new Set(eligible.context.filter(i=>residueOf(i).kind!=='water').map(i=>residueOf(i).componentId));
  for (const componentId of [...components].sort()) {
    const ccd=definitions.find(d=>d.componentId===componentId&&snapshot.chemistry.appliedChemicalDefinitionHashes?.includes(d.contentHash));
    if (ccd) chemistrySources.push({componentId,source:'ccd',contentHash:ccd.contentHash,url:ccd.url,retrievedAt:ccd.retrievedAt});
    else if (embedded.has(componentId)) chemistrySources.push({componentId,source:'embedded',contentHash:snapshot.provenance.contentHash});
    else if (STANDARD_COMPONENTS.has(componentId)) chemistrySources.push({componentId,source:'standard_template',version:RULESET_VERSION});
  }
  const known=new Set(chemistrySources.map(s=>s.componentId));
  const target=snapshot.residues.find(r=>r.id===request.ligandResidueId)!;
  const unknown=[...components].filter(c=>!known.has(c));
  const isIon=snapshot.ligands.find(l=>l.residueId===target.id)?.kind === 'ion';
  const chemicalEnabled=request.parameters.classifyChemistry && known.has(target.componentId) && !isIon && !incomplete.has(target.id);
  const metalEnabled=request.parameters.classifyChemistry;
  const params=chemicalParameters(request);
  const effectiveParams:InteractionsProps=chemicalEnabled?params:{...params,providers:Object.fromEntries(Object.entries(params.providers).map(([key,value])=>[key,key==='metal-coordination'&&metalEnabled?value:{name:'off',params:{}}])) as InteractionsProps['providers'],bridges:{'water-bridges':{name:'off',params:{}}}};
  if (chemicalEnabled || metalEnabled) {
    progress('Classifying geometry and chemical features');
    const assets=new AssetManager();
    try {
      const targetUnits=new Set(eligible.ligand.map(i=>index.locationsByAtom[i].unitId));
      const recUnits=new Set(eligible.receptor.map(i=>index.locationsByAtom[i].unitId));
      const computed=await computeInteractions({ runtime:RuntimeContext.Synchronous,assetManager:assets }, selected,effectiveParams,{
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
        if(type!==MolType.MetalCoordination&&(!chemicalEnabled||incomplete.has(residueOf(r.atoms[0]).id)))return;
        if (new Set(r.atoms.map(i=>residueOf(i).id)).size !== 1) return;
        let distance=Infinity,closest:[number,number]=[l.atoms[0],r.atoms[0]];
        for(const x of l.atoms) for(const y of r.atoms) { if(type!==MolType.MetalCoordination&&bonded(x,y)) return;const d=atomDistance(positions,x,y);if(d<distance){distance=d;closest=[x,y];} }
        const role=(t:number,fallback:Participant['role']):Participant['role'] => t===FeatureTypes.AromaticRing?'aromatic_ring':(t===FeatureTypes.TransitionMetal||t===FeatureTypes.IonicTypeMetal)?'metal':(t===FeatureTypes.DativeBondPartner||t===FeatureTypes.IonicTypePartner)?'coordinator':t===FeatureTypes.HydrogenDonor?'donor':t===FeatureTypes.HydrogenAcceptor?'acceptor':t===FeatureTypes.PositiveCharge?'positive_group':t===FeatureTypes.NegativeCharge?'negative_group':fallback;
        // Reject Mol*'s uncharged nonpolymer N negative feature unless an explicit
        // negative formal charge supports it. Such nitrogen typing is outside this ruleset.
        if (type===MolType.Ionic) {
          const negative=Number(l.type)===FeatureTypes.NegativeCharge?l:r;
          if (negative.atoms.every(i=>snapshot.atoms[i].element==='N' && !(snapshot.atoms[i].formalCharge!==null && snapshot.atoms[i].formalCharge!<0))) return;
        }
        const base={ligand:{residueId:target.id,atomIndices:l.atoms,role:role(l.type,'ligand')},receptor:{residueId:residueOf(r.atoms[0]).id,atomIndices:r.atoms,role:role(r.type,'receptor')},distanceAngstrom:distance,closestAtomPair:closest};
        const disordered=[...l.atoms,...r.atoms].some(i=>residueOf(i).preferredAltId!==null);
        if(type===MolType.PiStacking || type===MolType.CationPi) {
          const geometry=ringGeometry(positions,l.atoms,r.atoms,Number(l.type)===FeatureTypes.AromaticRing,Number(r.type)===FeatureTypes.AromaticRing);
          record({...base,type:type===MolType.PiStacking?'pi_stacking':'cation_pi',geometry,classification:type===MolType.PiStacking&&!disordered?'geometry_supported':'candidate',notes:['Aromatic ring / charged-group centroids and ring planes pass the Mol* distance, offset and orientation rules. Endpoint distance is the minimum atom-pair distance; centroid distance is reported separately.']});
        }
        else if(type===MolType.MetalCoordination) {
          const metal=base.ligand.role==='metal'?closest[0]:closest[1];
          record({...base,type:'metal_coordination',geometry:{metalElement:snapshot.atoms[metal].element},classification:'candidate',notes:['Metal identity and partner typing pass the Mol* distance rule. Reported partners/angles cover selected polymer chains; solvent and other ligand coordination are not a complete sphere or an oxidation-state assignment.']});
        }
        else if(type===MolType.Ionic) record({...base,type:'salt_bridge',classification:'candidate',notes:['Charge and protonation are assigned by the Mol* rules; solution pH is not modeled.']});
        else if(type===MolType.Hydrophobic) record({...base,type:'hydrophobic_contact',classification:disordered?'candidate':'geometry_supported',notes:['Nonpolar atom proximity; no interaction energy is calculated.']});
        else if(type===MolType.HydrogenBond) {
          const donor=Number(l.type)===FeatureTypes.HydrogenDonor?closest[0]:closest[1],acceptor=donor===closest[0]?closest[1]:closest[0];
          const hydrogen=[...(adjacency.get(donor) ?? [])].filter(i=>['H','D','T'].includes(snapshot.atoms[i].element)).sort((x,y)=>atomDistance(positions,x,acceptor)-atomDistance(positions,y,acceptor))[0];
          record({...base,type:'hydrogen_bond',classification:hydrogen!==undefined&&!disordered?'geometry_supported':'candidate',hydrogenMode:hydrogen===undefined?'implicit':'explicit',donorHydrogenAcceptorAngle:hydrogen===undefined?undefined:angleDegrees(positions,donor,hydrogen,acceptor),notes:[hydrogen===undefined?'Hydrogen position is absent; donor/acceptor and heavy-atom orientation rules were applied.':'Explicit hydrogen and donor/acceptor orientation rules were applied.']});
        }
      };
      // Generic noncovalent contact checks reject connected atoms, including deposited
      // metal-coordinate bonds. Reuse Mol* metal/partner features, but test these
      // single-atom pairs directly so a deposited coordination bond is not lost.
      const metalTypes = new Set<number>([FeatureTypes.TransitionMetal,FeatureTypes.IonicTypeMetal]);
      const partnerTypes = new Set<number>([FeatureTypes.DativeBondPartner,FeatureTypes.IonicTypePartner]);
      const ligandMetalFeatures: {unit:number;feature:number;atom:number;type:number}[] = [];
      const receptorMetalFeatures = new Map<number,{unit:number;feature:number;type:number}[]>();
      for (const unit of computed.unitsFeatures.keys()) { const f=computed.unitsFeatures.get(unit)!; for(let fi=0;fi<f.count;fi++) {
        const type = f.types[fi]; if(!metalTypes.has(type)&&!partnerTypes.has(type))continue;
        const atoms=feature(unit,fi).atoms; if(atoms.length!==1)continue;
        const atom=atoms[0];
        if(ligandSet.has(atom))ligandMetalFeatures.push({unit,feature:fi,atom,type});
        if(receptorSet.has(atom)) { if(!receptorMetalFeatures.has(atom))receptorMetalFeatures.set(atom,[]);receptorMetalFeatures.get(atom)!.push({unit,feature:fi,type}); }
      }
      }
      const metalGrid=new SpatialGrid(positions,[...receptorMetalFeatures.keys()],request.parameters.metalCutoff);
      const matchesMetal=(a:number,b:number)=>a===FeatureTypes.TransitionMetal&&b===FeatureTypes.DativeBondPartner || a===FeatureTypes.IonicTypeMetal&&b===FeatureTypes.IonicTypePartner;
      for(const a of ligandMetalFeatures)for(const near of metalGrid.neighbors(a.atom,request.parameters.metalCutoff))for(const b of receptorMetalFeatures.get(near.index)!) {
        if(matchesMetal(a.type,b.type)||matchesMetal(b.type,a.type))edge(a.unit,a.feature,b.unit,b.feature,MolType.MetalCoordination,0);
      }
      if(chemicalEnabled&&request.parameters.includeWaters) for(const bridge of computed.bridges) {
        if(bridge.props.flag&1)continue;
        const a=feature(bridge.unitA,bridge.indexA),b=feature(bridge.unitB,bridge.indexB),w=feature(bridge.unitM,bridge.indexMA);
        const [l,r]=a.atoms.every(i=>ligandSet.has(i))&&b.atoms.every(i=>receptorSet.has(i))?[a,b]:b.atoms.every(i=>ligandSet.has(i))&&a.atoms.every(i=>receptorSet.has(i))?[b,a]:[null,null];
        if(!l?.atoms.length||!r?.atoms.length||!w.atoms.length||!known.has(residueOf(r.atoms[0]).componentId)||incomplete.has(residueOf(r.atoms[0]).id))continue;
        const x=l.atoms[0],y=r.atoms[0],water=w.atoms[0];if(bonded(x,water)||bonded(y,water)||bonded(x,y))continue;
        record({type:'water_bridge',ligand:{residueId:target.id,atomIndices:l.atoms,role:Number(l.type)===FeatureTypes.HydrogenDonor?'donor':'acceptor'},receptor:{residueId:residueOf(y).id,atomIndices:r.atoms,role:Number(r.type)===FeatureTypes.HydrogenDonor?'donor':'acceptor'},mediator:{residueId:residueOf(water).id,atomIndices:w.atoms,role:'water'},distanceAngstrom:atomDistance(positions,x,y),closestAtomPair:[x,y],geometry:{waterLegDistancesAngstrom:[atomDistance(positions,x,water),atomDistance(positions,y,water)],waterAngleDegrees:angleDegrees(positions,x,water,y)},classification:'candidate',notes:['Deposited water oxygen mediates donor/acceptor contacts passing both leg and bridge-angle rules. Water hydrogen orientation/protonation remains uncertain. Mol* retains the shortest bridge per donor/acceptor feature pair. Distance in the table is ligand–receptor endpoint distance.']});
      }
      for(const e of computed.contacts.edges) edge(e.unitA,e.indexA,e.unitB,e.indexB,e.props.type,e.props.flag);
      for(const unitId of computed.unitsContacts.keys()) { const c=computed.unitsContacts.get(unitId)!; for(let j=0;j<c.a.length;j++) if(c.a[j]<c.b[j]) edge(unitId,c.a[j],unitId,c.b[j],c.edgeProps.type[j],c.edgeProps.flag[j]); }
    } finally { assets.dispose(); selected.customPropertyDescriptors.dispose(); }
  }
  const residueById=new Map(snapshot.residues.map(r=>[r.id,r]));
  interactions.sort((a,b)=>a.distanceAngstrom-b.distanceAngstrom||a.id.localeCompare(b.id));
  const metalGroups=new Map<number,{partners:Set<number>;interactions:MolecularInteraction[]}>();
  for(const interaction of interactions)if(interaction.type==='metal_coordination') {
    const metal=interaction.ligand.role==='metal'?interaction.closestAtomPair[0]:interaction.closestAtomPair[1];
    const group=metalGroups.get(metal) ?? {partners:new Set<number>(),interactions:[]};
    group.partners.add(interaction.closestAtomPair.find(a=>a!==metal)!);group.interactions.push(interaction);metalGroups.set(metal,group);
  }
  for(const [metal,group] of metalGroups) {
    const partners=[...group.partners],angles:number[]=[];
    // Implausibly dense inputs must not create an unbounded quadratic angle list.
    if(partners.length<=64)for(let i=0;i<partners.length;i++)for(let j=i+1;j<partners.length;j++) {
      const angle=angleDegrees(positions,partners[i],metal,partners[j]);if(angle!==undefined)angles.push(angle);
    }
    for(const interaction of group.interactions) {
      interaction.geometry={...interaction.geometry,selectedReceptorPartnerCount:partners.length,selectedReceptorAnglesDegrees:partners.length<=64?angles:undefined};
      if(partners.length>64)interaction.notes.push('Partner angles were not enumerated because this metal has more than 64 selected partners. All partner interactions and coordinates remain available.');
    }
  }
  const evaluation=Object.fromEntries(['proximity_contact','hydrogen_bond','hydrophobic_contact','salt_bridge','pi_stacking','cation_pi','metal_coordination','water_bridge','steric_clash'].map(type=>[type,{status:'not_evaluated'}])) as AnalysisRun['evaluation'];
  evaluation.proximity_contact={status:'evaluated'};
  evaluation.steric_clash={status:!supportedLigand.length||!supportedReceptor.length?'not_evaluated':supportedLigand.length<eligible.ligand.length||supportedReceptor.length<eligible.receptor.length?'partially_evaluated':'evaluated',reason:supportedLigand.length<eligible.ligand.length||supportedReceptor.length<eligible.receptor.length?'Metals and atoms without a published radius were excluded.':undefined};
  const reason=incomplete.has(target.id)?'Target heavy atoms are missing or excluded; only proximity, supported clashes and metal candidates are evaluated.':!request.parameters.classifyChemistry?'Chemical classification was disabled.':!chemicalEnabled?'Chemical definitions are unavailable for this target, or it is an ion.':unknown.length||incomplete.size?`Chemical typing was skipped for ${unknown.length} unknown components and ${incomplete.size} residues with missing/excluded expected heavy atoms.`:undefined;
  for(const type of ['hydrogen_bond','hydrophobic_contact','salt_bridge','pi_stacking','cation_pi','water_bridge'] as const) evaluation[type]={status:chemicalEnabled?(unknown.length||incomplete.size?'partially_evaluated':'evaluated'):'not_evaluated',reason};
  if(!request.parameters.includeWaters)evaluation.water_bridge={status:'not_evaluated',reason:'Deposited-water analysis was disabled.'};
  evaluation.metal_coordination={status:metalEnabled?(unknown.filter(c=>c!==target.componentId).length?'partially_evaluated':'evaluated'):'not_evaluated',reason:!metalEnabled?'Chemical classification was disabled.':unknown.filter(c=>c!==target.componentId).length?'Unknown receptor chemistry was skipped.':undefined};
  const generatedAt=new Date().toISOString(),key=analysisKey(snapshot,request,definitions);
  return {schemaVersion:2,id:crypto.randomUUID(),cacheKey:key,snapshotId:snapshot.id,sourceId:snapshot.sourceId,sourceHash:snapshot.provenance.contentHash,modelNumber:snapshot.modelNumber,assemblyId:snapshot.assemblyId,request,engineVersion:ENGINE_VERSION,ruleSetVersion:RULESET_VERSION,parserVersion:snapshot.provenance.parser,chemicalParameters:effectiveParams as unknown as Record<string,unknown>,chemistrySources,generatedAt,
    assumptions:['Coordinates are in Å and include the selected assembly transformations.','The selected ligand and polymer receptor chains define endpoints. Eligible deposited waters mediate bridges only when enabled. Other ligand/ion instances are excluded.','Missing atoms and hydrogens are not added. Zero and unknown occupancies are excluded. Standard amino acids and components with atom dictionaries are checked for missing eligible heavy atoms; incomplete endpoints are skipped for nonmetal chemical classification. Completeness of other components is not established.','Noncovalent pairs separated by one or two covalent bonds are excluded. Metal coordination candidates retain deposited coordinate-bond pairs.','Mol* infers connectivity/valence when deposited chemistry is incomplete. Standard residue templates treat ARG/LYS/HIS as positive and ASP/GLU as negative for ionic candidates.','Mol* contact refinement suppresses redundant hydrophobic contacts and hydrogen bonds overlapping ionic contacts. Negative nitrogen features require an explicit negative formal charge in this ruleset.','Distance measurements and chemical candidates do not estimate affinity or binding energy.'],
    qualityFlags:[...snapshot.provenance.qualityFlags,...[...incomplete].map(([id,atoms])=>{const r=residueById.get(id)!,c=snapshot.chains.find(c=>c.id===r.chainId)!;return `Missing/excluded heavy atoms in ${r.componentId} ${c.authAsymId}:${r.authSeqId ?? 'unnumbered'}${r.insertionCode ?? ''} (${c.operatorId}): ${atoms.join(', ')}. Nonmetal chemical classification skipped.`;}),...(unknown.length?[`Unknown component chemistry: ${unknown.join(', ')}.`]:[]),...(request.parameters.conformerPolicy==='preferred_residue'?['Preferred conformers are selected independently per residue. Compatibility across residues is unverified.']:[]),...(eligible.excludedDisorderedResidues?[`${eligible.excludedDisorderedResidues} disordered residues were excluded.`]:[]),...(eligible.excludedOccupancyAtoms?[`${eligible.excludedOccupancyAtoms} atoms were excluded by occupancy.`]:[])],
    evaluation,bindingSite:{ligandResidueId:target.id,residueIds:summarizeInteractions(interactions).residues.map(r=>r.residueId),definition:'computed_contact_union',cutoffsAngstrom:{proximity:request.parameters.proximityCutoff,hydrogenBond:request.parameters.hydrogenBondCutoff,hydrophobic:request.parameters.hydrophobicCutoff,saltBridge:request.parameters.saltBridgeCutoff,piStacking:request.parameters.piStackingCutoff,cationPi:request.parameters.cationPiCutoff,metal:request.parameters.metalCutoff,waterLegMax:request.parameters.waterLegMax,clashOverlapMin:request.parameters.clashOverlapMin}},stats:{ligandAtomCount:eligible.ligand.length,receptorAtomCount:eligible.receptor.length,waterAtomCount:eligible.waters.length,excludedDisorderedResidues:eligible.excludedDisorderedResidues,excludedOccupancyAtoms:eligible.excludedOccupancyAtoms,excludedBondedPairs,elapsedMilliseconds:performance.now()-started},interactions,...summarizeInteractions(interactions),bonds};
}
