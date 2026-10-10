import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prepareStructure } from "../../src/analysis/prepare";
import {
  parseDiscovery,
  decompressSifts,
  parseSiftsXml,
} from "../../src/data/sifts";
import { parseUniProt } from "../../src/data/uniprot";
import { mapResidues } from "../../src/biology/mapping";
import { projectAnnotations } from "../../src/biology/projection";
import type { ResourceSnapshot } from "../../src/domain/biology";
import type { StructureSource } from "../../src/domain/types";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export async function biologyFixture(id = "3PTB", assembly = "") {
  const path = existsSync(`public/structures/${id}.cif`)
      ? `public/structures/${id}.cif`
      : existsSync(`tests/fixtures/biology/${id}.cif`)
        ? `tests/fixtures/biology/${id}.cif`
        : `tests/fixtures/biology/${id}.cif.gz`,
    raw = new Uint8Array(await readFile(path)),
    bytes = path.endsWith(".gz") ? new Uint8Array(gunzipSync(raw)) : raw,
    source: StructureSource = {
      id,
      name: id,
      kind: "sample",
      format: "mmcif",
      binary: false,
      bytes,
      contentHash: sha(bytes),
      fetchedAt: "2026-10-09T00:00:00Z",
    };
  const parsed = await prepareStructure(source, 0, assembly),
    discovery = parseDiscovery(
      JSON.parse(
        await readFile(
          `tests/fixtures/biology/${id.toLowerCase()}-discovery.json`,
          "utf8",
        ),
      ),
      id,
    );
  const xml = await decompressSifts(
      new Uint8Array(
        await readFile(
          `tests/fixtures/biology/${id.toLowerCase()}-sifts.xml.gz`,
        ),
      ),
    ),
    sifts = parseSiftsXml(xml, id);
  const proteins = [],
    annotations = [],
    evidence = [];
  for (const accession of new Set(discovery.map((d) => d.accession))) {
    const raw = new Uint8Array(
        await readFile(`tests/fixtures/biology/${accession}.json`),
      ),
      resource: ResourceSnapshot = {
        id: `${accession}:${sha(raw)}`,
        key: accession,
        provider: "UniProt",
        identifier: accession,
        url: `https://rest.uniprot.org/uniprotkb/${accession}.json`,
        bytes: raw,
        contentHash: sha(raw),
        retrievedAt: source.fetchedAt,
      };
    const p = await parseUniProt(
      JSON.parse(new TextDecoder().decode(raw)),
      accession,
      resource,
    );
    proteins.push(p.protein);
    annotations.push(...p.annotations);
    evidence.push(...p.evidence);
  }
  const mapped = mapResidues(parsed.snapshot, discovery, sifts.rows, proteins, [
    "sifts-fixture",
  ]);
  return {
    ...parsed,
    source,
    discovery,
    sifts,
    xml,
    proteins,
    annotations,
    evidence,
    ...mapped,
    projections: projectAnnotations(annotations, mapped.mappings),
  };
}
