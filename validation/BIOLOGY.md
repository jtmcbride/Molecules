# Phase 3 biological interpretation validation

Implemented 2026-10-09, application release 0.3.0, interpretation/projection version `biology-1.0.0`. These checks establish regression behavior for the supported workflows, not universal mapping accuracy or experimental confirmation of UniProt statements.

## Frozen public inputs

`tests/fixtures/biology/manifest.json` records source URLs, retrieval date and SHA-256 for unmodified 3PTB/4HHB PDBe discovery JSON, compressed SIFTS residue XML, and UniProt P00760/P69905/P68871 JSON. Tests verify every hash before normalization. Scientific source files are not synthesized. Difficult-case tests make explicitly synthetic in-memory changes to these fixtures.

| Structure | Chain(s) | Verified correspondence |
| --- | --- | --- |
| 3PTB | A | HIS57 → label40 → P00760:63; ASP102 → label84 → 107; ASP189 → label171 → 194; SER195 → label177 → 200 |
| 4HHB | A/C | P69905, deposited labels1–141 → UniProt2–142 |
| 4HHB | B/D | P68871, deposited labels1–146 → UniProt2–147 |

Discovery and exact XML correspondence are independent sources. Their chain/entity, interval, author/insertion and sequence checks must agree. Assembly copies retain distinct chain/residue identities. Repeated protein accessions are fetched once per load.

## Deterministic coverage

The existing 31 Phase 1–2 scientific tests remain intact. Fourteen additional Phase 3 tests cover:

- Exact trypsin positions, alpha/beta chain identity, assembly instances and frozen source hashes.
- Conflicting author/insertion numbering, duplicated/ambiguous correspondence, sequence mismatch and unobserved deposited positions.
- Chimeric accessions, explicit rejection of canonical substitutions for isoforms, deposited modified-residue parents and unsupported modifications.
- Invalid/uncertain feature bounds, malformed or wrong-entry XML, invalid gzip, and feature-specific ECO/citation preservation without assigning record-wide evidence.
- Binding-site polymer denominators, unmapped coverage, independent interaction results, and JSON/CSV scientific-field fidelity.
- Actual Dexie version 2 → 3 migration with preserved source/session/analysis records, freshness reuse without HTTP, stale offline fallback with original dates/bytes, manual revisions, response limits, cancellation and no persistence of invalid interpretation data.

`fake-indexeddb` supplies IndexedDB semantics for migration/cache tests. Browser tests also exercise the real Chromium IndexedDB implementation.

## Production browser workflows

Six Phase 3 Playwright cases use intercepted frozen API payloads rather than live provider availability:

1. ASP189 contact selection → UniProt194/binding feature, catalytic UniProt200 → SER195/label177, linked tracks/3D/inspector, evidence drawer and both exports. Annotation filtering leaves the analysis available.
2. Hemoglobin alpha/beta identities and biological-assembly correspondence.
3. Saved interpretation and interaction analysis restore while all biological requests are blocked; failed refresh retains the old interpretation; successful refresh creates a new revision without changing geometry; reloading an unsaved refresh restores the original pinned revision.
4. API failure leaves structure and geometry usable. Local input has no automatic annotation association, a matching explicit association succeeds, and unrelated input is rejected.
5. Late responses cannot overwrite a newly selected structure, and annotation tracks fit a 390-pixel viewport.
6. An ambiguous track position with an exact neighboring residue in the same feature clears selection rather than selecting that neighbor.

The complete 19-case suite also retains 13 Phase 1–2 browser cases. Run `npm test`, `npm run build`, and `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` (or install Playwright Chromium).

## Implementation choices and limits

Mappings/projections live inside immutable interpretation snapshots; raw source snapshots are cached separately. There is no redundant standalone mapping table. `AnalysisRun` is unchanged, and binding summaries are derived from the current compatible run. This keeps refreshed annotations from changing previous interaction results.

Exact correspondence requires one validated mapping and one observed residue instance per deposited position. Conflicts and unsupported chemistry do not project. No sequence-alignment inference or author-offset fallback is implemented. Isoform accessions are preserved; a canonical-only endpoint response is rejected rather than converted. Uncertain feature bounds are retained/exported but never selected as exact structural features. Default categories omit mutation workflows; all normalized source features remain traceable in exports.

The current P00760 active-site features have no attached ECO evidence. Their database provenance is displayed explicitly. Signal-peptide evidence provides a positive ECO/PubMed fixture. Coordinates, reviewed status, contact overlap and function annotations are distinct kinds of information; none estimates affinity or mutation effects.

Local association requires explicit user input and agreement for every polymer chain across the complete deposited sequence/numbering, with at least 10 positions. Matching this policy validates correspondence; it does not certify that locally modified coordinates are the deposited experimental coordinates. Truncated/engineered constructs may therefore remain unannotated.

Four-character PDB IDs and at most 32 protein records are supported for biology. Browser gzip decompression is required. Compressed XML is bounded to 10 MB, decompressed output to 50 MB and correspondence to 500,000 rows; XML parsing currently runs on the main thread. Discovery/UniProt responses are bounded to 5/10 MB. Requests have a 20-second timeout, up to two transient retries and four concurrent protein fetches. Partial UniProt failures are reported per accession; successfully validated proteins remain usable.

Saved schema 2 sessions pin interpretation/analysis references; schema 1 sessions remain readable. Cache expiry is seven days; failed background acquisition can use labeled stale source bytes. Manual refresh errors preserve the previous interpretation. No service worker or cache eviction policy is included, so offline restoration requires the application shell to be available.

PDBe independent binding-site cross-checks, AlphaFold interpretation, comparison, variants, mutation effects and protein interfaces remain later work.
