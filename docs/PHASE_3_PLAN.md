# Phase 3 implementation plan: functional interpretation

Status: milestones 3A–3E implemented 2026-10-09. Follow-up milestones 3F–3J, planned after a post-release review, were implemented 2026-10-10. See [Post-release review and follow-up milestones](#post-release-review-and-follow-up-milestones) and the [3F–3J implementation record](#3f3j-implementation-record). This document retains the design and acceptance criteria; [validation/BIOLOGY.md](../validation/BIOLOGY.md) records the final implementation, test evidence and limitations. Baseline: completed ligand-centered Phase 2 engine, React/TypeScript/Mol* application on GitHub Pages.

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

`src/domain/biology.ts` contains no Mol* or external response types. The excerpt below matches the implemented `biology-1.0.0` contracts (synchronized 2026-10-10). `src/domain/biology.ts` is authoritative; 3F adds a test that keeps this excerpt from drifting again.

```ts
interface ProteinRecord {
  id: string; // accession + sequence version/content hash
  accession: string; // retain isoform suffix when present
  canonicalAccession?: string;
  name: string;
  organism: { name: string; taxonomyId?: number };
  reviewed: boolean; // descriptive record metadata, not per-feature evidence
  sequence: string;
  sequenceVersion?: number;
  entryVersion?: number;
  sequenceHash: string;
  evidenceIds: string[];
  notes: { type: string; description: string; evidenceIds: string[] }[]; // function/catalytic statements
}
interface ResidueMapping {
  id: string;
  snapshotId: string;
  chainInstanceId: string;
  residueId?: string; // absent for an unobserved deposited sequence position
  labelSeqId: number; // every mapping row has a deposited polymer position
  authSeqId: string | null;
  insertionCode: string | null;
  proteinId: string;
  accession: string;
  uniprotPosition: number; // explicitly 1-based
  status: 'exact' | 'ambiguous' | 'sequence_mismatch' | 'source_conflict';
  identity?: 'match' | 'engineered_mutation' | 'conflict' | 'unexplained_mismatch'; // 3J; absent before biology-1.1.0
  residueChange?: { uniprot: string; deposited: string }; // one-letter codes when identity is not 'match'
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
  valid: boolean; // false when bounds fall outside the referenced sequence
  qualityFlags: string[];
}
interface Evidence {
  id: string;
  kind: 'experimental_structure' | 'structure_coordinates' | 'database_annotation' | 'computed_geometry';
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
  quality?: StructureQuality; // 3J: method, resolution, R-free, coordinate error (structure evidence only)
}
interface AnnotationProjection {
  annotationId: string;
  chainInstanceId: string;
  residueIds: string[];
  observedPositions: number[];
  unobservedPositions: number[];
  ambiguousPositions: number[];
  uncertain: boolean; // non-exact feature boundary; residueIds is then empty
}
interface LigandIdentity { // 3I: RCSB chemical component record of a deposited ligand
  componentId: string;
  name: string;
  chebiIds: string[]; // normalized "CHEBI:<number>"
  evidenceIds: string[];
}
interface LigandFit { // 3J: RCSB/wwPDB validation scores of one deposited ligand instance
  labelAsymId: string;
  componentId: string;
  rscc?: number;
  rsr?: number;
  completeness?: number;
  mogulBondsRmsz?: number;
  mogulAnglesRmsz?: number;
  rankingModelFit?: number;
  rankingModelGeometry?: number;
  scoreType?: string;
  evidenceIds: string[];
}
```

Status meanings: `source_conflict` means the discovery segment, SIFTS row, author number/insertion code or observation flag disagree. `sequence_mismatch` means the sources agree on position but the residue identity differs from UniProt. `ambiguous` means several candidate rows or observed instances. Positions with no row are counted as `unmapped` in `ChainCoverage` rather than stored as mapping rows. Projections carry no `mappingSnapshotId`. They live inside an immutable `InterpretationSnapshot`, which pins mapping, protein and annotation sources through `resourceRefs` hashes.

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

## Post-release review and follow-up milestones

A code and scientific review on 2026-10-10 found no failures in the 3A–3E acceptance gates. It did find engineering debt and interpretation weaknesses that should be fixed before Phase 4 builds on these contracts. Milestones are ordered: 3F–3H are behavior-preserving, or affect only latent edge cases, and must not change any frozen scientific output. 3I–3J deliberately change interpretation output and require version bumps.

Total initial estimate: 9–14 working days.

### 3F — Contract, documentation and element-symbol consistency (1 day)

Files: `docs/PHASE_3_PLAN.md`, `docs/PHASE_2_STATUS.md`, `README.md`, new `src/domain/elements.ts`, `src/analysis/{policy,completeness,engine,prepare}.ts`, `tests/analysis.test.ts`, `tests/biology.test.ts`.

- **Contract drift.** The domain-contract excerpt above has been synchronized with `src/domain/biology.ts`. Before that, it omitted `source_conflict`, `structure_coordinates`, `ProteinRecord.reviewed/notes`, `FunctionalAnnotation.valid/qualityFlags`, `ResidueMapping.accession` and `AnnotationProjection.chainInstanceId/uncertain`, and it listed a nonexistent `mappingSnapshotId`. Add a test that keeps the status and evidence-kind unions in this document in step with the exported TypeScript constants (e.g. export `MAPPING_STATUSES` and `EVIDENCE_KINDS` as `as const` arrays and assert that each value appears in the plan's code block). The test fails on future drift instead of relying on review.
- **Stale status documents.** `PHASE_2_STATUS.md` still lists π, metal, water-bridge and clash categories as future work. It also reports 18 scientific tests and 8 browser workflows, where the README reports 31 and 13. Update it, and move `PHASE_1_STATUS.md` and `PHASE_2_STATUS.md` into `docs/` beside this plan. Fix the README links.
- **Hydrogen element-symbol handling.** Hydrogen/deuterium/tritium detection is written four times with different case handling. `policy.ts` and `prepare.ts` upper-case the symbol. `completeness.ts` (heavy-atom completeness) and `engine.ts` (explicit donor-hydrogen lookup for H-bond geometry) compare it raw. Mol* currently normalizes `type_symbol`, so the inconsistency is believed latent. A lowercase or mixed-case symbol would still diverge: eligibility would exclude the hydrogen while the explicit-H lookup misses it, silently downgrading a `geometry_supported` H-bond to `implicit`/`candidate`. Add `isHydrogenElement(symbol)` (and `normalizeElement`) in `src/domain/elements.ts`. Normalize once when building `AtomRecord.element` in `extract.ts`, and use the helper at every call site.
- Add a synthetic fixture with lowercase `type_symbol` values (`h`, `d`, mixed-case `Zn`) that asserts identical eligibility, completeness and explicit-hydrogen H-bond classification to the uppercase original.

Acceptance: all frozen outputs (3PTB/1EVE/1RMD reference comparisons, interpretation exports) are byte-identical in scientific fields; the drift test fails when a status value is removed from the plan; the lowercase-element fixture passes.

### 3G — Worker-side SIFTS decompression and XML parsing (1–2 days)

Files: new `src/biology/worker.ts` and `src/biology/workerClient.ts`, `src/biology/load.ts`, `src/data/sifts.ts`, `vite.config.ts` (`optimizeDeps.entries`), `tests/biology.test.ts`, `tests/e2e/interpretation.spec.ts`.

- Before 3G, `load.ts` ran `decompressSifts` and `parseSiftsXml` on the main thread. Validated XML of up to 50 MB and 500,000 rows can freeze rendering and selection, which contradicts the rule that annotation work never blocks exploration.
- Move gzip decompression, `XMLValidator`, `XMLParser` and row normalization into a dedicated module worker, following the `AnalysisClient` pattern. Copy and transfer source bytes so the cached `ResourceSnapshot.bytes` buffer is never detached. Return plain `SiftsRow[]` plus parser diagnostics.
- Cancellation terminates the worker, and generation checks reject late results, as they do for analysis. Enforce the existing input, output and row limits inside the worker; size errors keep their current user-facing messages.
- Keep `parseSiftsXml` a pure function so Vitest calls it directly. The worker is a thin wrapper, and one integration test drives the worker client in the browser suite.
- Consider moving discovery/UniProt Zod normalization into the same worker only if profiling shows a measurable main-thread cost. Don't move it by default.

Acceptance: identical `SiftsRow[]` and interpretation hashes for the 3PTB/4HHB fixtures; a browser test shows residue selection and camera interaction staying responsive (no long task over 200 ms attributable to SIFTS) while a large synthetic SIFTS file parses; cancelling a structure load terminates the parse; malformed XML and invalid gzip still produce the same actionable errors.

### 3H — Interaction-engine restructuring (3–4 days)

Files: `src/analysis/engine.ts`, new `src/analysis/{connectivity,features,classify,metal,evaluation,provenance}.ts`, `tests/analysis.test.ts`, `tests/interaction-categories.test.ts`, new `tests/engine-golden.test.ts`.

`engine.ts` is 27 KB, most of it in one `analyze()` function that mixes Mol* structure selection, bond adjacency, proximity search, clash detection, feature extraction, per-type classification, metal grouping, evaluation status and provenance text. Scientific reviewers cannot audit one rule without reading all of them. The planned Phase 2.x ruleset changes listed below would be risky in the current shape. This is a refactor and must not change results.

1. **Golden output first.** Before moving code, snapshot complete `AnalysisRun` scientific fields (interactions, geometry, evaluation, qualityFlags, assumptions, bindingSite, bonds; excluding `id`, `generatedAt` and timing) for 3PTB BEN, 1EVE E20, 1RMD ZN and every synthetic category fixture, under default and non-default parameters. Store them as JSON fixtures with a hash.
2. **Split by responsibility,** with typed inputs and outputs and no shared mutable closure state:
   - `connectivity.ts`: selected-structure construction, bond extraction, adjacency, `isWithinBonds(a, b, n)` (currently the inline one/two-bond `bonded` closure).
   - `features.ts`: Mol* feature → domain atom-group translation and the ligand/receptor orientation of edges.
   - `classify.ts`: one function per interaction type (`classifyHydrogenBond`, `classifyIonic`, `classifyHydrophobic`, `classifyRing`, `classifyWaterBridge`). Each is pure over (endpoints, positions, adjacency, snapshot chemistry, parameters) and returns `MolecularInteraction | Rejection`. Explicit rejection reasons (bonded, incomplete endpoint, unknown chemistry, multi-residue group, nitrogen-only negative feature) become testable and countable instead of silent `return`s.
   - `metal.ts`: metal/partner feature pairing, grouping and angle enumeration.
   - `evaluation.ts`: the evaluation-status matrix and reason strings, as a table rather than nested ternaries.
   - `provenance.ts`: assumptions and quality-flag text, versioned with `RULESET_VERSION`.
   - `engine.ts` keeps orchestration only: eligibility → connectivity → proximity → clashes → Mol* compute → classify → group → assemble the run.
3. **Unit-test each classifier** with minimal synthetic inputs, including boundary values at exactly the cutoff and rejection reasons. Keep the existing fixture tests.
4. Record rejection counts per reason in `AnalysisRun.stats`. This is the only intended output addition; bump `ENGINE_VERSION` to `contacts-2.1.0` for the schema addition. Leave `RULESET_VERSION` unchanged because no rule changes.
5. Adopt Prettier and ESLint for the new modules, and reformat `engine.ts`'s remainder in the same change, so the file stops mixing two styles.

Acceptance: golden fixtures match exactly, apart from the documented `stats.rejections` addition; each classifier has positive, negative and at-cutoff tests; no module exceeds roughly 250 lines; the PLIP reference comparison is unchanged.

### 3I — Binding-site interpretation corrections (2–3 days)

Files: `src/domain/biology.ts`, `src/biology/projection.ts`, `src/components/BindingSiteSummary.tsx`, `src/biology/export.ts`, `tests/interpretation.test.ts`, `tests/e2e/interpretation.spec.ts`, README and `validation/BIOLOGY.md`.

- **Separate site features from context features.** `FUNCTIONAL_SITE_TYPES` includes `Domain` and `Region`. In P00760 the "Peptidase S1" domain (24–244, ECO:0000255) covers the whole mature chain, so the headline "mapped residues overlap functional features" is close to 100% for any 3PTB binding site by construction. Report site-level overlap (Active site, Binding site, Site) as the headline. Report Domain/Region membership as context, not as a functional numerator.
- **Add a background rate.** For each feature class, report the fraction of all exactly mapped, observed residues in the same chain instances that carry the feature, beside the binding-site fraction. Show both as counts. Do not show a p-value unless a defensible null model is documented.
- **Ligand identity of the annotation.** UniProt binding-site features carry a ligand (P00760: Ca²⁺ ChEBI:29108 at 75/77/80/85; "substrate" at 194–195, 197–198, 200). Overlaps are grouped only by feature type. Group and label overlaps by the annotation's ligand, and state its relation to the analyzed component: `same` (CCD→ChEBI cross-reference matches), `different`, or `unresolved` (generic labels such as "substrate", or no cross-reference). Never infer `same` from a name match. A CCD→ChEBI cross-reference comes from the CCD definition already fetched in Phase 2 when it carries one; otherwise the relation stays `unresolved`.
- Bump `BIOLOGY_VERSION` to `biology-1.1.0` (summary semantics change). Saved schema-2 sessions keep their pinned summaries; a refresh produces the new form.

Acceptance: the 3PTB summary no longer counts the S1 domain toward functional overlap; BEN–ASP189 overlap is shown against the "substrate" site with relation `unresolved`; the Ca²⁺ sites are shown as `different` if any contact residue touches them; background rates appear in the UI and the residue-annotation CSV.

### 3J — Engineered mutations and structure-quality evidence (2–4 days)

Files: `src/data/sifts.ts`, `src/biology/mapping.ts`, `src/domain/biology.ts`, `src/biology/evidence.ts`, `src/components/{ResidueBiology,EvidenceDrawer}.tsx`, new fixture with an engineered catalytic mutant, `tests/biology.test.ts`.

- **Engineered mutations.** Any residue identity difference currently yields `sequence_mismatch`, and nothing projects. Catalytically inactive mutants (e.g. Ser→Ala at the nucleophile) are common in ligand complexes, and that is exactly the position users want annotated. Parse the SIFTS `residueDetail` annotations (`Engineered mutation`, `Conflict`, `Expression tag`, `Cloning artifact`, `Microheterogeneity`). Record position correspondence separately from residue identity: add `identity: 'match' | 'engineered_mutation' | 'conflict' | 'unexplained_mismatch'` to `ResidueMapping`. Project annotations onto engineered positions with a prominent `S200A (engineered)` label. Unexplained mismatches stay unprojected.
- **Structure-quality evidence.** Resolution is captured (`StructureMetadata.resolution`) and B-factors are loaded, but neither is shown with interpretations. Add an `experimental_structure` evidence record per snapshot: method, resolution, R-free and Cruickshank DPI where computable. Add per-ligand fit metrics (RSCC/RSR) from the wwPDB validation data, fetched by identifier only after a CORS check. Show them in the binding-site summary and evidence drawer. Ligand fit is the main caveat for any contact claim.
- Carry an estimated coordinate uncertainty into the interaction table as a "borderline" flag for contacts within that uncertainty of their cutoff. This is display and export metadata derived from an unchanged `AnalysisRun`; it does not reclassify interactions.

Acceptance: a frozen engineered-mutant fixture projects its active-site annotation with the mutation label; an unexplained mismatch still does not project; 3PTB shows resolution and ligand-fit evidence with source hashes; validation failures leave interpretation usable with "quality evidence unavailable."

### Deferred: Phase 2.x ruleset revisions enabled by 3H

The review also found weaknesses in the interaction rules. They belong to a Phase 2 ruleset revision, not to Phase 3, but they should land after 3H so each change is a small, separately tested classifier edit with a `RULESET_VERSION` bump and an updated PLIP comparison:

- Per-altloc ensemble analysis (consistent A/B sets across residues, interactions reported as present in all or some conformers). This replaces whole-residue exclusion as the default, which biases against high-resolution structures.
- Halogen bonds enabled, with fixture and PLIP reference.
- Element-specific metal-coordination distances (Harding tables) instead of a uniform 3.0 Å.
- His salt bridges as a separate pH-dependent tier; Asn/Gln amide and His ring H-bonds flagged flip/tautomer-ambiguous; metal-bound His/Cys excluded from ionic typing.
- Covalent-ligand detection from `struct_conn`, with one-to-three-bond exclusions across the covalent link, and donor–acceptor pairs exempt from steric clashes.
- Multi-residue ligand groups (branched glycans, peptides, BIRD molecules) and optional non-polymer receptor components (cofactors, metals).
- A broader curated validation set with per-category agreement against PLIP and a second tool.

### 3F–3J implementation record

Implemented 2026-10-10 on the `phase-3f-consistency` branch: 81 deterministic tests (up from 45) and 20 production-browser workflows (up from 19). Versions: engine `contacts-2.1.0` (ruleset unchanged), `BIOLOGY_VERSION` `biology-1.1.0`, interpretation JSON schema 2. Older pinned interpretations without ligand records or residue identity remain readable; their relations show as unresolved and their identity as absent.

- **3F.** Implemented as planned. `src/domain/elements.ts` provides the shared hydrogen test, and `tests/contracts.test.ts` compares this plan's contract excerpt with `src/domain/biology.ts` (status, evidence-kind and identity unions plus field names). It caught two real drifts while 3I/3J were being built. Status records moved to `docs/`.
- **3G.** Implemented as planned. Deviation: the acceptance check asserts in the production browser that the SIFTS worker starts, and unit-tests equality, cancellation and buffer ownership. It does not include a long-task timing assertion, because software-WebGL rendering in CI produces long tasks unrelated to SIFTS, so the measurement could not be attributed.
- **3H.** Implemented as planned, with 13 golden cases byte-identical. Deviations: `engine.ts` is about 300 lines after Prettier rather than about 250, because the run-assembly object is kept inline for review. ESLint was not adopted: `typescript-eslint` 8.70 supports TypeScript below 6.1, and this project pins TypeScript 7.0.2. Prettier is adopted for all of `src/` and enforced in CI (`npm run format:check`). Revisit ESLint when `typescript-eslint` supports TypeScript 7.
- **3I.** Implemented. Deviation: CCD definition files carry no ChEBI cross-references, so identities come from RCSB chemical component records (`data.rcsb.org/rest/v1/core/chemcomp/<id>`, CORS verified 2026-10-10), pinned in the interpretation snapshot. Background rates appear in the UI and in the interpretation JSON's binding-site summary. The per-residue CSV gains `feature_category`, `feature_ligand` and `feature_ligand_id` instead of rate columns, because a per-feature-type rate does not fit a per-residue row.
- **3J.** Implemented. The engineered-mutant fixture is real (1OPH, S195A trypsin with alpha-1-antitrypsin Pittsburgh), not synthetic; an unexplained-mismatch negative control is an in-memory modification of it. The coordinate error is read from the coordinate file (deposited ESU(R-free), otherwise computed Cruickshank DPI_free) and is unavailable for 3PTB/4HHB, which deposit no R-free or reflection counts. Ligand fit comes from RCSB nonpolymer-instance validation records rather than the wwPDB XML. Borderline flags appear in the interaction table, the selected-contact inspector and the interpretation JSON; the Phase 2 CSV is unchanged.

## Release checklist and phase status

Phase 3 is complete when the 3PTB vertical slice and the mapping edge cases above pass, annotation tracks/inspector/binding-site summary agree, provenance survives export/restore, and the deployed application remains usable through scientific API failures. Optional PDBe cross-checks can then add independent binding-site annotations using the same contracts; they must not be confused with computed Phase 2 results.

Phase 1: complete. Phase 2: complete for the planned ligand-centered interaction workbench, with documented scientific preparation limits. Phase 3: complete, including exact mapping, functional interpretation, evidence, pinned restoration and enriched exports. Follow-up milestones 3F–3J (consistency, worker parsing, engine restructuring, interpretation corrections, mutation and quality evidence) are implemented. The deferred Phase 2.x ruleset revisions are the recommended next step before Phase 4. Phase 4: structural comparison, pending. Phase 5: mutations, protein–protein interfaces and advanced analysis, pending.
