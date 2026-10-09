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
  const embedded = ComponentBond.Provider.get(model);
  const tables = embedded ? [embedded.data] : [];
  for (const definition of definitions) {
    const data = await CIF.parse(new TextDecoder().decode(definition.bytes)).run();
    if (data.isError) throw new Error(`Invalid chemical definition for ${definition.componentId}.`);
    const table = CIF.schema.mmCIF(data.result.blocks[0]).chem_comp_bond;
    if (!table._rowCount || table.comp_id.value(0) !== definition.componentId) throw new Error(`Chemical definition does not match ${definition.componentId}.`);
    tables.push(table);
  }
  if (tables.length) {
    const data = Table.concat(tables, mmCIF_Schema.chem_comp_bond);
    ComponentBond.Provider.set(model, { data, entries: ComponentBond.getEntriesFromChemCompBond(data) });
  }
  let structure = Structure.ofModel(model);
  if (assemblyId) structure = await StructureSymmetry.buildAssembly(structure, assemblyId).run();
  return { structure, ...extractSnapshot(structure, source, modelIndex, assemblyId) };
}
