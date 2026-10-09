import { XMLParser, XMLValidator } from "fast-xml-parser";
import { discoverySchema } from "./biologySchemas";
import type { MappingSegment, SiftsRow } from "../domain/biology";
export function parseDiscovery(
  value: unknown,
  entryId: string,
): MappingSegment[] {
  const entries = discoverySchema.parse(value),
    entry = entries[entryId.toLowerCase()];
  if (!entry)
    throw Error("SIFTS discovery did not match the selected PDB entry.");
  return Object.entries(entry.UniProt ?? {}).flatMap(([accession, protein]) =>
    protein.mappings.map((m) => ({
      accession,
      labelAsymId: m.struct_asym_id,
      authChain: m.chain_id,
      entityId: String(m.entity_id),
      start: m.start.residue_number,
      end: m.end.residue_number,
      uniprotStart: m.unp_start,
      uniprotEnd: m.unp_end,
    })),
  );
}
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
interface Ref {
  dbSource: string;
  dbAccessionId: string;
  dbResNum: string;
  dbResName: string;
  dbChainId?: string;
}
interface XmlResidue {
  dbResNum: string;
  dbResName: string;
  crossRefDb?: Ref | Ref[];
  residueDetail?:
    | { property?: string; "#text"?: string }
    | { property?: string; "#text"?: string }[];
}
export function parseSiftsXml(
  xml: string,
  entryId: string,
): { rows: SiftsRow[]; release?: string } {
  if (xml.length > 50 * 1024 * 1024)
    throw Error("The decompressed SIFTS file exceeds 50 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw Error("Invalid SIFTS XML.");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const entry = parsed.entry;
  if (
    !entry ||
    String(entry.dbAccessionId).toLowerCase() !== entryId.toLowerCase()
  )
    throw Error("SIFTS residue file did not match the selected PDB entry.");
  const rows: SiftsRow[] = [];
  for (const entity of array<{ segment?: unknown }>(entry.entity))
    for (const segment of array<{
      listResidue?: { residue?: XmlResidue | XmlResidue[] };
    }>(entity.segment as never))
      for (const residue of array(segment.listResidue?.residue)) {
        const refs = array(residue.crossRefDb),
          pdb = refs.find(
            (r) =>
              r.dbSource === "PDB" &&
              typeof r.dbAccessionId === "string" &&
              r.dbAccessionId.toLowerCase() === entryId.toLowerCase(),
          );
        if (!pdb?.dbChainId) continue;
        for (const uniprot of refs.filter((r) => r.dbSource === "UniProt")) {
          const pdbePosition = Number(residue.dbResNum),
            uniprotPosition = Number(uniprot.dbResNum);
          if (
            !Number.isInteger(pdbePosition) ||
            pdbePosition < 1 ||
            !Number.isInteger(uniprotPosition) ||
            uniprotPosition < 1
          )
            continue;
          rows.push({
            pdbePosition,
            authChain: pdb.dbChainId,
            authNumber: ["null", "?", ".", ""].includes(pdb.dbResNum)
              ? null
              : pdb.dbResNum,
            componentId: pdb.dbResName || residue.dbResName,
            notObserved: array(residue.residueDetail).some(
              (d) => d["#text"] === "Not_Observed",
            ),
            accession: uniprot.dbAccessionId,
            uniprotPosition,
            uniprotResidue: uniprot.dbResName,
          });
          if (rows.length > 500_000)
            throw Error("SIFTS mapping exceeds the residue limit.");
        }
      }
  return { rows, release: entry.date };
}
export async function decompressSifts(bytes: Uint8Array): Promise<string> {
  if (bytes.length > 10 * 1024 * 1024)
    throw Error("Compressed SIFTS file exceeds 10 MB.");
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    throw Error("Expected a gzip SIFTS residue file.");
  if (typeof DecompressionStream === "undefined")
    throw Error(
      "This browser cannot decompress SIFTS files. Use a current Chrome, Firefox, Edge or Safari browser.",
    );
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 50 * 1024 * 1024)
        throw Error("The decompressed SIFTS file exceeds 50 MB.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(output);
}
