# Phase 3 implementation plan: functional interpretation

Status: implemented, 2026-10-09. Milestones 3A–3E are complete. This document retains the design and acceptance criteria; [validation/BIOLOGY.md](../validation/BIOLOGY.md) records the final implementation, test evidence and limitations. Baseline: completed ligand-centered Phase 2 engine, React/TypeScript/Mol* application on GitHub Pages.

## Outcome and boundaries

A user opens a structure, selects a protein chain or contact residue, and sees the corresponding UniProt protein position, functional features and their sources. Sequence tracks, the residue inspector and a binding-site summary stay synchronized with 3D selection. Each biological claim has traceable evidence, and unavailable or ambiguous mappings are visible.

First release covers experimentally deposited PDB structures, SIFTS residue mappings, UniProt protein identity/sequence/features, binding-site annotation overlap, evidence inspection, caching and enriched exports. Existing exploration and interaction computation remain usable when annotation services fail.

Structure alignment, cross-ligand comparison, variant-effect prediction, side-chain replacement, pocket prediction, AlphaFold confidence and affinity scores remain separate later phases. UniProt variants may be retained in raw payloads, but mutation workflows belong to Phase 5. PDBe ligand-site annotation cross-checks are an optional follow-up after the primary mapping workflow is reliable.

## Recommended architectural changes

1. **Separate annotation loading from structure and analysis readiness.** Add per-resource loading/error states rather than adding another stage to the existing global explorer phase. A SIFTS timeout must never clear a completed analysis or prevent residue selection.
2. **Use residue-level mapping rather than author-number offsets.** Segment APIs support discovery and coverage checks; exact SIFTS rows establish correspondence. Preserve author IDs, insertion codes, label sequence IDs, isoform IDs and assembly-instance identity.
3. **Add typed evidence before new biological UI.** Phase 2 already records coordinate hashes, rule versions, assumptions and chemistry sources. Reference that provenance from a separate evidence layer; do not rewrite cached `AnalysisRun` results to attach mutable annotations.
4. **Keep retrieved records as snapshots.** Pin source bytes/JSON hashes, sequence versions and retrieval times. An annotation refresh produces a new interpretation snapshot. It must not silently change an old export or saved session.
5. **Make coverage visible.** “No annotation found,” “not loaded,” “failed,” “unmapped,” and “ambiguous” are different states. Binding-site percentages need explicit denominators and must not imply that unmapped residues lack function.
6. **Start with SIFTS and UniProt.** Defer extra PDBe functional endpoints until the first source pair works end to end. This reduces initial schema and evidence complexity while retaining provider interfaces for additional sources.

## Verified data sources and first demonstration

Requests with Origin `https://jtmcbride.github.io` returned HTTP 200 and `Access-Control-Allow-Origin: *` on the check date:

| Source | Endpoint | Responsibility |
| --- | --- | --- |
| PDBe/SIFTS discovery | `https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/3ptb` | Entry → accessions, label chain/entity IDs, mapping segments |
| PDBe/SIFTS discovery | `https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/4hhb` | Multiple proteins and repeated chain mappings |
| SIFTS residue file | `https://ftp.ebi.ac.uk/pub/databases/msd/sifts/xml/3ptb.xml.gz` | Exact deposited residue → UniProt position correspondence |
| UniProt | `https://rest.uniprot.org/uniprotkb/P00760.json` | Bovine trypsin protein sequence and functional features |

All three primary 3PTB/UniProt endpoints were also successfully fetched from inside a Chromium page at the deployed GitHub Pages origin, confirming browser CORS behavior. These are direct GET requests from a static site; no application backend or API keys are required. Recheck CORS in production before release. Use HTTPS and bounded, abortable fetches. Parse compressed SIFTS with `DecompressionStream('gzip')`, then a namespace-aware XML parser. Provide a clear unsupported-browser message or a small, tested decompression fallback if target browsers require one. Treat PDBe JSON and SIFTS XML as different resources with separate source hashes; do not assume their refreshes are synchronized.

Verified 3PTB examples from the residue-level SIFTS file and current P00760 record:

| PDB author residue | Deposited label position | UniProt P00760 position | Current feature |
| --- | --- | --- | --- |
| HIS A:57 | 40 | 63 | Active site, charge relay system |
| ASP A:102 | 84 | 107 | Active site, charge relay system |
| ASP A:189 | 171 | 194 | Binding-site feature covering 194–195 |
| SER A:195 | 177 | 200 | Active site and binding-site feature |

The discovery segment maps label positions 1–223 to UniProt 24–246, while author numbering starts at 16 and ends at 245. Author numbering has discontinuities: a single author-number offset would mis-map some residues. Freeze these checked examples in fixtures rather than relying on live APIs in tests.

The current active-site features above do not include feature-level ECO evidence objects. Display their database provenance and the absence of attached feature evidence; do not manufacture experimental evidence from the fact that the record is reviewed or that 3PTB is an experimental structure.

First vertical slice: bundled 3PTB → chain A → SIFTS mapping → P00760 → select ASP189 from its salt-bridge row → show UniProt194 and the binding-site annotation → open its source drawer. Selecting the catalytic track at UniProt200 should select observed SER A:195 in sequence and 3D.

## Domain contracts

Create `src/domain/biology.ts` without importing Mol* or external response types. The following contracts specify the intended relationships; implementation can refine names while preserving these invariants.

```ts
interface ProteinRecord {
  id: string; // accession + sequence version/content hash
  accession: string; // retain isoform suffix when present
  canonicalAccession?: string;
  name: string;
  organism: { name: string; taxonomyId?: number };
  sequence: string;
  sequenceVersion?: number;
  entryVersion?: number;
  sequenceHash: string;
  evidenceIds: string[];
}
interface ResidueMapping {
  id: string;
  snapshotId: string;
  chainInstanceId: string;
  residueId?: string; // absent for an unobserved deposited sequence position
  labelSeqId: number | null;
  authSeqId: string | null;
  insertionCode: string | null;
  proteinId: string;
  uniprotPosition: number; // explicitly 1-based
  status: 'exact' | 'ambiguous' | 'sequence_mismatch';
  evidenceIds: string[];
}
interface FeatureBoundary {
  position?: number;
  modifier: 'exact' | 'less_than' | 'greater_than' | 'unknown';
}
interface FunctionalAnnotation {
  id: string; // provider record/hash + stable feature signature
  proteinId: string;
  type: string;
  description: string;
  start: FeatureBoundary;
  end: FeatureBoundary;
  sourceFeatureId?: string;
  ligand?: { name?: string; identifier?: string; label?: string };
  evidenceIds: string[];
}
interface Evidence {
  id: string;
  kind: 'experimental_structure' | 'database_annotation' | 'computed_geometry';
  provider: string;
  sourceIdentifier?: string;
  url?: string;
  contentHash?: string;
  retrievedAt?: string;
  release?: string;
  ecoCode?: string;
  citationIds?: string[];
  algorithmVersion?: string;
  assumptions?: string[];
}
interface AnnotationProjection {
  annotationId: string;
  residueIds: string[];
  observedPositions: number[];
  unobservedPositions: number[];
  ambiguousPositions: number[];
  mappingSnapshotId: string;
}
```

Use explicit `unmapped` coverage records for deposited positions with no mapping, rather than inventing a UniProt position. A mapping dataset contains all correspondences and per-chain coverage; repeated assembly operators reference the same original chain correspondence but project to distinct `chainInstanceId`/`residueId` values. One chain may map to multiple accessions in chimeras, and one protein position may have several observed structural instances.

`InterpretationSnapshot` should reference `snapshotId`, optional `analysisRunId`, the exact mapping/protein/annotation snapshot hashes, projection version and evidence IDs. `BindingSiteSummary` should reference the interpretation snapshot and report contact residues, mapped residues, ambiguous/unmapped residues, and overlaps grouped by annotation type. Keep water mediators and ligand residues separate from the polymer denominator; distinguish proximity, chemically classified contacts and clashes.

## Mapping rules and difficult cases

- Resolve SIFTS discovery entries by label asym ID/entity ID, retaining author chain as a separate field. For XML correspondence, reconcile PDBe residue indices and PDB author number/insertion code with deposited chain/sequence data; verify residue names and sequence identity before declaring exact mapping.
- Match residue rows to the original asymmetric-unit identity, then expand onto observed assembly copies. Never match across operators by display label alone.
- Missing coordinates still have deposited sequence positions; show annotations on those positions with a distinct unavailable-in-3D state. Clicking them must not focus a neighboring observed atom.
- Preserve insertion codes, nonnumeric author IDs, negative numbering and modified amino acids. Establish a documented modified-residue parent mapping from deposited component data; unsupported components remain ambiguous rather than being guessed.
- Keep every accession/isoform explicitly. Never drop `-2`, choose the first mapping for a chimera, or convert canonical positions into isoform positions by assumption. Fetch the corresponding sequence, validate it, and show unsupported/ambiguous cases when authoritative correspondence is absent.
- An annotation interval may span mapped, missing and ambiguous positions. Project only exact correspondence by default; an uncertain feature boundary gets a visibly uncertain extent, not an exact residue claim.
- For local input, an `_entry.id` is only a hint. Do not attach a remote mapping automatically to an unrelated file with the same entry ID. Require an explicit structure association and verify chain sequence/correspondence. Fetch only identifiers; never upload local coordinates. Offline local files retain the full Phase 1–2 workflow with “No validated protein mapping.”
- If JSON segments and XML rows disagree, retain both source hashes, report the conflict, and avoid exact projection on the affected positions. A sequence-alignment fallback, if later added, is inferred correspondence and must remain separate from authoritative SIFTS mappings.

## Implementation milestones and acceptance gates

Estimates are engineering working-day ranges for planning, excluding review or unexpected provider changes. Total initial estimate: 11–17 days. Gates are more useful than calendar promises.

### 3A — Contracts, fixtures and evidence foundation (1–2 days)

Files: `src/domain/biology.ts`, `src/biology/evidence.ts`, `src/data/biologySchemas.ts`, `tests/fixtures/biology/`, `tests/biology.test.ts`.

- Freeze 3PTB/4HHB SIFTS discovery, residue XML and selected UniProt JSON responses with source URLs, retrieval dates and SHA-256 manifests.
- Add synthetic insertion-code, sequence-gap, chimeric, isoform and uncertain-boundary cases. Clearly label transformed/minimized fixtures.
- Normalize external JSON with Zod at the adapter boundary; tolerate irrelevant added fields and reject missing required fields. Parse only the SIFTS XML elements needed by the contract.
- Create evidence helpers for structure provenance, computed Phase 2 geometry and database feature statements. Preserve ECO codes and citation references; distinguish provider record provenance from attached feature evidence.

Acceptance: contracts contain no Mol* references; feature-level evidence is never inferred from a reviewed-record label; fixture validation produces reproducible IDs and hashes.

### 3B — Exact SIFTS mapping and projection (3–5 days)

Files: `src/data/sifts.ts`, `src/biology/mapping.ts`, `src/biology/projection.ts`, `tests/mapping.test.ts`.

- Implement abortable discovery and exact residue-file retrieval with response/decompression limits and a provider interface.
- Build chain/accession relationships, residue correspondence, validation and coverage reports; preserve all candidates where ambiguous.
- Expand source-chain correspondence to current assembly instances. Cache original mapping separately from instance-specific projection.
- Add an annotation-independent inspector row showing PDB author position → deposited label position → UniProt position, plus mapping status/source.

Acceptance: all four verified 3PTB examples match the table; 4HHB alpha/beta chains and assembly copies resolve independently; gaps, insertions, ambiguity and sequence mismatches never silently map to adjacent residues. Mapping failure does not clear the 3D scene or interaction result.

### 3C — UniProt identity, sequence and features (2–3 days)

Files: `src/data/uniprot.ts`, `src/biology/annotations.ts`, `src/data/repository.ts`.

- Normalize names, taxonomy, canonical/isoform accession, sequence/version and reviewed status (descriptive metadata, not proof of each feature).
- Implement active sites, binding sites, catalytic/function notes, domains, regions and sequence processing features. Preserve full raw responses for traceability; curate useful initial UI categories.
- Resolve evidence codes/citations from feature references and record references without silently assigning record-wide citations to every feature.
- Preserve exact/uncertain/range boundaries and ligand descriptors. Validate feature bounds against the referenced sequence snapshot.
- Add Dexie version 3 tables for resource snapshots, proteins, mapping datasets and interpretations. Preserve version 1–2 sources, sessions, chemical definitions and analysis caches.

Acceptance: P00760 site features project to correct deposited residues; missing ECO evidence is shown as unavailable; out-of-sequence features or mismatched isoforms do not become exact structural annotations. Cached data stays usable during provider failure.

### 3D — Synchronized interpretation UI and binding-site summaries (3–4 days)

Files: `src/components/AnnotationTracks.tsx`, `src/components/EvidenceDrawer.tsx`, `src/components/BindingSiteSummary.tsx`, residue inspector in `src/App.tsx`, `src/state/explorer.ts`, `src/structure/controller.ts`.

- Add a protein identity strip and annotation/coverage tracks to the existing deposited sequence, with category toggles, keyboard selection and source links.
- Keep the deposited sequence and protein coordinates explicit in labels/tooltips. Do not replace structure numbering with UniProt numbering globally.
- Clicking an annotation projects exact observed residues to existing Mol* selection helpers. Multiple instances require an explicit active chain; unobserved positions remain visible without a fabricated 3D selection.
- Add inspector sections for mapped protein position, overlapping features and evidence. Keep computed geometry separate from database statements.
- Summarize functional overlap of the current binding-site polymer residues; show numerator/denominator and unmapped counts. Do not equate contact count or annotation overlap with functional importance or affinity.
- Provide compact source/retrieval details in a drawer. Keep scientific limitations beside the affected claim; API URLs and schema details belong in provenance/export, not the normal exploration flow.

Acceptance: ASP189 contact row and UniProt194 binding-site track select the same observed residue; UniProt200 active-site track selects SER195; missing positions, repeated chains and phone-width layouts behave clearly. Annotation filters do not invalidate a scientific interaction run.

### 3E — Persistence, enriched export and release verification (2–3 days)

Files: `src/biology/export.ts`, `src/data/repository.ts`, `tests/e2e/interpretation.spec.ts`, documentation and CI.

- Export a versioned interpretation bundle containing an unchanged Phase 2 analysis plus proteins, mappings, annotations, projections, evidence and source hashes. Keep the existing Phase 2 CSV stable; offer a separate residue-annotation CSV with mapping/source columns.
- Session schema 2 references interpretation snapshots and annotation filters; migrate/read existing schema 1 sessions. Restoring a session must not silently fetch new biological revisions under an old saved interpretation.
- Default live-data freshness window: 7 days, with a manual refresh control and visible retrieval/stale status. A saved interpretation remains pinned until explicitly refreshed. Offline cached data is labeled; no automatic overwrite of saved snapshots.
- Run deterministic domain tests and production browser tests; use intercepted fixtures for integration tests and a separate small live CORS smoke check before deployment.
- Publish through the existing validation/Pages workflows and verify the deployed subpath, browser requests, cached revisit, error recovery and enriched download contents.

Acceptance: a pinned interpretation exports identically in its scientific fields after cache restore; older exploration sessions still open; blocked UniProt/SIFTS requests leave Phase 1–2 usable; a source refresh creates a new interpretation revision; no local coordinate bytes leave the browser.

## Request orchestration and storage details

Use TanStack Query for resource acquisition and request coalescing, with source-specific adapters returning domain records. Use Zustand for active chain/protein, selected annotation, filters and display state. Cache persistent response snapshots in Dexie; queries reference their hashes. Suggested keys:

- Discovery: provider + normalized PDB accession + endpoint/parser version.
- Residue mapping: entry + SIFTS bytes hash + adapter version.
- Protein/features: exact accession/isoform + UniProt record hash + sequence version + adapter version.
- Projection: structure source hash/model/assembly + mapping hash + protein sequence hash + projection version.
- Interpretation: exact projection/annotation snapshots + optional `AnalysisRun.id` and `cacheKey`.

On chain selection, load or reuse mapping discovery, then the exact mapping and relevant protein records. Limit concurrency (initially four provider requests), coalesce repeated-chain accessions, abort obsolete requests, and check current snapshot/generation before publishing. Use a request timeout (initially 20 seconds), at most two retries for transient GET failures, and respect `Retry-After`. Bound compressed SIFTS input/decompressed output (initially 10/50 MB), XML residue count and JSON response size; tune from representative fixtures.

Avoid a global blocking loading screen: each track or inspector section displays its own availability. Explicit protein choice resolves chimeric/ambiguous discovery; fully independent work remains usable while the user chooses. Old cached interpretation snapshots retain their evidence references even after refreshed data enters the cache.

## Verification matrix

| Case | Required result |
| --- | --- |
| 3PTB catalytic and binding-site positions | Author, label and UniProt identities match verified residue rows |
| 4HHB alpha/beta chains | Correct accessions and no cross-chain annotation contamination |
| Assembly duplicates | Shared original correspondence, distinct rendered residue instances |
| Unobserved residue / insertion code | Preserved sequence position; no fabricated atom selection |
| Modified residue / engineered construct | Parent/sequence validation or explicit mismatch/ambiguity |
| Chimeric chain / isoform | Accessions remain distinct; no first-result or canonical-offset shortcut |
| Uncertain UniProt feature interval | Uncertainty survives normalization, projection, UI and export |
| Missing feature evidence / ECO code | Database provenance remains; no invented experimental support |
| Binding-site coverage | Denominator excludes ligand/water; unmapped residues stay visible |
| Endpoint failure / malformed XML / stale response | Geometry remains usable; actionable local status; old request cannot overwrite new structure |
| IndexedDB upgrade / stale cached data | Existing sessions and analyses survive; revisions and retrieval dates remain traceable |
| Local file with misleading entry ID | No unvalidated remote annotation attachment and no coordinate upload |
| JSON/CSV export and restore | Stable IDs, hashes, numbering and evidence references are retained |

## Release checklist and phase status

Phase 3 is complete when the 3PTB vertical slice and the mapping edge cases above pass, annotation tracks/inspector/binding-site summary agree, provenance survives export/restore, and the deployed application remains usable through scientific API failures. Optional PDBe cross-checks can then add independent binding-site annotations using the same contracts; they must not be confused with computed Phase 2 results.

Phase 1: complete. Phase 2: complete for the planned ligand-centered interaction workbench, with documented scientific preparation limits. Phase 3: complete, including exact mapping, functional interpretation, evidence, pinned restoration and enriched exports. Phase 4: structural comparison, pending. Phase 5: mutations, protein–protein interfaces and advanced analysis, pending.
