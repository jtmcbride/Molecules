# Development plan after v0.5.0

Status: M1–M4 implemented locally, package 0.6.0; broader M4 release evidence remains pending. M1 locally verified 2026-10-13 (CI passed 2026-10-14); M2 slice 2 (selection resolver, member-aware viewer) implemented 2026-10-14 and deployed to Pages from the validated artifact (`c3fc8b6`, then `8d61158` after a browser-test fix); M2 slice 3 (linked fingerprint/site inspection, keyboard support, 0.5.1 release evidence) implemented 2026-10-14. The manual live-provider checklist has not been run. M3 protein-level variant discovery implemented 2026-10-15; M4-A input preparation and pinned chemistry implemented 2026-10-15; M4-B atom correspondence and fixed-frame RMSD implemented 2026-10-15; M4-C UI, atom highlighting, exports and saved results implemented 2026-10-15; M5–M8 remain proposed. See the [implementation record](#implementation-record) for verification and outstanding hosted checks. Baseline commit: `38f3330`; package 0.5.0, engine `contacts-2.1.0`, ruleset `molstar-5.13.1-ligand-3`, biology `biology-1.2.0`, comparison `comparison-1.1.0`.

## Outcome

Make the existing scientific workbench easier to investigate and reproduce, then extend its measurements. A user should be able to select a reported difference, inspect both structures and the supporting geometry, measure an identical ligand's pose change, and reopen the complete investigation in another browser.

Preserve exact identities, pinned evidence, explicit unavailable states, and the separation between deposited coordinates, calculated geometry, and database annotations. Keep the application static and browser-local.

## Verified baseline and gaps before M1

The project assessment ran 190 tests in 28 files, all 32 production-browser workflows, formatting, and the TypeScript/production build successfully. A separate local production-browser check rendered 3PTB and loaded fresh SIFTS/UniProt annotations with 223/223 deposited positions mapped. This is local verification, not verification of the deployed Pages build.

- Phases 1–4 and the Phase 5 curated-variant track are implemented. Existing scientific goldens and source manifests remain the regression baseline.
- `src/App.tsx` still displays Phase 3 and v0.3.0; `AnalysisPanel.tsx` displays engine 2.0. README's conformer section contradicts the actual `ensemble` default, and some comparison-version text is stale.
- `.github/workflows/pages.yml` can deploy without the independent browser-validation job succeeding. Playwright currently rebuilds the application itself and navigates to `/`, which needs attention when checking a repository subpath.
- `MolecularViewer.members` retains data/transform refs but not each member's selection index. `residueForLoci` accepts only the reference root. Merely making representations pickable will not produce correct member selection.
- Fingerprints retain cell states and margins, but no direct interaction navigation. Site-difference rows are read-only. Variant discovery is primarily residue-driven.
- `StructureSnapshot.chemistry` does not contain a complete chemical graph. An analysis run's bonds may include geometry-inferred connectivity; they must not silently become the ligand-symmetry authority.
- Comparison goldens cover four pairs centered on trypsin and hemoglobin. The 100,000-atom test validates spatial indexing, not end-to-end browser scale.
- Persistence keeps one `last` session. Comparison JSON references source hashes and cached run IDs; it is not a portable workspace archive.

## Order, release boundaries, and effort

Estimates are engineering working days for one developer, including focused tests and documentation, excluding external review and unforeseen chemistry/browser issues. They are planning ranges, not dates. Release numbers below are proposed.

1. **M1 — Release consistency and deployment gate:** 2–3 days.
2. **M2 — Linked comparison investigation:** 5–8 days. M1 + M2 target **v0.5.1**.
3. **M3 — Protein-level variant discovery:** 2–3 days. Target **v0.5.2**, or include with v0.6.0 if that avoids a separate release.
4. **M4 — Symmetry-corrected ligand pose RMSD:** 10–15 days. Target **v0.6.0**.
5. **M5 — Broader fixtures and performance evidence:** 3–5 days, begun with M1 and completed before M4 release. This overlaps other work in calendar time only if separate contributors are assigned.
6. **M6 — Named, portable sessions:** 6–9 days. Target **v0.7.0** before adding more annotation providers.
7. **M7 — Inferred sequence correspondence:** 8–12 days after M5; its own release.
8. **M8 — Protein–protein interfaces:** 3–5 days to establish contracts/reference fixtures, then an estimated 10–15 days for the bounded first implementation. Re-estimate after fixture review.

M1–M5 total roughly 22–34 developer-days; through portable sessions, 28–43. M7 and M8 are separate expansion tracks, not requirements for shipping v0.6.0. Interface analysis does not technically depend on inferred correspondence; this ordering prioritizes the current comparison workflow.

Dependency sequence: `M1 → M2 → M3 → M4 → M6`; M5 supplies fixtures and release evidence throughout. M7 builds on M2/M5 and the session conventions from M6. M8 begins with a separate scope/validation checkpoint.

## Shared implementation rules

- Mol* objects remain inside structure/chemistry adapters. Domain modules accept typed data and return results without accessing Zustand, IndexedDB, the network, or the viewer.
- Prefer a few substantial modules: a selection resolver, a ligand-pose calculator, and a workspace archive module. Avoid wrappers whose callers must still implement their invariants.
- Keep reference analysis controls anchored to the reference. Inspecting a comparison residue must not change the reference ligand, receptor selection, or calculation settings.
- Every asynchronous result carries its input identities and a generation/request token. Changing structures, pairings, conformers, transforms, or settings rejects stale work.
- Stored coordinate buffers are immutable. Apply display transforms exactly once when drawing or measuring; never overwrite assembly-space snapshots.
- A missing result is a typed state with a reason. A failed or incomplete search never returns zero or an apparently exact minimum.
- Do not regenerate existing goldens to make an unexpected change pass. Explain each intended change and bump the relevant semantic version.
- Refactor large UI files only where these milestones touch them; avoid a separate application rewrite.

## M1 — Release consistency and deployment gate

### Implementation

1. Add `src/domain/release.ts` for application release metadata. Inject package version through Vite; import existing engine/biology/comparison constants where relevant instead of duplicating strings. Product headings should describe capabilities rather than obsolete development phases.
2. Update `App.tsx`, `AnalysisPanel.tsx`, README, and CLAUDE.md. Correct current defaults, versions, export-versus-session terminology, and display-only comparison descriptions when M2 ships. Keep historical implementation records dated; do not rewrite them as if later capabilities existed earlier.
3. Extract a reusable validation workflow with an explicit build base-path input. PR validation calls it; Pages calls it for the same commit and uploads only its successful build artifact. Deploy depends on that validation job. Keep write/id-token permissions restricted to deployment jobs.
4. Split Playwright build and serve behavior: CI tests the already-built artifact; local `npm run test:e2e` retains a convenient build-and-test command. Add an explicit origin/base-path configuration and replace root-relative navigation that escapes the configured subpath.
5. Exercise the actual repository path in deployment validation. Verify index, bundled coordinates, fonts, lazy Mol* chunks, interaction worker, and SIFTS worker. Preserve a root-path check for ordinary local development.
6. Define a manual post-deploy checklist for fresh external biology, carrier lookup, and real-origin CORS. Keep deterministic fixture tests separate from live provider health; do not make routine scientific assertions depend on changing remote records.

Files: `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, proposed reusable validation workflow, `playwright.config.ts`, `package.json`, `vite.config.ts`, `src/domain/release.ts`, affected UI labels, `tests/e2e/*`, README, CLAUDE.md.

### Acceptance

- A failed browser job prevents Pages deployment, including manually dispatched deployment.
- The artifact uploaded is the artifact tested; there is no untested rebuild after validation.
- Root and repository-subpath smoke checks load bundled data and execute both workers without asset-path errors.
- Current product versions/defaults agree with code. Scientific versions and golden outputs do not change.

## M2 — Linked comparison investigation

### Selection contract

Introduce a renderer-independent selection module (`src/domain/selection.ts`, `src/comparison/selection.ts`) with structure-qualified targets:

```ts
type StructureRef =
  | { kind: "reference"; snapshotId: string }
  | { kind: "comparison"; slotId: string; snapshotId: string };

interface ResidueTarget {
  structure: StructureRef;
  residueId: string;
}

type InvestigationRequest =
  | { kind: "residue"; target: ResidueTarget }
  | { kind: "site_difference"; slotId: string; referenceResidueId: string }
  | { kind: "fingerprint"; slotId: string; rowKey: string };
```

`resolveInvestigation(request, workspace)` returns a view model with selected residues, exact interaction IDs grouped by side, correspondence basis, unavailable reasons, and input revisions. It never controls the viewer. The controller validates freshness and installs the result in a dedicated investigation store. The reference's existing selection fields remain a compatibility projection, not a second independently writable selection authority.

### M2-A: Member-aware viewer identity

- Retain each member's source snapshot, original selection index, deposited root, current transformed structure/root refs, and display transform in the viewer registry.
- Resolve clicks by owning structure before looking up unit/element IDs. Transformed descendants and assembly copies must resolve to the same domain residue without colliding with the reference.
- Expose member-aware select, highlight, and focus operations behind the viewer interface. Draw comparison interaction endpoints, ring centroids, and water legs in the displayed frame exactly once.
- Separate hover from persistent investigation selection. Clicking empty space clears the investigation. Hiding a selected member clears its scene highlights and leaves a visible hidden-state explanation; removing it clears the investigation.
- Replacing the reference or changing model/assembly clears the investigation. Updating the fit refreshes geometry without mutating scientific coordinates.

Files: `src/structure/adapter.ts`, `src/structure/controller.ts`, `src/comparison/controller.ts`, proposed `src/state/investigation.ts`, selection modules.

### M2-B: Difference navigation and inspection

- Make site rows and fingerprint cells keyboard-operable controls, not click handlers on inaccessible table cells.
- Resolve fingerprint interactions from the exact current runs, paired chain instances, residue positions, and interaction type. If multiple interactions contribute to one cell, list all; default to a deterministic choice rather than pretending the cell represents one bond.
- A gained/lost cell highlights both mapped residues but draws an interaction only where one is present. The other side shows its measured absence/margin or unavailable state. Never draw a guessed missing bond.
- Component rows must preserve instance ambiguity: list contributing components or require a choice; do not infer a unique residue from component ID alone.
- Add `ComparisonInspector.tsx` with reference/comparison labels, author and UniProt numbering, deposited identity changes, interaction geometry, cutoff margins, and evidence links. Reuse existing geometry/evidence formatting where possible.
- Show both selected sequence positions in a compact paired sequence strip. Preserve the full reference sequence and controls. Selecting an unpaired comparison residue still opens its inspector with the correspondence reason.
- Add in-page navigation to analysis, interpretation, and comparison so the user can reach these sections without scrolling through the full workspace. Preserve the viewer's expanded mode.

Files: `FingerprintMatrix.tsx`, `SiteDifferencesSummary.tsx`, `ComparisonPanel.tsx`, `App.tsx`, `styles.css`, new comparison inspector/sequence modules.

### Validation and release gate

- Tests cover repeated unit IDs, identical source loaded twice, assembly operators, insertion codes, absent/ambiguous mapping, multi-interaction cells, and stale results after re-pairing/removal.
- Browser workflows select 3PTB/1S0R site and fingerprint differences, inspect both sides, change global/site fit, and verify transformed highlights. Include an assembly-copy case and a water-mediated interaction.
- Reference ligand/receptor/settings and analysis hashes remain unchanged during comparison inspection.
- Reference-only selection and all existing workflows still pass. Add keyboard navigation and narrow-layout checks for the new inspector.
- Keep investigation selection transient in v0.5.1; restoration returns to the existing reference selection. No session-schema bump just to remember hover or an open panel.

## M3 — Protein-level variant discovery

Build `VariantTable.tsx` within the biology panel and a pure `src/biology/variantTable.ts` selector. Reuse `variantResidueStates`, current annotations, projections, and carrier lookup state; do not reparse descriptions or reimplement consequence rules.

- One source-feature row per protein, with Natural variant and Mutagenesis kept separate. Expand chain-instance deposited states instead of multiplying headline feature counts by assembly copies.
- Show substitution or stated bounds, quoted description, exact observed coverage, deposited state, and evidence. Keep variants outside the deposited fragment visible with a reason.
- Filter by feature type, text, observed mapping, and contact membership. Offer proximity, chemical contacts, and clashes separately; a missing analysis means contact filtering is unavailable, not zero contacts.
- Default order is sequence position then stable feature ID; sorting and filters never imply clinical severity or predicted effect.
- Row selection uses M2's selection path where coordinates exist. Multiple observed positions select a residue set; uncertain bounds do not manufacture an exact selection.
- Reuse per-accession carrier requests, including deduplication, cancellation, pinned restore, and isolated errors. Do not fetch every protein's carriers merely because the table is opened.
- Use bounded pagination; retain clear total/filtered counts. Existing interpretation exports remain the authoritative complete data export.

Acceptance: frozen P68871 variants are discoverable without residue-by-residue browsing; P00760 reports no curated records; P01009's multi-residue replacement is preserved; duplicated chains do not inflate source-feature totals; filtering does not change site summaries, consequence wording, or scientific hashes. Add selector tests and one end-to-end discovery → residue → carrier → comparison workflow.

## M4 — Symmetry-corrected ligand pose RMSD

### Scientific scope for the first release

Measure equal-weight heavy-atom RMSD in the reference protein's coordinate frame. Use the selected protein superposition and minimize over permitted atom correspondences:

`poseRmsd = min over maps sqrt(mean_i(||reference[i] - T(comparison[map(i)] )||²))`.

There is **no additional ligand fit**. The existing Cα fit, its scope, and its uncertainties remain visible beside the measurement. Pose RMSD is not affinity, strain energy, or a statistical significance score.

First release supports the same chemical component ID on both sides, a single nonpolymer residue per ligand, complete eligible heavy atoms, and matching authoritative chemical graphs. Exclude ions, metal-containing ligands, ligand groups, covalently attached ligands, and incompatible/unknown stereochemistry with explicit reasons. In particular, HEM remains unavailable in this first scope; BEN supplies a supported existing example. Cross-component equivalence, partial common-substructure RMSD, protonation/tautomer conversion, and resonance-equivalent terminal-group swaps are later policies.

### M4-A: Pinned chemistry and input preparation

Implemented modules: `src/domain/ligandPose.ts`, `src/data/ligandChemistry.ts`, `src/structure/chemicalGraph.ts`, `src/comparison/ligandPoseInput.ts`. See [input validation](../validation/LIGAND_POSE.md).

- Extract a complete graph from sufficiently specified embedded component data, otherwise request the existing CCD source by component ID. Record the chosen source bytes, hash, atom/bond attributes, and parser/policy version. Never infer symmetry from coordinate distances or an interaction run's geometry-inferred bonds.
- Validate observed atom names against definitions, element/charge agreement where specified, full heavy-atom coverage, covalent attachment context, supported bond orders, aromaticity, and stereochemistry. Refuse contradictory definitions or unsupported stereo rather than dropping those constraints.
- Atom names locate deposited atoms in the chemical definition; they do not prohibit chemically valid permutations. Graph matching preserves elements, formal charges, bond/aromatic labels and stereo. Aromatic normalization uses explicit source flags; no general aromaticity or tautomer perception is introduced.
- For no alternates, use shared atoms. If either ligand has alternates, require an explicit coherent conformer choice per side (shared atoms plus that label). Do not independently choose alternate atoms or minimize silently across conformer pairs. Omitted/invalid occupancy atoms produce an incomplete-ligand result.
- Record the occupancy threshold explicitly (default 0, retaining only finite positive occupancies above that threshold). Changing the reference's minimum-occupancy setting invalidates pose inputs even when interaction analysis has not run. Hydrogen, deuterium and tritium are excluded using the existing element helpers.
- Pose calculation must work without first running interaction classification. Add a component-definition retrieval interface that can serve this use while preserving the current analysis path and engine goldens.
- Cache chemistry by hash, not just component ID. The existing table is keyed by component ID and cannot preserve multiple revisions by itself. Add immutable pose chemistry/result storage in Dexie version 5; retain old analysis storage for compatibility.

### M4-B: Exact bounded correspondence and calculation

Implemented modules: `src/comparison/ligandPose.ts`, `poseMappings.ts`, `poseTransform.ts`, `ligandPoseWorker.ts`, `ligandPoseClient.ts`. See [mapping policy and independent evidence](../validation/LIGAND_POSE.md#m4-b-calculation-and-mapping-policy).

- `calculateLigandPose(input)` is the pure calculation interface. Input includes both graph/coordinate snapshots, source/ligand/conformer identities, the exact rigid transform, and policy.
- Use label/degree/neighborhood partitioning and deterministic graph backtracking to enumerate allowed isomorphisms. Validate stereo permutation constraints, not merely equal R/S labels on matched atoms. Require a proper rigid transform and finite coordinates.
- Evaluate all admissible maps and choose the minimum, breaking numerical ties lexicographically by stable atom identities. Retain both name-matched RMSD and symmetry-corrected RMSD where the former is defined.
- Initial proposed limits: 256 heavy atoms, 100,000 search states, 4,096 complete maps, and a 5-second worker watchdog. M5 calibrates these before release. Deterministic limits are versioned; timeout is an operational failure. Hitting any limit returns no exact score, even if a plausible best-so-far map exists.
- Run preparation/search in a dedicated cancellable worker. Owned copies may be transferred; renderer buffers must not be detached. Cancellation terminates work; a late response cannot populate a changed comparison slot.
- Use strict source-graph symmetry in v1. Explicitly state that resonance-equivalent swaps across different bond/charge labels are excluded. A later expansion requires new fixtures and a pose-policy version.

Result is a discriminated union: `evaluated` with RMSD, atom map, per-pair distances, matched count, conformers, transform/scope, chemistry hashes, and policy; or `not_evaluated` with a stable reason code and explanation. Loading, cancelled, timeout, and network failure are operation states rather than measured results.

Cache keys include both source hashes and snapshot contexts, ligand IDs, chosen conformers/occupancy policy, graph hashes, full superposition inputs/transform, and pose algorithm/policy versions. Changing any input invalidates the display immediately.

### M4-C: Display, persistence, and export

Implemented in `LigandPoseSummary.tsx`, `comparison/poseController.ts`, `poseContext.ts`, `data/poseResults.ts`, the investigation/viewer selection path, and comparison/session exports. See the implementation record and [validation](../validation/LIGAND_POSE.md).

- Add `LigandPoseSummary.tsx` per comparison slot: RMSD in Å, heavy-atom count, fit scope, conformer choices, symmetry policy, and unavailable reason. An atom-map inspector uses M2 selection to highlight paired ligand atoms and their displacement.
- Changing fit scope recomputes the pose result. Changing fingerprint filters does not. A pose error does not invalidate interaction analyses or other slots.
- Bump comparison semantics to `comparison-1.2.0`; add `ligand-pose-1.0.0` for the new policy. Keep interaction engine/ruleset and biology versions unchanged.
- Write comparison export schema 2 with optional per-slot pose records and full maps/provenance. Do not describe existing comparison JSON as an importable project file.
- Session schema 4 adds optional per-slot pose conformer selections and result references. Readers continue accepting schemas 1–3. Restore an exact saved result using pinned definitions without new requests; if its bytes/result are missing, show unavailable and offer explicit recalculation.
- Never compute a new result with changed chemistry while presenting it as the old saved result.

### Independent validation and release gate

Add `tests/ligand-pose*.test.ts`, `tests/e2e/ligand-pose.spec.ts`, `scripts/ligand-pose-reference.py`, hash-pinned inputs/results, and `validation/LIGAND_POSE.md`.

- Exact invariants: identical coordinates give zero; a permitted atom-name permutation preserves corrected RMSD; an improper/chirality-changing map is rejected; a known translation remaining after the fixed protein fit gives its known displacement magnitude; input coordinates do not change.
- Enumerate all mappings independently for small synthetic graphs and compare both the admissible set and minimum. Supplying the application's map to a second distance calculator alone is not sufficient validation.
- Use a pinned RDKit version for independently generated admissible maps and in-place RMSD after applying the frozen protein transform. Set symmetry/chirality options explicitly to match the declared scope. Investigate map-set disagreements; do not hide them with score tolerances.
- Start from 3PTB/1S0R BEN, then freeze at least three additional real same-component pairs from distinct protein families, including a supported symmetric ligand and an asymmetric ligand. Confirm suitability before naming them release fixtures; do not invent expected RMSDs.
- Negative fixtures: missing atom, alternate-conformer ambiguity, missing chemistry, altered charge/bond order, stereo conflict, apo counterpart, HEM, covalent ligand, and exhausted search. Existing hemoglobin comparison still works while pose is unavailable.
- Proposed numeric agreement tolerance: 1e-4 Å against the same frozen coordinate inputs; document precision/rounding and choose a justified tolerance before pinning results.
- Browser checks cover transformed atom highlights, fit changes, cancellation/removal, cached reuse, export completeness, and pinned restore without network.

Reference-method choice: RDKit documents `CalcRMS` as in-place, whereas `GetBestRMS` performs alignment. Use the in-place route for this measurement. Terminal conjugated-group symmetry is enabled by default in RDKit and must be explicitly disabled for the strict v1 policy. [RDKit alignment documentation](https://www.rdkit.org/docs/source/rdkit.Chem.rdMolAlign.html), [RDKit symmetry-default change](https://rdkit.org/docs/BackwardsIncompatibleChanges.html). Atom and bond typing/stereo inputs come from the [wwPDB Chemical Component Dictionary](https://www.wwpdb.org/data/ccd).

## M5 — Broader validation and performance evidence

### Fixtures

- Extend comparison beyond the existing two protein families: same ligand in distinct environments, alternate conformers, incomplete pockets, homomeric assembly copies, and a structure without usable correspondence. Choose and freeze real entries after checking coverage and chemistry.
- Each entry gets source URL, retrieval date, SHA-256, scientific role, and an independently checked expectation. Label synthetic mutations separately from deposited inputs.
- Add no-SIFTS and different-protein negative cases now; they become explicit inferred-correspondence cases only in M7.

### End-to-end benchmark

Add `scripts/benchmark-workspace.ts` (or a dedicated non-default Playwright project) and `validation/PERFORMANCE.md`. Use frozen structures at roughly 10k, 100k, and near the 250k selected-atom limit, plus 1/4/8-structure workspaces. Include a bounded large assembly and a synthetic over-limit rejection case.

Record cold/warm load, parse, first usable scene, annotation processing, interaction run, comparison fit, pose search, selection response, cancellation acknowledgement, and memory where the browser exposes a reliable measure. Record browser, hardware, WebGL mode, build, repetitions and fixture hashes. Separate SwiftShader CI from normal GPU desktop measurements; use five measured repetitions after a stated warm-up policy.

Proposed usability targets: selection feedback within 100 ms, cancellation acknowledgement within 250 ms, and no newly introduced main-thread tasks above 200 ms from selection/pose work on the reference desktop. Establish baseline absolute load/memory values before setting regression thresholds; the existing main-thread Mol* parsing limit remains documented.

Ordinary CI should gate deterministic resource limits and selected fixed-hardware smoke cases. Keep noisy full timings as artifacts or a manual/scheduled benchmark. Investigate repeated regressions exceeding both 20% and 100 ms on the same machine rather than failing tests on one timing sample. These targets are engineering budgets, not scientific validity criteria.

Optimize from profiles: indexes for residue/atom lookups, narrower store subscriptions, bounded table rendering, and worker work first. Propose moving display parsing only after measuring its cost and assessing Mol* lifecycle constraints. Confirm released scene resources stop accumulating after repeated load/remove cycles; do not promise memory numbers before measurement.

## M6 — Named and portable sessions

### Named workspaces

- Introduce a `WorkspaceRecord` with UUID, name, created/updated timestamps and a session descriptor. Provide create, save, rename, open, export and delete actions. Keep a separate active/last-opened workspace pointer.
- Migrate the existing `last` descriptor to one named workspace without losing its pinned sources or results. Add Dexie version 6 after M4's version 5. Database migration remains distinct from session and archive schema versions.
- Protect sources referenced by **all** named workspaces during eviction, not just the current session. Deleting a workspace removes its references; normal cache cleanup handles newly unreferenced data.
- Retain current camera-restoration behavior initially; do not imply the archive restores unrecorded camera state. Preserve pose conformer choices, chain overrides and all currently supported settings.

### Portable archive contract

Create `src/workspace/archive.ts`, `schema.ts`, `controller.ts`, and a small `WorkspaceMenu.tsx`. Use a versioned `.miexplore` archive with a manifest and content-addressed byte entries. Choose and pin a browser archive library during implementation; no upload or hosted backend is needed.

The manifest includes archive schema 1, producer/scientific versions, workspace descriptor, dependency references, byte lengths and SHA-256 hashes. Package original coordinate bytes; pinned biology response bytes and normalized interpretations/proteins; analysis runs; exact chemical definitions; carrier lookup resources; pose inputs/results; and session options. Serialize typed arrays/non-finite values with explicit validated codecs. Existing analytical JSON exports are not used as a lossless archive substitute.

Export computes the transitive dependency closure of the selected workspace, never dumps the whole database. If required pinned bytes are missing, report the exact missing items and refuse a supposedly complete archive. Local filenames and coordinate content are included; label the download accordingly.

Extend immutable hash-addressed chemistry storage to archived interaction definitions as well as pose definitions. The legacy component-ID lookup may remain a convenience index, but an imported or restored analysis resolves its exact definition hashes. Two workspaces using different revisions of the same component must coexist. Handle carrier resources and their request bodies with the same immutable provenance rule.

Import validates before installation: schema, allowed paths, entry count, total expanded size, per-source size, hashes, references, numeric arrays, and supported versions. Proposed initial bounds are 256 MiB archive, 512 MiB expanded, and 10,000 entries, retaining the 40 MiB coordinate-file bound. Oversized workspaces remain usable locally; explain the portable limit. Use deterministic paths and reject traversal/duplicate entries. Refuse unknown future schemas with a useful message.

Use one validated transaction for data installation, with fresh workspace IDs and remapped generated record IDs on collisions; preserve source hashes and original provenance. Never overwrite a different existing record merely because its imported ID matches. Quota failure rolls back import and preserves open work. Restore after installation; a render failure leaves the imported workspace available and the prior workspace recoverable. Opening the archive performs no scientific requests.

Acceptance: export a multi-structure workspace with a local file, pinned annotations, analysis, carrier lookup and pose result; import into a fresh browser profile with scientific network requests blocked; recover matching hashes, settings and measurements. Test old-session migration, two-workspace eviction protection, shared sources, corrupt bytes, dangling references, unsupported versions, ID collisions, quota rollback, and size limits. Do not delete user workspaces during automated checks.

## M7 — Inferred sequence correspondence

Implement this as an explicit alternative comparison method. Preserve the current exact SIFTS path and keep biological annotation projection exact-only.

1. Generalize comparison pairs to carry `basis: sifts_exact | sequence_inferred`, plus chain/label-sequence positions. Inferred pairs may lack a shared UniProt position; do not fabricate one to satisfy today's fingerprint keys.
2. Add a worker-based protein-sequence alignment module using deposited polymer sequences including unresolved positions, not only observed Cα atoms. Start with explicitly chosen chain pairs and deterministic affine-gap global alignment; freeze scoring, end-gap policy, unknown-residue handling and tie behavior in an algorithm version after independent reference validation.
3. Show identity, coverage, gaps, unresolved coordinates and ambiguity separately. No probability/confidence score derived from sequence identity alone. Ambiguous repeated segments remain unpaired unless the user chooses an explicit correspondence; do not silently accept an arbitrary optimal alignment.
4. Present an alignment preview before applying this user-selected mode. Preserve SIFTS mappings and conflicts as evidence; inferred pairing must not overwrite them or create new UniProt annotations/variant claims.
5. Permit superposition/site geometry over accepted observed pairs. Generalize inferred fingerprint row identities to reference chain/label positions, visibly labeled inferred; keep exact and inferred summaries distinguishable and never pool them into an unlabeled score.
6. Extend comparison export/session contracts with the sequences, hashes, algorithm/settings, accepted map, overrides and provenance. Re-key cached fits/fingerprints; restore pinned maps without recalculating under a newer aligner.

Files: `src/domain/comparison.ts`, new alignment modules/worker, `correspondence.ts`, `superposition.ts`, `fingerprint.ts`, `derived.ts`, pairing/sequence UI, export and session readers.

Acceptance: existing exact outputs unchanged; independently checked identical, insertion/deletion, terminal-fragment, homologous, repeat-ambiguous, chimera and unrelated-sequence fixtures; unresolved positions never produce atom selections. Browser workflows explicitly switch method, inspect ambiguity, select paired residues, and restore the same inferred map. Bump comparison semantics/export/session schemas according to the final changed contracts and document old-schema behavior before release.

## M8 — Protein–protein interfaces

### Contract and fixture checkpoint

Define the first release as geometry between two disjoint user-selected sets of polymer chain instances in one deposited model/assembly. Start with proximity and residue-contact maps. Buried surface area, interface chemistry classes, energetic scores, and predictions of biological relevance are separate follow-ups.

Record assembly choice prominently. A deposited assembly or a close contact does not itself establish a biological interaction. Cross-structure interface comparison can follow after single-structure measurements are validated.

### Implementation sequence

1. Define `InterfaceRequest` with chain-instance sets A/B, source/model/assembly identity, occupancy/conformer policy, cutoff and interface-policy version. Reject overlap or empty groups and deduplicate undirected atom/residue pairs.
2. Build `src/interfaces/` with a worker calculator and cancellation client. Reuse spatial indexing and eligibility primitives where their contracts apply; do not disguise polymer group A as a ligand or change the existing ligand engine's result schema.
3. Report unique contacting residues on each side, atom-pair counts, residue-pair contacts and minimum distances with explicit denominators. Missing atoms/coordinates and excluded conformers remain visible. Use a declared heavy-atom proximity cutoff (initial proposal 5 Å) and label it as geometry only.
4. Provide chain-group selection, an accessible residue-contact matrix, linked 3D selection through M2, provenance and dedicated JSON/CSV exports. Persist request/result in the named workspace dependency graph.
5. Validate a small heterodimer, a homomeric assembly, no-contact chains, insertion codes, alternate conformers, and operator-transformed copies. Independently brute-force small cases, then compare frozen real contact sets against a separately implemented reference using identical preparation/cutoffs.
6. Extend M5 benchmarks to large chain pairs and enforce a documented pair-count guard without returning truncated scientific results.

Release gate: reproducible geometric contact sets, correct assembly-instance selection, cancellation/failure isolation, exports and offline workspace round-trip. Establish a new `interface-1.0.0` policy; leave ligand engine goldens unchanged. Re-estimate chemical interaction classification and buried surface area only after this slice is validated.

## Reviewable implementation slices

Each slice should have a focused diff and its relevant validation evidence. This is a suggested commit/PR breakdown, not an instruction to create or publish PRs now.

1. M1 metadata/docs consistency; reusable validation and tested-artifact deployment.
2. M2 structure-qualified selection resolver and member-aware viewer registry.
3. M2 linked fingerprint/site inspection, keyboard support, and v0.5.1 release evidence.
4. M3 protein-level variant discovery and carrier-navigation workflow.
5. M5 fixture expansion and baseline benchmark harness.
6. M4 chemistry/pose contracts, exact graph input and immutable storage.
7. M4 bounded worker calculator and independent reference observations.
8. M4 UI, transformed selection, export/session schema updates and v0.6.0 evidence.
9. M6 named workspaces, migration and eviction protection.
10. M6 archive codecs, closure/validation/import, offline round-trip and v0.7.0 evidence.
11. M7 alignment contract/worker/reference fixtures, then UI/export/session integration.
12. M8 contract/fixtures, then worker calculation, UI and dedicated exports.

## Verification and completion checklist

For implementation slices, run focused deterministic tests while editing, then the repository's format, scientific-test, build, and relevant browser gates. Run the complete browser suite at release integration. Browser tests use one worker because software WebGL is CPU-bound. Documentation-only changes need link/diff checks rather than another full scientific run.

Every scientific release records method and schema versions, exact fixture hashes, independent validation method/options, measured discrepancies, refusal states, and remaining limits. Goldens verify reproducibility; independent references and invariants verify meaning. Neither substitutes for the other.

Before marking a milestone complete:

- Its observable acceptance workflow passes on the production artifact.
- New failure, stale-result and cancellation states preserve unrelated work.
- Existing scientific outputs are unchanged unless an intentional versioned change is documented.
- Saved data compatibility and missing-dependency behavior are exercised.
- Current docs describe the implementation, while this plan receives a dated implementation record.
- Local fixture verification and deployed live-provider verification are reported separately.

## Implementation record

### M1 — Release consistency and deployment gate (2026-10-13)

- **Release identity.** Vite injects the package version; `src/domain/release.ts` collects it and existing scientific versions. Header text describes exploration/analysis/comparison, the footer reports v0.5.0, and the engine label derives from `contacts-2.1.0`. README and CLAUDE.md now agree with the ensemble default and current export/session versions.
- **One validation implementation.** `validate.yml` accepts the deployment path, performs a root smoke when needed, builds the requested deployment path, and tests it without rebuilding. CI retains its push/PR triggers and calls that workflow. Pages calls it before both push-triggered and manual deployment, then downloads/uploads the successful artifact without rebuilding. Only the deployment job has Pages write/id-token permissions.
- **Artifact identity and browser context.** Vite emits `build-info.json` with package version, base path and CI commit when available. The prebuilt browser command refuses a mismatched path, version or commit and never reuses an occupied preview server. `PLAYWRIGHT_ORIGIN` supports another local port. All browser navigation is relative to the configured base path. Local `test:e2e` builds once and then delegates to `test:e2e:built`.
- **Hosting evidence.** A new production-browser smoke test exercises both bundled structures, font/CSS assets, lazy rendering code, actual SIFTS and interaction worker execution, served artifact metadata and current UI labels. Frozen biology route setup is shared with the existing interpretation tests.
- **Verification.** All 190 scientific tests in 28 files pass, including unchanged scientific goldens. Formatting, TypeScript/production builds, root hosting smoke, and all 33 browser workflows at `/Molecules/` pass. Two consecutive smoke runs on the same preview port also pass, confirming server teardown between checks. Wrong-path and wrong-commit prebuilt checks refuse before browser launch. Workflow YAML parses and local structural checks confirm shared validation, restricted permissions, test-before-upload ordering, and the deployment dependency. Documentation links and whitespace checks pass.
- **Hosted checks remain separate.** GitHub Actions has not been dispatched and Pages has not been deployed during this implementation. `validation/RELEASE.md` defines reproduction commands and a fresh-browser post-deployment checklist for live providers/CORS, carrier lookup, comparison and pinned restoration. The package/scientific versions remain unchanged; v0.5.1 follows M2 as planned.

### M2 slice 2 — Structure-qualified selection and member-aware viewer (2026-10-14)

- **Contract.** `src/domain/selection.ts` defines `StructureRef`, `ResidueTarget`, `InvestigationRequest` (residue, site difference, fingerprint row) and a resolved `InvestigationView`: residues and exact interaction IDs per side (nearest first, ties by ID), the exact SIFTS correspondence or the reason there is none, fingerprint cells and change margins, and an input revision. A missing analysis is `not_available` with a reason, never an empty list.
- **Resolver.** `src/comparison/selection.ts` (`resolveInvestigation`, `refreshInvestigation`, `investigationRevision`) is pure. Fingerprint requests rebuild the matrix from the exact current runs for that slot; component rows list every receptor instance of the component and mark the row instance-ambiguous. A not-comparable pair has no comparison residue ID, so a comparison residue is located by its own SIFTS mappings as well. `refreshInvestigation` returns null (clear) when the reference snapshot or the target slot/snapshot is gone, the same object when the revision is unchanged, and a re-resolution otherwise (re-pairing, refit, new analysis or interpretation).
- **Viewer registry.** Each member records its raw-data, deposited-root and display-transform nodes, snapshot, selection index and display transform. Picking resolves the owning structure through the deposited root, which every component and transformed copy shares (Mol* flattens `parent` to the root and keeps unit IDs through `Structure.transform`), then looks up the unit/element. Selection builds loci on the displayed (transformed) structure so focus frames displayed positions; hidden members are skipped. `selectInteraction` accepts a structure and draws endpoints, centroids and water legs through the display transform once, on copies.
- **Controller.** `InvestigationController` is the only writer of the persistent selection. The reference's `selectedResidueId` is a projection of the resolved reference side (for a comparison residue, its exactly paired reference residue, or none). Store notifications are coalesced into one deferred pass resolved against the latest state; scene selection is re-applied only when resolved residues or slot visibility change. Hover is a separate transient target. Empty-space clicks clear; removing the slot or replacing the reference/model/assembly clears. Reference analysis target, receptor and settings are not written.
- **UI.** The hover label names a comparison structure's residues; a compact inspector card shows the comparison residue, its reference partner or reason, correspondence and each side's interaction count, plus a hidden-structure note. The full comparison inspector, keyboard-operable site/fingerprint rows and drawn comparison interactions are slice 3.
- **Verification.** 199 scientific tests in 29 files pass (9 new resolver tests: numbering offsets, the same source in two slots, assembly instances, insertion codes, non-polymer and ambiguous mapping, missing interpretation, multi-interaction fingerprint cells, site differences, re-pairing and reference replacement); scientific goldens unchanged. All 33 existing browser workflows pass on the production build. A new browser workflow picks a 1S0R residue in the superposed scene, checks its SIFTS partner, the unchanged reference analysis target, hidden state, empty-space clearing and removal; it passed three consecutive repeats. Hosted runs showed that hover picking (asynchronous in Mol*) is unreliable under software WebGL on CI runners: one of three runs, and then every run after a camera reset and zoom, saw no hover at all. The test therefore resets the camera, zooms onto the superposed pair and clicks outward from the centre (clicks pick synchronously) until a paired 1S0R amino acid is selected, reporting what each click hit if none is.

### M2 slice 3 — Linked fingerprint/site inspection and v0.5.1 (2026-10-14)

- **Controls.** Every comparison fingerprint cell and every binding-site row is a button (keyboard-operable, labeled with the structure, row and state, `aria-pressed` for the current selection) that issues a `fingerprint` or `site_difference` investigation request with focus. Reference fingerprint cells stay plain measurements. Rows of assembly copies name the operator (`A (ASM-2) · 88 · HIS 87`), because copies share author chain IDs.
- **Comparison inspector.** `ComparisonInspector.tsx` replaces the slice 2 card: request kind, hidden-structure and instance-ambiguity notes, correspondence and deposited residue change, a paired sequence strip, site shifts/χ changes for site rows, and per side the residues (author numbering, chain, operator), fingerprint state with gained/lost margins, and every interaction the selection covers from that structure's own current run, nearest first, with atoms, water mediator and cutoff margin. Links: UniProt entry and RCSB entry; Focus in 3D re-applies the selection.
- **Paired sequence strip.** `src/comparison/sequenceStrip.ts` lists, for the 15 UniProt positions around the selection, the deposited one-letter codes of both paired chains taken from exact SIFTS pairs only. Positions with no observed residue, `not_comparable` and unmapped positions are marked rather than filled; residue changes are flagged. The full reference sequence panel is unchanged.
- **Drawn interactions.** `drawnInteractions` (pure) chooses one interaction per side of a comparison investigation: the user's choice while still listed, else the nearest chemical interaction, else the nearest. A side without a measured interaction draws nothing, so a gained/lost cell highlights both residues but draws only the present interaction; the absent side states its absence and margin. `MolecularViewer.drawInteractions` draws any number of interactions of any structures (water legs and ring centroids included) through each member's display transform, without changing selection or camera; `selectInteraction` uses it. The investigation controller redraws on every install (a refit moves lines without changing residues), skips hidden members, and clears only lines it drew, leaving the analysis panel's own interaction drawing alone. Reference-only selections behave as before.
- **Navigation and layout.** A sticky section navigation links the viewer, sequence, analysis, interpretation, comparison and inspector; each target is focusable and the URL is not changed. It is hidden while the viewer is expanded, which navigation never exits. On wide layouts the inspector is sticky beside the explorer column; at 970 px and below it keeps its stacked position.
- **Fixed during visual verification.** Comparison-structure hiding and the water switch compared Mol*'s optional `isHidden` flag directly, so a never-toggled node (`undefined`) was never hidden: hiding a comparison structure kept its cartoon visible and water could not be switched off once shown. Both now treat a missing flag as visible. The browser suite checked only the application state, which is why it passed; `validation/RELEASE.md` now includes a manual visual check.
- **Scientific outputs unchanged.** No engine, ruleset, biology or comparison semantics changed; all goldens are unchanged and no version constant was bumped. The selection stays transient (no session-schema change). Package 0.5.1.
- **Verification.** 204 scientific tests in 30 files pass, including new tests for the paired strip (unobserved, ambiguous, mutated and unmapped positions; sequence start) and drawn-interaction choice (nearest, kept choice, fallback, chemical preference, water bridge on both sides, reference-only, and the 4HHB/1HHO His58 π-stacking cell drawn only where present). All 38 browser workflows pass on the 0.5.1 production build at `/Molecules/`, including four new ones: keyboard investigation of 3PTB/1S0R water-bridge, multi-interaction and binding-site cells with refit and unchanged reference analysis; a gained/lost cell in 4HHB/1HHO; a 1HHO assembly-copy (ASM-2) reference resolving to its own chain instance against 4HHB chain C; and section navigation, expanded-view preservation and the inspector at phone width. Rendered highlights and lines were checked by screenshots under global fit, no fit and a hidden structure; browser tests cannot see the scene, so this remains a manual check.


### M3 — Protein-level variant discovery (2026-10-15)

- Added a pure variant-table selector and a protein-wide discovery table: source-feature counts independent of chain copies, position/ID ordering, text/type/observed/contact filters, ten-row pagination, and expandable chain-instance coverage. Quoted descriptions, substitutions, uncertain bounds, evidence and records outside the deposited mapping remain visible.
- Reused interpretation projections and deposited-residue states; proximity, chemical and clash receptor membership stay separate. Missing or mismatched analysis disables contact filtering. Existing site summaries, consequence wording and complete interpretation exports are unchanged.
- Routed feature residue sets through M2's persistent investigation selection, including all observed positions of a multi-residue replacement. Extracted shared carrier controls for table and residue inspector; requests deduplicate per accession, support cancellation and retain pinned reuse and isolated failures.
- Package 0.5.2; scientific versions, golden files and session schema unchanged.
- **Verification.** All 214 unit/scientific tests in 32 files pass; formatting, type checking and production builds pass. Root-path hosting smoke and the variant workflows passed (6 browser checks); the complete suite passed all 40 workflows at `/Molecules/`. After a final control-styling adjustment, the two new table workflows passed again on the rebuilt artifact, with desktop and 390px screenshots reviewed. The table scrolls horizontally within its panel on narrow screens. Scientific golden files are unchanged. No deployment or live-provider/CORS verification was performed for M3.


### M4-A — Input contracts, pinned BEN chemistry and eligibility (2026-10-15)

- Added versioned pose inputs, complete chemical graphs, stable refusal codes and fixed protein-frame input identity. Input preparation works without interaction classification; coordinates are owned copies and no ligand fit or RMSD is calculated.
- Preserves charges, aromatic flags and atom/bond stereo; prefers complete embedded definitions with CCD fallback otherwise. Supplied embedded facts must agree with the chosen dictionary. Explicit coherent conformers, positive finite occupancy, complete heavy-atom coverage and a 256-heavy-atom bound are enforced. Deposited covalent links, ambiguous attachment records, HEM/metals and groups are refused.
- Pins existing BEN/3PTB/1S0R and negative fixtures by hash. BEN retains nine heavy atoms and its distinct terminal C–N bond/stereo labels. No scientific fixture or expected score was rewritten.
- Database version 5 adds immutable pose chemistry revisions and reserves pose-result storage. Offline pinned reads validate exact bytes and versions; missing pins do not fetch. The existing analysis cache and session/export schemas remain compatible. Package remains 0.5.2.
- **Verification.** All 244 unit/scientific tests in 34 files pass, including 30 new pose tests. Formatting, type checking, the `/Molecules/` production build and diff checks pass; existing scientific fixtures/goldens are unchanged. Three focused browser checks pass against that build: production hosting/assets/workers, comparison analysis/session restoration, and offline pinned interpretation/analysis restoration with explicit refresh. The complete browser suite was not rerun for this additive preparation/storage slice. See [M4-A evidence and limits](../validation/LIGAND_POSE.md). M4-B calculation/independent numerical validation and M4-C UI/session/export integration remain pending; no hosted deployment or live-provider check was performed.


### M4-B — Exact atom correspondence and fixed-frame RMSD (2026-10-15)

- Added pure `calculateLigandPose`, deterministic labeled-graph search, explicit tetrahedral/E/Z neighbor-parity checks, fixed protein-frame scoring, stable tie-breaking and complete atom-pair distances/provenance. Terminal H/D/T inventories preserve chemistry while heavy atoms alone enter the score. No ligand refit occurs. Ambiguous moving stereo environments are explicitly unsupported rather than silently removing mappings.
- Enforces 256 heavy atoms, 100,000 states and 4,096 complete maps; exhausted searches return no score. `pose-exact-1.0.0` enters input identity. The cancellable module worker has a 5-second operational watchdog, owned buffer transfers and guards against queued stale replies. UI/session/export integration remains M4-C; package/scientific comparison versions are unchanged.
- Independently generated and hash-pinned RDKit 2026.03.6 maps and in-place RMSD for five synthetic cases plus global/site BEN comparisons. Both BEN cases have exactly two admissible maps; corrected scores are 1.081198193559 Å (global) and 1.075828880790 Å (site), with no terminal nitrogen swap. The actual application protein-fit path also agrees within 1e-4 Å. See [full evidence and explicit limits](../validation/LIGAND_POSE.md).
- **Verification.** All 269 unit/scientific tests in 36 files pass, including 25 new M4-B tests. Formatting, type checking, the `/Molecules/` production build and diff checks pass. The isolated production-built worker passed all seven independent numerical fixtures plus supersession/abort/buffer checks in Chromium at `/pose-check/`. Existing scientific fixtures/goldens and the product UI are unchanged; the full product browser suite was not rerun for this calculator-only slice. No hosted deployment or live-provider check was performed. Additional real protein families and calibrated performance evidence remain release gates.


### M4-C — Pose UI, atom highlighting, exports and saved results (2026-10-15)

- Added per-slot pose calculation, coherent conformer controls, occupancy/fit context, unavailable/error/cancel states, cache mode, chemistry provenance and an inspectable atom map. No interaction analysis is required. Active pose inputs invalidate synchronously and recompute after ligand/conformer/occupancy/pairing/fit changes. Other analysis settings, fingerprint filters and visibility do not alter the result. Each slot owns its cancellation/generation and ignores stale work.
- M2 investigations now carry structure-qualified atom IDs. Selecting a pose pair highlights only those atoms (Mol* granularity is explicitly disabled) and draws its displacement with each display transform applied once. Refitting/removing/invalidating the pose clears that investigation; hiding a comparison leaves only the reference highlight. Endpoint distances are checked against the scientific result and source coordinates remain untouched.
- Comparison semantics `comparison-1.2.0`; comparison JSON schema 2 includes optional full pose inputs/maps/results and chemistry provenance, with typed coordinates as arrays. Export works without an interaction analysis. Session schema 4 pins result references, per-slot conformers and reference ligand/occupancy settings; schemas 1–3 remain readable. Exact result integrity and pinned chemistry bytes are verified offline. Missing/damaged/incompatible pins are unavailable until explicit recalculation. Valid revisions are immutable; conflicting output for one identity cannot replace a valid saved result.
- Package 0.6.0 is the local implementation version. Existing comparison golden dumps differ only in their version strings, verified by matching all four previous hashes after version normalization. Interaction/biology goldens and frozen scientific source/reference files are unchanged.
- **Verification.** All 286 unit/scientific tests in 37 files pass, including 17 new controller/storage/selection tests. Formatting, type checking, root/subpath production builds, root hosting smoke and diff checks pass. The complete final `/Molecules/` browser suite passes all 47 workflows in 12.5 minutes, including the seven new pose workflows. Desktop/390px and atom-highlight screenshots were reviewed. No deployment or live-provider/CORS verification has been performed. Additional real ligand families and limit/performance calibration remain required before claiming the broader M4 release gate.
