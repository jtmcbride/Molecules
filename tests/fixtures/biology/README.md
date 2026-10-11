# Frozen biological sources

These are unmodified public API responses retrieved on 2026-10-09. `manifest.json` records each source URL, retrieval day and exact SHA-256. Gzip files retain the compressed source bytes. The manifest records the known day rather than inventing a retrieval time.

`tests/helpers/biology.ts` gives normalized fixtures a fixed timestamp and deterministic IDs for regression tests; those fixture timestamps are not production provenance. Production snapshots record the actual acquisition timestamp and hash. Difficult cases in scientific/browser tests are explicitly synthetic in-memory modifications of these inputs, not additional public records.

Sources: PDBe/SIFTS discovery and residue correspondence; UniProt P00760 (bovine trypsin), P69905 (human hemoglobin alpha), P68871 (human hemoglobin beta). See the manifest for exact provider URLs.

Phase 5 (retrieved 2026-10-10): 2HBS coordinates (gzip of the downloaded bytes; the manifest records both hashes), PDBe discovery JSON and SIFTS XML. 2HBS is deoxy sickle haemoglobin; SIFTS annotates its β Val6 residues as `Variant`. `carriers-<accession>.json` are RCSB sequence-coordinates GraphQL responses (POST; the manifest records each exact request body) for P68871, P69905, P01009 and P00760. Each also aligns one AlphaFold computed model, which the application does not use.
