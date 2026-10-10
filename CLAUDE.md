# CLAUDE.md

Molecular Interaction Explorer: a static, backend-free React/TypeScript/Mol* app (deployed to GitHub Pages at https://jtmcbride.github.io/Molecules/) for exploring deposited PDB structures, computing ligand–receptor interactions, and interpreting residues through SIFTS/UniProt. Phases 1–3 are complete, including the Phase 3 follow-up milestones 3F–3J, and the Phase 2.x interaction ruleset revision (`molstar-5.13.1-ligand-3`). Phase 4 (structural comparison) and Phase 5 (mutations, protein–protein interfaces) are pending.

Scientific policy, defaults and limits live in `README.md`. Validation evidence lives in `validation/README.md` (Phase 2, PLIP comparison) and `validation/BIOLOGY.md` (Phase 3). Design contracts and follow-up milestones live in `docs/PHASE_3_PLAN.md`; phase status records are in `docs/PHASE_*_STATUS.md`. `docs/PHASE_2X_PLAN.md` records the ligand-3 ruleset revision; Phase 4 (structural comparison) is next. `tests/contracts.test.ts` fails if the plan's contract excerpt drifts from `src/domain/biology.ts`. Update those docs whenever behavior, defaults or limits change. They are the project's scientific record, not marketing.

## Commands

Node ≥24, npm.

```sh
npm ci
npm run dev          # Vite dev server
npm test             # Vitest: deterministic scientific tests (no network)
npm run typecheck    # tsc --noEmit (TypeScript 7)
npm run format       # Prettier on src/ (format:check runs in CI)
npm run build        # typecheck + vite build
npm run test:e2e     # Playwright on the production build (builds and serves on :4173)
npx vitest run tests/biology.test.ts   # single file
```

- E2E runs one worker with software WebGL (SwiftShader). Don't parallelize it. Set `PLAYWRIGHT_CHROMIUM_PATH` to use a system Chromium.
- `RECORD_REFERENCE=1 npm test` writes diagnostic timing JSON under `/tmp`.
- `tests/reference-set.test.ts` compares engine output with pinned PLIP 3.0.0 and ProLIF 2.2.2 observations on 26 cases (`validation/reference-set*.json`, fixtures in `tests/fixtures/reference-set/`). A rule change re-pins it with `RECORD_REFERENCE_SET=1 npm test`, and every agreement change is explained in the `validation/README.md` change log. Regenerating reference observations needs the Python environment described there (`scripts/reference-set*.py`).
- `tests/engine-golden.test.ts` pins SHA-256 hashes of engine output for 13 cases. Any engine change must keep them unless the ruleset changes on purpose: then `UPDATE_ENGINE_GOLDEN=1 npm test`, bump `RULESET_VERSION`, and document why in `validation/README.md`. Use `DUMP_ENGINE_GOLDEN=<dir>` to diff full output.
- Regenerate PLIP reference observations with `scripts/plip-reference.py` (see `validation/README.md`). Normal CI doesn't run it.
- CI (`.github/workflows/ci.yml`) runs format:check → test → build → e2e. `pages.yml` deploys `main` with `VITE_BASE_PATH=/<repo>/`. Asset URLs must respect the Vite base path.

## Architecture

```
src/
  domain/      Pure types/contracts. No Mol* imports, no external response types.
    types.ts       StructureSnapshot (incl. StructureQuality), chains/residues/atoms, sessions
    identity.ts    identity() tuple IDs, preferred-conformer selection
    elements.ts    normalizeElement / isHydrogenElement (the only H/D/T test)
    analysis.ts    Interaction types, DEFAULT_PARAMETERS, ENGINE_VERSION/RULESET_VERSION
    biology.ts     ProteinRecord, ResidueMapping (status + identity), FunctionalAnnotation, Evidence, LigandIdentity, LigandFit, InterpretationSnapshot, site/context feature categories
  structure/   Mol* boundary for parsing/rendering
    adapter.ts     Mol* plugin lifecycle, scene, bidirectional domain↔Mol* selection
    extract.ts     Builds StructureSnapshot (assembly-space Float32Array coords) + SelectionIndex
    quality.ts     Refinement statistics from mmCIF; Cruickshank DPI coordinate error
    ligandGroups.ts  Multi-residue ligand groups (branched, BIRD, covalently linked)
    controller.ts  Serialized scene updates, stale-request rejection
  analysis/    Phase 2 engine (runs in a Web Worker)
    worker.ts, client.ts   Worker entry + cancellable client
    prepare.ts     Worker-side parsing and CCD definition injection
    engine.ts      Orchestration only (eligibility → connectivity → contacts → Mol* features → classify → metal → evaluation)
    parameters.ts  Mol* provider settings + analysisKey (re-exported from engine.ts)
    connectivity.ts, contacts.ts, features.ts, classify.ts, metal.ts  One responsibility each; classifiers are pure and return a draft or a RejectionReason
    collector.ts   Dedup, 1M guard, stats.rejections counts
    evaluation.ts, provenance.ts  Evaluation matrix; assumptions/quality flags/chemistry sources (text changes = ruleset change)
    uncertainty.ts Cutoff margins and borderline flags (display/export only; never reclassifies)
    ensemble.ts    Per-alternate-conformer runs and merge (default conformer policy)
    metalDistances.ts  Element-specific metal–donor targets (Bazayeva et al. 2024) + tolerance
    policy.ts      Request validation, atom eligibility (occupancy, altloc, H exclusion), residue summaries
    completeness.ts  Expected heavy-atom check (standard amino acids + supplied CCD dictionaries)
    geometry.ts, spatial.ts  Ring centroid/normal, VdW radii, uniform grid, distances/angles
    export.ts      JSON (schema 2) / CSV exports
  biology/     Phase 3 interpretation
    mapping.ts     Exact SIFTS residue correspondence + per-chain coverage
    projection.ts  Annotation → residue projection; binding-site summary (site headline vs chain background, context features, ChEBI ligand relations)
    siftsWorker.ts, siftsClient.ts  SIFTS gzip + XML parsing in a module worker (inline fallback in Node tests)
    load.ts, controller.ts  Independent loading, cancellation, pinned restore
    evidence.ts, export.ts  Evidence records; interpretation JSON/CSV
  data/        External sources + persistence
    provider.ts    RCSB/local ingestion, SHA-256, metadata
    chemistry.ts   Optional RCSB CCD downloads
    sifts.ts, uniprot.ts, biologySchemas.ts  Zod/XML-validated adapters
    chemcomp.ts, ligandFit.ts  RCSB chemical component (ChEBI) and ligand-instance validation adapters
    biologyResources.ts  Bounded fetch, 7-day freshness, stale fallback
    repository.ts  Dexie IndexedDB (DB version 3). Add a new version(); never edit old ones
  state/explorer.ts  Zustand UI state
  components/  AnalysisPanel, BiologyPanel, AnnotationTracks, EvidenceDrawer, BindingSiteSummary, ResidueBiology
  App.tsx      Workspace layout and synchronized views
tests/
  *.test.ts    Vitest (structure, analysis, interaction-categories, reference-comparison, scaling, biology, biologyResources, interpretation)
  e2e/         Playwright (explorer, analysis, interpretation). Biology APIs are intercepted with frozen fixtures
  fixtures/    Synthetic geometry CIFs (labeled artificial), reference PDB/mmCIF (1EVE, 1RMD, 3PTB), frozen biology responses incl. 1OPH engineered mutant + RCSB ligand records + SHA-256 manifest, golden/engine.json
public/structures/  Bundled unmodified 3PTB and 4HHB mmCIF samples
```

## Invariants (do not break)

- **Domain stays rendering-free.** Mol* objects never enter `src/domain`. `StructureSnapshot` is the scientific source of truth. Mol* owns only the scene.
- **Identity is explicit.** IDs are JSON tuples via `identity()`. Author numbering, label numbering, insertion codes, chain *instance* (label asym + assembly operator) and source atom rows are kept separate. Never derive one numbering from another by offset.
- **Reproducibility.** Analysis results are keyed by source SHA-256, model, assembly, ligand instance, receptor chains, all parameters, engine/ruleset/parser versions and CCD hashes (`analysisKey`). Bump `ENGINE_VERSION`/`RULESET_VERSION` (and the biology projection version) when results can change. `AnalysisRun` is immutable. Annotations reference it and never rewrite it.
- **No silent scientific claims.** Use "not evaluated", "partially evaluated", "candidate", "ambiguous", "unmapped", "source_conflict", "sequence_mismatch" and "unresolved" instead of zeros or guesses. Residue differences project only when SIFTS curates them. Ligand relations use ChEBI IDs only, never names. Domains/regions are context, never functional overlap. Don't infer feature-level experimental evidence from a reviewed UniProt record. Don't claim affinity or energy.
- **Pinned snapshots.** Biological sources are stored with hashes and retrieval times. Refresh creates a new interpretation revision. Restored sessions never silently refetch.
- **Privacy.** Local coordinate bytes never leave the browser. Only identifiers (PDB ID, CCD component ID, accession, ligand label asym ID) are requested.
- **Failure isolation.** Annotation/CCD/metadata failures must never clear the scene or a completed analysis.
- **No truncation.** Results over 1,000,000 interactions are rejected, not truncated. Fetches are bounded and abortable. Stale results are rejected by generation checks.

## Conventions

- `src/` is Prettier-formatted (defaults, double quotes) and CI enforces it. Older test files keep their dense single-quoted style; new test files use Prettier. ESLint isn't set up because `typescript-eslint` doesn't support TypeScript 7 yet.
- Version bumps: `ENGINE_VERSION` for output-shape changes, `RULESET_VERSION` for rule/assumption changes, `BIOLOGY_VERSION` for interpretation semantics. Analysis JSON is schema 3; interpretation JSON is schema 2. New request/parameter fields must be optional, and restored parameters merge over `DEFAULT_PARAMETERS`.
- Dependencies are pinned exactly. The Mol* version is part of the ruleset version, so upgrading Mol* means bumping `RULESET_VERSION` and re-reviewing the PLIP reference comparison.
- Tests use frozen fixtures, never live APIs. A source hash change means re-retrieving and reviewing inputs, not editing assertions. Label synthetic fixtures and in-memory modifications as artificial.
- Treat discrepancies against external tools (PLIP) as investigated, documented differences in `validation/README.md`. Don't hide them behind count tolerances.

## Key limits (see README for full list)

40 MB input, 250,000 selected atoms, one model at a time, mmCIF/BinaryCIF only. Biology supports four-character PDB IDs, ≤32 proteins, a 20 s timeout and 2 retries. SIFTS is bounded to 10 MB compressed, 50 MB decompressed and 500k rows, and requires `DecompressionStream`. Mol* parsing for display runs on the main thread; analysis and SIFTS parsing run in workers. No cache eviction or service worker.
