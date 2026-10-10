# Phase 3 biological interpretation validation

Implemented 2026-10-09 (`biology-1.0.0`); follow-up milestones 3F–3J implemented 2026-10-10, interpretation/projection version `biology-1.1.0`. These checks establish regression behavior for the supported workflows, not universal mapping accuracy or experimental confirmation of UniProt statements.

## Frozen public inputs

`tests/fixtures/biology/manifest.json` records source URLs, retrieval date and SHA-256 for unmodified 3PTB/4HHB PDBe discovery JSON, compressed SIFTS residue XML, and UniProt P00760/P69905/P68871 JSON. Tests verify every hash before normalization. Scientific source files are not synthesized. Difficult-case tests make explicitly synthetic in-memory changes to these fixtures.

| Structure | Chain(s) | Verified correspondence |
| --- | --- | --- |
| 3PTB | A | HIS57 → label40 → P00760:63; ASP102 → label84 → 107; ASP189 → label171 → 194; SER195 → label177 → 200 |
| 4HHB | A/C | P69905, deposited labels1–141 → UniProt2–142 |
| 4HHB | B/D | P68871, deposited labels1–146 → UniProt2–147 |
| 1OPH | B | P00760 S200A (Ser195Ala, author 195), SIFTS `Engineered mutation`: exact position, identity `engineered_mutation`, active-site feature projects |
| 1OPH | A | P01009 M382R (Pittsburgh variant, author 358), SIFTS `Engineered mutation` |

Additional frozen inputs (2026-10-10, hashes in the manifest): 1OPH mmCIF, discovery JSON and SIFTS XML; UniProt P01009; RCSB chemical component records for BEN, CA, HEM and PO4; and RCSB nonpolymer-instance validation records for 3PTB B/C and 4HHB E–J. BEN has ChEBI:41033 and PO4 has ChEBI:18367. CA and HEM have no ChEBI cross-reference in RCSB, so relations involving them as the analyzed ligand stay unresolved. 3PTB BEN fit: RSCC 0.921, RSR 0.067; 4HHB ligands have no density-fit scores.

Discovery and exact XML correspondence are independent sources. Their chain/entity, interval, author/insertion and sequence checks must agree. Assembly copies retain distinct chain/residue identities. Repeated protein accessions are fetched once per load.

## Deterministic coverage

The existing 31 Phase 1–2 scientific tests remain intact. Fourteen additional Phase 3 tests cover:

- Exact trypsin positions, alpha/beta chain identity, assembly instances and frozen source hashes.
- Conflicting author/insertion numbering, duplicated/ambiguous correspondence, sequence mismatch and unobserved deposited positions.
- Chimeric accessions, explicit rejection of canonical substitutions for isoforms, deposited modified-residue parents and unsupported modifications.
- Invalid/uncertain feature bounds, malformed or wrong-entry XML, invalid gzip, and feature-specific ECO/citation preservation without assigning record-wide evidence.
- Binding-site polymer denominators, unmapped coverage, independent interaction results, and JSON/CSV scientific-field fidelity.
- Follow-up milestones (3F–3J): contract-excerpt drift checks; lowercase/mixed-case element symbols; off-thread SIFTS parsing (worker result equality, cancellation, retained cached bytes, preserved error messages); hash-pinned golden engine output for 13 cases and per-classifier positive/negative/at-cutoff cases; site/context categorization with independently counted chain background (3PTB: 4/17 mapped contact residues vs 11/223, S1 domain 221/223); ChEBI ligand relations (same/different/unresolved, including a 1.0.0 snapshot without identities); engineered-mutation projection and its unexplained-mismatch negative control; Cruickshank DPI arithmetic on 1OPH (about 0.21 Å) and absence for 3PTB; borderline export IDs checked against independent cutoff margins; pinned ligand identity/validation records and a non-fatal missing record.
- Actual Dexie version 2 → 3 migration with preserved source/session/analysis records, freshness reuse without HTTP, stale offline fallback with original dates/bytes, manual revisions, response limits, cancellation and no persistence of invalid interpretation data.

`fake-indexeddb` supplies IndexedDB semantics for migration/cache tests. Browser tests also exercise the real Chromium IndexedDB implementation.

## Production browser workflows

Six Phase 3 Playwright cases use intercepted frozen API payloads rather than live provider availability:

1. ASP189 contact selection → UniProt194/binding feature, catalytic UniProt200 → SER195/label177, linked tracks/3D/inspector, evidence drawer and both exports. Annotation filtering leaves the analysis available.
2. Hemoglobin alpha/beta identities and biological-assembly correspondence.
3. Saved interpretation, interaction analysis and the selected residue’s annotation-track page restore while all biological requests are blocked; failed refresh retains the old interpretation; successful refresh creates a new revision without changing geometry; reloading an unsaved refresh restores the original pinned revision.
4. API failure leaves structure and geometry usable. Local input has no automatic annotation association, a matching explicit association succeeds, and unrelated input is rejected.
5. Late responses cannot overwrite a newly selected structure, and annotation tracks fit a 390-pixel viewport.
6. An ambiguous track position with an exact neighboring residue in the same feature clears selection rather than selecting that neighbor.
7. 1OPH loaded by accession: the P00760 active-site track at UniProt 200 selects ALA B:195, labeled `S200A (engineered)`.

Test 1 also asserts the SIFTS worker is started, the site-level headline (4 / 17) and background (11 / 223), the unresolved "substrate" relation against BEN (CHEBI:41033), the S1 domain under context, 3PTB resolution without a coordinate-error estimate, and BEN fit RSCC 0.921 · RSR 0.067.

The complete 20-case suite also retains 13 Phase 1–2 browser cases. Run `npm test`, `npm run build`, and `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` (or install Playwright Chromium).

## Implementation choices and limits

Mappings/projections live inside immutable interpretation snapshots; raw source snapshots are cached separately. There is no redundant standalone mapping table. `AnalysisRun` is unchanged, and binding summaries are derived from the current compatible run. This keeps refreshed annotations from changing previous interaction results.

Exact correspondence requires one validated mapping and one observed residue instance per deposited position. Source conflicts and unsupported chemistry do not project. A residue-identity difference projects only when SIFTS curates it (`Engineered mutation` or `Conflict`); the mapping then records `identity` and `residueChange`. No sequence-alignment inference or author-offset fallback is implemented. Isoform accessions are preserved; a canonical-only endpoint response is rejected rather than converted. Uncertain feature bounds are retained/exported but never selected as exact structural features. Default categories omit mutation workflows; all normalized source features remain traceable in exports.

The current P00760 active-site features have no attached ECO evidence. Their database provenance is displayed explicitly. Signal-peptide evidence provides a positive ECO/PubMed fixture. Coordinates, reviewed status, contact overlap and function annotations are distinct kinds of information; none estimates affinity or mutation effects.

Local association requires explicit user input and agreement for every polymer chain across the complete deposited sequence/numbering, with at least 10 positions. Matching this policy validates correspondence; it does not certify that locally modified coordinates are the deposited experimental coordinates. Truncated/engineered constructs may therefore remain unannotated.

Four-character PDB IDs and at most 32 protein records are supported for biology. Browser gzip decompression is required. Compressed XML is bounded to 10 MB, decompressed output to 50 MB and correspondence to 500,000 rows; Decompression and XML parsing run in a dedicated module worker (`src/biology/siftsWorker.ts`); cancellation terminates it and the cached source bytes are never transferred. Discovery/UniProt responses are bounded to 5/10 MB. Requests have a 20-second timeout, up to two transient retries and four concurrent protein fetches. Partial UniProt failures are reported per accession; successfully validated proteins remain usable.

Saved schema 2 sessions pin interpretation/analysis references; schema 1 sessions remain readable. Cache expiry is seven days; failed background acquisition can use labeled stale source bytes. Manual refresh errors preserve the previous interpretation. No service worker or cache eviction policy is included, so offline restoration requires the application shell to be available.

Ligand relations compare ChEBI identifiers only and never infer identity from names. Generic UniProt ligands such as "substrate" remain unresolved. Background rates are descriptive counts; no enrichment statistic is reported because no null model is defined. Coordinate error describes an atom with average B factor; borderline flags use √2 × that error for a distance and are display metadata only. Ligand validation scores describe deposited coordinates. For an explicitly associated local file they are shown with that assumption, not as a property of locally modified coordinates.

PDBe independent binding-site cross-checks, AlphaFold interpretation, comparison, variants, mutation effects and protein interfaces remain later work.
