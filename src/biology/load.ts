import {
  BIOLOGY_VERSION,
  type InterpretationSnapshot,
  type ResourceSnapshot,
} from "../domain/biology";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import {
  biologyResource,
  discoveryRequest,
  siftsRequest,
  uniprotRequest,
} from "../data/biologyResources";
import { decompressSifts, parseDiscovery, parseSiftsXml } from "../data/sifts";
import { parseUniProt } from "../data/uniprot";
import { hashBytes } from "../data/provider";
import { database } from "../data/repository";
import { resourceEvidence, structureEvidence } from "./evidence";
import { mapResidues } from "./mapping";
import { projectAnnotations } from "./projection";
export async function loadInterpretation(
  source: StructureSource,
  snapshot: StructureSnapshot,
  entryId: string,
  signal: AbortSignal,
  refresh = false,
  progress: (s: string) => void = () => {},
) {
  if (!/^[0-9][A-Z0-9]{3}$/.test(entryId))
    throw Error(
      "SIFTS annotation currently supports four-character PDB accessions.",
    );
  const nonce = crypto.randomUUID();
  progress("Loading SIFTS residue correspondence");
  const [discovery, xml] = await Promise.all([
    biologyResource(discoveryRequest(entryId), signal, nonce, refresh),
    biologyResource(siftsRequest(entryId), signal, nonce, refresh),
  ]);
  signal.throwIfAborted();
  const segments = parseDiscovery(
    JSON.parse(new TextDecoder().decode(discovery.resource.bytes)),
    entryId,
  );
  const sifts = parseSiftsXml(
    await decompressSifts(xml.resource.bytes),
    entryId,
  );
  const xmlResource = { ...xml.resource, release: sifts.release };
  const relevant = segments.filter((s) =>
    snapshot.chains.some(
      (c) =>
        c.type === "polymer" &&
        s.labelAsymId === c.labelAsymId &&
        s.entityId === c.entityId &&
        s.authChain === c.authAsymId,
    ),
  );
  const accessions = [...new Set(relevant.map((s) => s.accession))];
  if (!accessions.length)
    throw Error(
      "No SIFTS protein mapping was found for these deposited chains.",
    );
  if (accessions.length > 32)
    throw Error(
      "This entry maps to more than 32 proteins. Use a smaller structure for annotations.",
    );
  const resources: ResourceSnapshot[] = [discovery.resource, xmlResource],
    modes = [discovery.mode, xml.mode];
  const proteins: InterpretationSnapshot["proteins"] = [],
    annotations: InterpretationSnapshot["annotations"] = [],
    evidence: InterpretationSnapshot["evidence"] = [
      resourceEvidence(discovery.resource),
      resourceEvidence(xmlResource),
      structureEvidence(snapshot, source),
    ],
    qualityFlags: string[] = [];
  progress("Loading UniProt sequences and functional features");
  // Four requests at a time; deduplicated accessions prevent repeated-chain fetches.
  for (let offset = 0; offset < accessions.length; offset += 4) {
    const results = await Promise.all(
      accessions.slice(offset, offset + 4).map(async (accession) => {
        try {
          const result = await biologyResource(
            uniprotRequest(accession),
            signal,
            nonce,
            refresh,
          );
          const parsed = await parseUniProt(
            JSON.parse(new TextDecoder().decode(result.resource.bytes)),
            accession,
            result.resource,
          );
          return { result, parsed };
        } catch (error) {
          signal.throwIfAborted();
          return {
            error: `${accession}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
    );
    signal.throwIfAborted();
    for (const result of results)
      if (result.error) qualityFlags.push(result.error);
      else if (result.parsed && result.result) {
        proteins.push(result.parsed.protein);
        annotations.push(...result.parsed.annotations);
        evidence.push(...result.parsed.evidence);
        resources.push(result.result.resource);
        modes.push(result.result.mode);
      }
  }
  if (!proteins.length)
    throw Error(
      `Protein annotations are unavailable. ${qualityFlags.join(" ")}`,
    );
  const mapped = mapResidues(snapshot, segments, sifts.rows, proteins, [
    resourceEvidence(discovery.resource).id,
    resourceEvidence(xmlResource).id,
  ]);
  // Local associations must pass full deposited-chain sequence/numbering checks;
  // a short coincidental match or a misleading entry ID is insufficient.
  if (source.kind === "local")
    for (const chain of snapshot.chains.filter((c) => c.type === "polymer")) {
      const coverage = mapped.coverage.find(
        (c) => c.chainInstanceId === chain.id,
      )!;
      const expectedLength = Math.max(
        0,
        ...relevant
          .filter((s) => s.labelAsymId === chain.labelAsymId)
          .map((s) => s.end),
      );
      if (
        coverage.total !== expectedLength ||
        coverage.total < 10 ||
        coverage.exact !== coverage.total
      )
        throw Error(
          `Local chain ${chain.authAsymId} could not be validated against ${entryId}. Annotations were not attached.`,
        );
    }
  qualityFlags.push(
    ...mapped.qualityFlags,
    ...annotations.flatMap((a) => a.qualityFlags),
  );
  if (modes.includes("stale"))
    qualityFlags.push(
      "Scientific services were unavailable; cached biological source snapshots are being used.",
    );
  signal.throwIfAborted();
  const interpretation: InterpretationSnapshot = {
    schemaVersion: 1,
    id: await hashBytes(
      new TextEncoder().encode(
        JSON.stringify([
          BIOLOGY_VERSION,
          snapshot.id,
          entryId,
          resources.map((r) => r.id),
        ]),
      ),
    ),
    version: BIOLOGY_VERSION,
    snapshotId: snapshot.id,
    sourceHash: source.contentHash,
    entryId,
    createdAt: new Date().toISOString(),
    resourceIds: resources.map((r) => r.id),
    resourceRefs: resources.map(({ bytes, ...ref }) => ref),
    proteins,
    annotations,
    mappings: mapped.mappings,
    coverage: mapped.coverage,
    projections: projectAnnotations(annotations, mapped.mappings),
    evidence,
    qualityFlags,
  };
  let persisted = true;
  await database
    .transaction(
      "rw",
      database.biologyResources,
      database.proteins,
      database.interpretations,
      async () => {
        await database.biologyResources.bulkPut(resources);
        await database.proteins.bulkPut(proteins);
        await database.interpretations.put(interpretation);
      },
    )
    .catch(() => {
      persisted = false;
    });
  signal.throwIfAborted();
  return {
    interpretation,
    mode: modes.includes("stale")
      ? "stale"
      : modes.every((m) => m === "cached")
        ? "cached"
        : "fresh",
    persisted,
  };
}
