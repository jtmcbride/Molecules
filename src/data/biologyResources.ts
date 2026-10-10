import { database } from "./repository";
import { hashBytes, queryClient } from "./provider";
import type { ResourceSnapshot } from "../domain/biology";
export const BIOLOGY_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
interface ResourceRequest {
  key: string;
  provider: ResourceSnapshot["provider"];
  identifier: string;
  url: string;
  limit: number;
}
class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number,
  ) {
    super(`Annotation service returned HTTP ${status}.`);
  }
}
async function boundedBytes(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit)
    throw Error("Annotation response exceeds the size limit.");
  if (!response.body) throw Error("Annotation response is empty.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw Error("Annotation response exceeds the size limit.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function biologyResource(
  request: ResourceRequest,
  signal: AbortSignal,
  nonce: string,
  refresh = false,
) {
  const cached = await database.biologyResources
    .where("key")
    .equals(request.key)
    .sortBy("retrievedAt")
    .then((rows) => rows.at(-1))
    .catch(() => undefined);
  signal.throwIfAborted();
  if (
    cached &&
    !refresh &&
    Date.now() - Date.parse(cached.retrievedAt) < BIOLOGY_FRESHNESS_MS
  )
    return { resource: cached, mode: "cached" as const };
  try {
    const resource = await queryClient.fetchQuery({
      queryKey: ["biology", request.key, nonce],
      retry: (count, error) =>
        count < 2 &&
        !signal.aborted &&
        (error instanceof HttpFailure
          ? error.status === 429 || error.status >= 500
          : error instanceof TypeError),
      retryDelay: (_count, error) =>
        error instanceof HttpFailure
          ? Math.min(20_000, Math.max(1000, error.retryAfter))
          : 1000,
      queryFn: async () => {
        signal.throwIfAborted();
        const timeout = AbortSignal.timeout(20_000),
          combined = AbortSignal.any([signal, timeout]);
        const response = await fetch(request.url, { signal: combined });
        if (!response.ok) {
          const retry = response.headers.get("retry-after"),
            seconds = Number(retry);
          throw new HttpFailure(
            response.status,
            Number.isFinite(seconds)
              ? seconds * 1000
              : retry
                ? Math.max(0, Date.parse(retry) - Date.now())
                : 0,
          );
        }
        const bytes = await boundedBytes(response, request.limit);
        signal.throwIfAborted();
        const contentHash = await hashBytes(bytes),
          retrievedAt = new Date().toISOString();
        return {
          ...request,
          id: JSON.stringify([request.key, contentHash, retrievedAt]),
          contentHash,
          retrievedAt,
          bytes,
          release: response.headers.get("x-uniprot-release") ?? undefined,
        };
      },
    });
    signal.throwIfAborted();
    return { resource, mode: "fresh" as const };
  } catch (error) {
    signal.throwIfAborted();
    if (cached && !refresh) return { resource: cached, mode: "stale" as const };
    throw error;
  }
}
export const discoveryRequest = (id: string): ResourceRequest => ({
  key: `sifts:discovery:${id}`,
  provider: "SIFTS",
  identifier: id,
  url: `https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${id.toLowerCase()}`,
  limit: 5 * 1024 * 1024,
});
export const siftsRequest = (id: string): ResourceRequest => ({
  key: `sifts:residues:${id}`,
  provider: "SIFTS",
  identifier: id,
  url: `https://ftp.ebi.ac.uk/pub/databases/msd/sifts/xml/${id.toLowerCase()}.xml.gz`,
  limit: 10 * 1024 * 1024,
});
export function uniprotRequest(accession: string): ResourceRequest {
  if (!/^[A-Z0-9]{6,10}(?:-\d+)?$/.test(accession))
    throw Error("Unsupported UniProt accession.");
  return {
    key: `uniprot:${accession}`,
    provider: "UniProt",
    identifier: accession,
    url: `https://rest.uniprot.org/uniprotkb/${accession}.json`,
    limit: 10 * 1024 * 1024,
  };
}
export function chemCompRequest(componentId: string): ResourceRequest {
  if (!/^[A-Z0-9]{1,5}$/.test(componentId))
    throw Error("Unsupported chemical component identifier.");
  return {
    key: `rcsb:chemcomp:${componentId}`,
    provider: "RCSB",
    identifier: componentId,
    url: `https://data.rcsb.org/rest/v1/core/chemcomp/${componentId}`,
    limit: 2 * 1024 * 1024,
  };
}
export function ligandFitRequest(
  entryId: string,
  labelAsymId: string,
): ResourceRequest {
  if (
    !/^[0-9][A-Z0-9]{3}$/.test(entryId) ||
    !/^[A-Za-z0-9]{1,4}$/.test(labelAsymId)
  )
    throw Error("Unsupported ligand instance identifier.");
  return {
    key: `rcsb:ligand-instance:${entryId}:${labelAsymId}`,
    provider: "RCSB",
    identifier: `${entryId}.${labelAsymId}`,
    url: `https://data.rcsb.org/rest/v1/core/nonpolymer_entity_instance/${entryId}/${labelAsymId}`,
    limit: 2 * 1024 * 1024,
  };
}
