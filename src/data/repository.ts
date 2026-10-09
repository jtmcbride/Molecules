import Dexie, { type EntityTable } from 'dexie';
import type { AnalysisRun, ChemicalDefinition } from '../domain/analysis';
import type { SessionDescriptor, StructureSource } from '../domain/types';

class ExplorerDatabase extends Dexie {
  sources!: EntityTable<StructureSource, 'contentHash'>;
  sessions!: EntityTable<{ id: string; descriptor: SessionDescriptor }, 'id'>;
  analyses!: EntityTable<AnalysisRun, 'cacheKey'>;
  chemicalDefinitions!: EntityTable<ChemicalDefinition, 'componentId'>;
  constructor() {
    super('molecular-explorer');
    this.version(1).stores({ sources: 'contentHash, id, fetchedAt', sessions: 'id' });
    this.version(2).stores({ sources: 'contentHash, id, fetchedAt', sessions: 'id', analyses: 'cacheKey, sourceHash, generatedAt', chemicalDefinitions: 'componentId' });
  }
}
export const database = new ExplorerDatabase();
export async function cacheSource(source: StructureSource) { await database.sources.put(source); }
export async function getCachedSource(id: string) { return database.sources.where('id').equals(id).last(); }
export async function saveSession(descriptor: SessionDescriptor) { await database.sessions.put({ id: 'last', descriptor }); }
export async function getLastSession() {
  const session = await database.sessions.get('last');
  if (!session || session.descriptor.schemaVersion !== 1) return null;
  const source = await database.sources.get(session.descriptor.sourceHash);
  return source ? { source, descriptor: session.descriptor } : null;
}
