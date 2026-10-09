import { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { StructureMetadata, StructureSource } from '../domain/types';
import { cacheSource, getCachedSource } from './repository';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60 * 60 * 1000, retry: 1 } } });
export const samples = [
  { id: '3PTB', name: 'Trypsin · benzamidine', description: 'A small protein–ligand complex', title: 'BETA-TRYPSIN', method: 'X-RAY DIFFRACTION', resolution: 1.7 },
  { id: '4HHB', name: 'Human hemoglobin', description: 'Four protein chains and heme groups', title: 'THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN AT 1.74 ANGSTROMS RESOLUTION', method: 'X-RAY DIFFRACTION', resolution: 1.74 },
];
const metadataSchema = z.object({
  struct: z.object({ title: z.string() }).optional(),
  exptl: z.array(z.object({ method: z.string() })).optional(),
  rcsb_entry_info: z.object({ resolution_combined: z.array(z.number()).nullable().optional() }).optional(),
});
export function normalizeAccession(input: string) {
  const id = input.trim().toUpperCase();
  if (!/^(?:[0-9][A-Z0-9]{3}|PDB_[A-Z0-9]{8})$/.test(id)) throw new Error('Enter a PDB accession such as 3PTB or 4HHB.');
  return id;
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function makeSource(bytes: Uint8Array, properties: Omit<StructureSource, 'bytes' | 'contentHash' | 'fetchedAt' | 'format'>): Promise<StructureSource> {
  if (bytes.byteLength > 40 * 1024 * 1024) throw new Error('Please use a coordinate file smaller than 40 MB.');
  if (!bytes.byteLength) throw new Error('The coordinate file is empty.');
  return { ...properties, bytes, contentHash: await hashBytes(bytes), fetchedAt: new Date().toISOString(), format: 'mmcif' };
}
async function fetchCoordinates(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(response.status === 404 ? 'No coordinates found for this accession.' : `Coordinate download failed (${response.status}). Try again or open a local file.`);
  const length = Number(response.headers.get('content-length'));
  if (length > 40 * 1024 * 1024) throw new Error('This coordinate file exceeds the 40 MB limit.');
  return new Uint8Array(await response.arrayBuffer());
}
export async function loadPdb(input: string, signal: AbortSignal): Promise<StructureSource> {
  const id = normalizeAccession(input);
  const cached = await getCachedSource(id).catch(() => undefined);
  if (cached) return cached;
  const sample = samples.find(s => s.id === id);
  const url = sample ? `${import.meta.env.BASE_URL}structures/${id}.cif` : `https://files.rcsb.org/download/${id}.cif`;
  const bytes = await fetchCoordinates(url, signal);
  const metadata: StructureMetadata | undefined = sample ? { title: sample.title, method: sample.method, resolution: sample.resolution } : undefined;
  return makeSource(bytes, { id, name: `${id}.cif`, kind: sample ? 'sample' : 'pdb', binary: false, url: sample ? `https://files.rcsb.org/download/${id}.cif` : url, metadata });
}
export async function loadLocalFile(file: File): Promise<StructureSource> {
  if (!/\.(?:cif|mmcif|bcif)$/i.test(file.name)) throw new Error('Choose an mmCIF (.cif / .mmcif) or BinaryCIF (.bcif) coordinate file.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Please use a coordinate file smaller than 40 MB.');
  return makeSource(new Uint8Array(await file.arrayBuffer()), { id: `local:${file.name}`, name: file.name, kind: 'local', binary: /\.bcif$/i.test(file.name) });
}
export async function getMetadata(id: string, signal?: AbortSignal): Promise<StructureMetadata> {
  return queryClient.fetchQuery({ queryKey: ['metadata', id], queryFn: async () => {
    const response = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${id}`, { signal });
    if (!response.ok) throw new Error('Structure metadata is unavailable.');
    const data = metadataSchema.parse(await response.json());
    return { title: data.struct?.title ?? id, method: data.exptl?.[0]?.method, resolution: data.rcsb_entry_info?.resolution_combined?.[0] };
  } });
}
export { cacheSource };
