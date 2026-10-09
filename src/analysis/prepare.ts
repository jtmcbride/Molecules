import { CIF } from 'molstar/lib/mol-io/reader/cif';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif';
import { Structure, StructureSymmetry } from 'molstar/lib/mol-model/structure';
import { Task } from 'molstar/lib/mol-task';
import { ComponentBond } from 'molstar/lib/mol-model-formats/structure/property/bonds/chem_comp';
import { Table } from 'molstar/lib/mol-data/db';
import { mmCIF_Schema } from 'molstar/lib/mol-io/reader/cif/schema/mmcif';
import type { ChemicalDefinition } from '../domain/analysis';
import type { StructureSource } from '../domain/types';
import { extractSnapshot } from '../structure/extract';

export async function prepareStructure(source: StructureSource, modelIndex: number, assemblyId: string, definitions: ChemicalDefinition[] = []) {
  const parsed = await CIF.parse(source.binary ? source.bytes : new TextDecoder().decode(source.bytes)).run();
  if (parsed.isError) throw new Error(`Coordinate parsing failed: ${parsed.message}`);
  const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0]).run();
  const frame = trajectory.getFrameAtIndex(modelIndex);
  const model = Task.is(frame) ? await frame.run() : frame;
  const expectedHeavyAtomNames: Record<string,string[]> = {};
  const readExpectedAtoms = (table: ReturnType<typeof CIF.schema.CCD>['chem_comp_atom']) => {
    for(let i=0;i<table._rowCount;i++)if(!['H','D','T'].includes(table.type_symbol.value(i).toUpperCase())) {
      const component=table.comp_id.value(i);
      (expectedHeavyAtomNames[component] ??= []).push(table.atom_id.value(i));
    }
  };
  readExpectedAtoms(CIF.schema.CCD(parsed.result.blocks[0]).chem_comp_atom);
  const embedded = ComponentBond.Provider.get(model);
  const tables = embedded ? [embedded.data] : [];
  const rejected: string[] = [], appliedChemicalDefinitionHashes: string[] = [];
  for (const definition of definitions) {
    try {
      const data = await CIF.parse(new TextDecoder().decode(definition.bytes)).run();
      if (data.isError) throw new Error(`Invalid chemical definition for ${definition.componentId}.`);
      const table = CIF.schema.mmCIF(data.result.blocks[0]).chem_comp_bond;
      if (!table._rowCount || Array.from({length:table._rowCount},(_,i)=>table.comp_id.value(i)).some(id=>id!==definition.componentId)) throw new Error(`Chemical definition does not match ${definition.componentId}.`);
      const atoms=CIF.schema.CCD(data.result.blocks[0]).chem_comp_atom;
      if(Array.from({length:atoms._rowCount},(_,i)=>atoms.comp_id.value(i)).some(id=>id!==definition.componentId))throw new Error(`Chemical atom definition does not match ${definition.componentId}.`);
      readExpectedAtoms(atoms);
      tables.push(table);
      appliedChemicalDefinitionHashes.push(definition.contentHash);
    } catch (error) { rejected.push(`Rejected optional chemistry ${definition.componentId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (tables.length) {
    const data = Table.concat(tables, mmCIF_Schema.chem_comp_bond);
    ComponentBond.Provider.set(model, { data, entries: ComponentBond.getEntriesFromChemCompBond(data) });
  }
  let structure = Structure.ofModel(model);
  if (assemblyId) structure = await StructureSymmetry.buildAssembly(structure, assemblyId).run();
  const extracted = extractSnapshot(structure, source, modelIndex, assemblyId);
  extracted.snapshot.provenance.qualityFlags.push(...rejected);
  extracted.snapshot.chemistry.appliedChemicalDefinitionHashes=appliedChemicalDefinitionHashes;
  extracted.snapshot.chemistry.expectedHeavyAtomNames=Object.fromEntries(Object.entries(expectedHeavyAtomNames).map(([id,names])=>[id,[...new Set(names)]]));
  return { structure, ...extracted };
}
