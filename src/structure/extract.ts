import { Structure, StructureElement, StructureProperties as P, Unit } from 'molstar/lib/mol-model/structure';
import { MmcifFormat } from 'molstar/lib/mol-model-formats/structure/mmcif';
import { identity, optionalCifString, choosePreferredConformer } from '../domain/identity';
import type { AtomRecord, ChainRecord, LigandInstance, ResidueRecord, StructureSnapshot, StructureSource } from '../domain/types';
import molstarPackage from 'molstar/package.json';
import { ComponentBond } from 'molstar/lib/mol-model-formats/structure/property/bonds/chem_comp';

export interface SelectionIndex {
  residueByLocation: Map<string, string>;
  locationsByResidue: Map<string, { unitId: number; element: number; unitIndex: number }[]>;
  locationsByAtom: { unitId: number; element: number; unitIndex: number }[];
}
export function extractSnapshot(structure: Structure, source: StructureSource, modelIndex: number, assemblyId: string): { snapshot: StructureSnapshot; selectionIndex: SelectionIndex } {
  if (structure.elementCount > 250_000) throw new Error('This explorer supports up to 250,000 atoms. Choose the asymmetric unit or a smaller structure.');
  const model = structure.models[0];
  const snapshotId = identity(source.contentHash, model.modelNum, assemblyId);
  const chains: ChainRecord[] = [];
  const residues: ResidueRecord[] = [];
  const atoms: AtomRecord[] = [];
  const ligands: LigandInstance[] = [];
  const chainMap = new Map<string, number>();
  const residueMap = new Map<string, number>();
  const positions: number[] = [], residueIndices: number[] = [], occupancies: number[] = [], bFactors: number[] = [];
  const selectionIndex: SelectionIndex = { residueByLocation: new Map(), locationsByResidue: new Map(), locationsByAtom: [] };
  const loc = StructureElement.Location.create(structure);
  const qualityFlags = new Set<string>();
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) { qualityFlags.add('Coarse-grained elements are not included in atomic exploration.'); continue; }
    loc.unit = unit;
    for (let unitIndex = 0; unitIndex < unit.elements.length; unitIndex++) {
      const element = unit.elements[unitIndex];
      loc.element = element;
      const operator = unit.conformation.operator;
      const chainId = identity(snapshotId, P.chain.label_asym_id(loc), operator.instanceId);
      let chainIndex = chainMap.get(chainId);
      if (chainIndex === undefined) {
        chainIndex = chains.length;
        const entityKey = P.entity.key(loc);
        const seq = unit.model.sequence.byEntityKey[entityKey]?.sequence;
        const chain: ChainRecord = {
          id: chainId, labelAsymId: P.chain.label_asym_id(loc), authAsymId: P.chain.auth_asym_id(loc),
          entityId: P.chain.label_entity_id(loc), type: P.entity.type(loc),
          description: P.entity.pdbx_description(loc).join(', '), operatorId: operator.instanceId,
          operatorIds: [...(operator.assembly?.operList ?? [])], transform: Array.from(operator.matrix), residueIds: [],
          sequence: seq ? Array.from({ length: seq.length }, (_, i) => ({ labelSeqId: seq.seqId.value(i), componentId: seq.compId.value(i), code: seq.code.value(i), residueIds: [] })) : [],
        };
        chains.push(chain); chainMap.set(chainId, chainIndex);
      }
      const sourceResidueIndex = P.residue.key(loc);
      const residueId = identity(chainId, sourceResidueIndex, P.residue.label_comp_id(loc));
      let residueIndex = residueMap.get(residueId);
      const sourceRow = P.atom.sourceIndex(loc);
      const db = MmcifFormat.is(unit.model.sourceData) ? unit.model.sourceData.data.db : undefined;
      if (residueIndex === undefined) {
        residueIndex = residues.length;
        const componentId = P.residue.label_comp_id(loc);
        const entityType = P.entity.type(loc);
        const subtype = P.entity.subtype(loc);
        const kind: ResidueRecord['kind'] = entityType === 'polymer' ? 'polymer' : entityType === 'water' ? 'water' : entityType === 'branched' ? 'branched' : subtype === 'ion' ? 'ion' : 'ligand';
        const labelSeqId = db && db.atom_site.label_seq_id.valueKind(sourceRow) === 0 ? db.atom_site.label_seq_id.value(sourceRow) : null;
        const rawAuth = db?.atom_site.auth_seq_id;
        const rawAuthField = MmcifFormat.is(unit.model.sourceData) ? unit.model.sourceData.data.frame.categories.atom_site?.getField('auth_seq_id') : undefined;
        const authSeqId = rawAuth && rawAuth.valueKind(sourceRow) === 0 ? optionalCifString(rawAuthField?.str(sourceRow) ?? String(rawAuth.value(sourceRow))) : null;
        const residue: ResidueRecord = {
          id: residueId, chainId, componentId, labelSeqId, authSeqId,
          insertionCode: optionalCifString(P.residue.pdbx_PDB_ins_code(loc)), sourceResidueIndex,
          kind, atomIndices: [], preferredAltId: null,
        };
        residues.push(residue); residueMap.set(residueId, residueIndex);
        chains[chainIndex].residueIds.push(residueId);
        if (kind === 'ligand' || kind === 'ion' || kind === 'branched') ligands.push({ id: identity(residueId, 'ligand'), residueId, componentId, description: chains[chainIndex].description, kind });
        selectionIndex.locationsByResidue.set(residueId, []);
      }
      const x = unit.conformation.x(element), y = unit.conformation.y(element), z = unit.conformation.z(element);
      if (db && [db.atom_site.Cartn_x, db.atom_site.Cartn_y, db.atom_site.Cartn_z].some(column => column.valueKind(sourceRow) !== 0)) throw new Error('Some atoms have missing coordinates. Please use a complete atomic coordinate file.');
      if (![x, y, z].every(Number.isFinite)) throw new Error('The structure contains invalid coordinates and cannot be explored safely.');
      const atomIndex = atoms.length;
      atoms.push({
        id: identity(residueId, sourceRow, optionalCifString(P.atom.label_alt_id(loc))),
        name: P.atom.label_atom_id(loc), element: P.atom.type_symbol(loc), altId: optionalCifString(P.atom.label_alt_id(loc)), sourceRow,
        formalCharge: db?.atom_site.pdbx_formal_charge.valueKind(sourceRow) === 0 ? db.atom_site.pdbx_formal_charge.value(sourceRow) : null,
      });
      positions.push(x, y, z); residueIndices.push(residueIndex);
      occupancies.push(db?.atom_site.occupancy.valueKind(sourceRow) === 0 ? P.atom.occupancy(loc) : Number.NaN);
      bFactors.push(db?.atom_site.B_iso_or_equiv.valueKind(sourceRow) === 0 ? P.atom.B_iso_or_equiv(loc) : Number.NaN);
      residues[residueIndex].atomIndices.push(atomIndex);
      selectionIndex.residueByLocation.set(`${unit.id}:${element}`, residueId);
      selectionIndex.locationsByResidue.get(residueId)!.push({ unitId: unit.id, element, unitIndex });
      selectionIndex.locationsByAtom.push({ unitId: unit.id, element, unitIndex });
    }
  }
  if (!atoms.length) throw new Error('No atomic coordinates were found. Coarse-grained models are not supported by this explorer.');
  const preferredIndices: number[] = [];
  for (const residue of residues) {
    const preferred = choosePreferredConformer(residue.atomIndices.map(index => ({ index, name: atoms[index].name, altId: atoms[index].altId, occupancy: occupancies[index] })));
    residue.preferredAltId = preferred.preferredAltId;
    preferredIndices.push(...preferred.indices);
    if (preferred.preferredAltId) qualityFlags.add('Alternate conformers are displayed as deposited. A residue-level preferred conformer is recorded for analysis; cross-residue compatibility is unverified.');
  }
  for (const chain of chains) {
    if (chain.type !== 'polymer') continue;
    const byPosition = new Map(chain.sequence.map(p => [p.labelSeqId, p]));
    for (const id of chain.residueIds) {
      const residue = residues[residueMap.get(id)!];
      if (residue.labelSeqId !== null) byPosition.get(residue.labelSeqId)?.residueIds.push(id);
    }
    if (chain.sequence.some(p => !p.residueIds.length)) qualityFlags.add('Some deposited sequence positions have no observed atomic coordinates.');
  }
  if (occupancies.some(o => !Number.isFinite(o))) qualityFlags.add('Some occupancies are unspecified.');
  return {
    selectionIndex,
    snapshot: {
      id: snapshotId, sourceId: source.id, modelIndex, modelNumber: model.modelNum, assemblyId,
      chains, residues, atoms, ligands,
      chemistry: { embeddedBondComponentIds: [...(ComponentBond.Provider.get(model)?.entries.keys() ?? [])].filter(Boolean).sort() },
      atomBuffer: { positions: new Float32Array(positions), residueIndices: new Uint32Array(residueIndices), occupancies: new Float32Array(occupancies), bFactors: new Float32Array(bFactors), preferredAtomIndices: new Uint32Array(preferredIndices), atomCount: atoms.length },
      provenance: { schemaVersion: 1, contentHash: source.contentHash, parser: `Mol* ${molstarPackage.version}`, createdAt: new Date().toISOString(), coordinateFrame: 'assembly', conformerPolicy: 'residue-mean-occupancy-v1', qualityFlags: [...qualityFlags] },
    },
  };
}
