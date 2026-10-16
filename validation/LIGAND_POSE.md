# Ligand pose validation — M4-A, M4-B and M4-C

Implemented 2026-10-15. M4-A prepares eligible ligand inputs and pins chemical definitions. M4-B adds exact bounded atom correspondence, fixed-protein-frame RMSD and cancellable worker execution. M4-C exposes the workflow in comparison slots, highlights atom pairs, exports full pose records and restores exact saved results. Local package is 0.6.0, comparison semantics `comparison-1.2.0`, comparison export schema 2 and session schema 4. Interaction/biology methods and existing numerical outputs are unchanged; comparison goldens change only with the version string. Broader real-family/performance and hosted gates remain pending.

## Input and chemistry contracts

`src/domain/ligandPose.ts` defines `ligand-pose-1.0.0` input policy and `pose-chemistry-1.0.0` parsing policy. `prepareLigandPose` in `src/data/ligandChemistry.ts` accepts exact coordinate source bytes, their parsed snapshot, one ligand residue, an abort signal and optional conformer/occupancy/pinned-chemistry choices. It requires no interaction analysis.

1. Verify the source byte hash against both source and snapshot. Read embedded atom/bond definitions and source-recorded attachment context directly from mmCIF or BinaryCIF.
2. Prefer a complete embedded graph. Otherwise use a compatible cached CCD revision or request the component's CCD record. An explicit refresh requests a new CCD revision when embedded chemistry is incomplete. Fetches have an 8-second timeout and 2 MiB byte bound.
3. Preserve element, formal charge, explicit aromatic flags and atom/bond stereochemical labels, including hydrogen connectivity. Missing values remain unknown. Reject malformed labels, duplicate identities/bonds, undefined endpoints, contradictions and disconnected graphs. A known embedded fact must agree with the selected dictionary; fallback never silently repairs a contradiction.
4. Normalize explicitly aromatic bonds to `AROM` while retaining their source bond orders. No distance-based bonding, aromaticity perception, charge inference, tautomer conversion or resonance-equivalent terminal-group swapping is performed.
5. Save exact bytes, SHA-256, normalized graph hash, source URL/origin and retrieval time with parser/policy versions. The graph hash omits alternative Kekulé source orders only where explicit aromatic flags establish the normalized identity.

The source fields follow the wwPDB definitions for [chemical atoms](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Categories/chem_comp_atom.html), [chemical bonds](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Categories/chem_comp_bond.html), [atom stereo (`N`, `R`, `S`)](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Items/_chem_comp_atom.pdbx_stereo_config.html), [bond stereo (`N`, `E`, `Z`)](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Items/_chem_comp_bond.pdbx_stereo_config.html) and [explicit bond aromaticity](https://mmcif.wwpdb.org/dictionaries/mmcif_pdbx_v50.dic/Items/_chem_comp_bond.pdbx_aromatic_flag.html). Unknown stereo is distinct from `N`. Preserving these labels alone does not establish that an atom permutation preserves stereochemistry; M4-B checks neighbor permutations separately, as described below.

## Eligibility and fixed protein frame

`preparePoseLigand` in `src/comparison/ligandPoseInput.ts` is the pure eligibility boundary. It returns owned arrays and provenance, or `not_evaluated` with a stable reason code.

- One nonpolymer ligand residue; no groups, ions, branched ligands, metal-containing ligands (including HEM), or deposited external covalent attachments. Ambiguous attachment identifiers/symmetry are refused. `no_recorded_link` means no applicable source record was found, not proof from coordinate geometry that a ligand is noncovalent.
- All dictionary heavy atoms must have exactly one eligible coordinate atom with the expected name, element and specified charge. Hydrogen, deuterium and tritium are excluded by element. The full chemical graph still retains their stereo context.
- Alternate labels require an explicit coherent choice, even when only hydrogen atoms carry alternates. Use shared atoms plus that label; never mix independently preferred atoms or minimize across conformer pairs.
- Occupancy must be finite, positive and strictly greater than the recorded minimum (default 0; allowed policy range 0–1). Excluded atoms can make a ligand incomplete. Coordinate values must be finite. Maximum 256 heavy atoms.

`preparePoseInput` requires the same component ID and normalized graph hash on both sides, plus a proper finite rigid protein transform and its input identity. Scale, shear and reflection are refused. It records the complete fit and both ligand contexts in a SHA-256 input key. Positions are owned Float64 copies of the snapshot's existing Float32 assembly-space coordinates; this does not restore precision lost during extraction. Preparation neither applies a ligand fit nor computes a score.

## Pinned fixtures

`tests/fixtures/ligand-pose/manifest.json` pins existing, unchanged BEN CCD, 3PTB mmCIF/BinaryCIF, 1S0R, 5P9J and 4HHB files. The manifest's date is a pinning date, not an invented retrieval date. Hashes refer to the stored files, including compressed bytes where applicable; preparation uses decompressed coordinate bytes and their hash.

The frozen BEN dictionary has 17 atoms and 17 bonds including hydrogen, nine heavy atoms, and six explicitly aromatic bonds. Its terminal bonds differ: `C–N1` is `DOUB` with `E` stereo; `C–N2` is `SING` with `N` stereo. They must not be treated as an unconstrained terminal nitrogen swap. The embedded BEN graph in bundled 3PTB lacks formal charges and therefore uses CCD fallback. Both 3PTB and 1S0R prepare nine eligible heavy atoms without interaction classification. These are input checks, not independent RMSD validation or expected RMSD values.

Synthetic edits are explicitly labeled in the tests: malformed/unknown chemistry, changed stereo, missing/duplicate atoms, non-finite coordinates, occupancies, alternate labels, attachment records and metadata-only CCD revisions. Real exclusions use 5P9J's covalently attached 8E8 and 4HHB's metal-containing HEM.

## Storage and restoration

Dexie database version 5 adds `poseChemistry` and reserves `ligandPoses`. Previous schemas and the legacy component-ID chemistry cache are retained. Chemistry writes are add-only, keyed by component, origin, byte hash and parser/policy versions; a refresh never replaces an existing revision's bytes or retrieval metadata. Result storage has a contract but no result writer in M4-A.

Supplying a pinned chemistry ID performs an offline lookup and rechecks bytes, graph hash and compatible versions. Missing/damaged pins return `pinned_chemistry_missing` without a network request. Pinned restore cannot also request refresh. Operational failures (fetch, cancellation, storage) throw rather than becoming scientific measurements. M4-A left session schema 3 and comparison export schema 1 unchanged; M4-C adds schema 4/2 integration below.

## M4-A verification

- `tests/ligand-pose-input.test.ts`: frozen hashes/BEN facts, text/BinaryCIF inputs, explicit graph conflicts, completeness, conformer/occupancy rules, attachment checks, unsupported ligands, owned buffers, input identity and rigid-transform validation.
- `tests/ligand-pose-chemistry.test.ts`: fixture-backed CCD fallback, embedded authority, revision coexistence, offline exact pins, corruption/conflict refusals, bounded acquisition/abort behavior, and a populated database version 4 upgrading to 5 without losing sources, analyses, old chemistry or session data.
- All 244 unit/scientific tests in 34 files passed, including 30 new pose tests. Formatting, type checking and the `/Molecules/` production build passed; existing scientific fixtures/goldens are unchanged.
- Three browser checks passed against the completed build: production assets/workers, comparison analysis/session restoration, and offline pinned interpretation/analysis restoration with explicit refresh. These verify the existing application on database version 5; the populated version 4 migration is covered by the unit test. The full browser suite was not rerun for M4-A.

Commands: `npm test`; `npm run format:check`; `VITE_BASE_PATH=/Molecules/ npm run build`; `PLAYWRIGHT_ORIGIN=http://127.0.0.1:4180 PLAYWRIGHT_BASE_PATH=/Molecules/ npm run test:e2e:built -- deployment.spec.ts interpretation.spec.ts comparison.spec.ts --grep 'production hosting|restores pinned interpretation and analysis|a comparison structure has its own mapping and analysis'`.

The M4-A checks established input eligibility and storage behavior, without numerical RMSD claims. M4-B evidence follows; the remaining release gates are listed at the end.


## M4-B calculation and mapping policy

`calculateLigandPose(input)` in `src/comparison/ligandPose.ts` is pure. It returns an evaluated result only after enumerating the complete admissible mapping set. `pose-exact-1.0.0` identifies the algorithm; `preparePoseInput` includes that version in its input hash, so inputs created before the calculator version was recorded are incompatible. The existing `ligand-pose-1.0.0` chemistry/eligibility policy remains unchanged.

- `poseMappings.ts` validates the actual graphs as well as their declared identity. Candidates preserve elements, charges, normalized aromatic/bond labels, atom/bond stereo, degree and terminal H/D/T inventories. Shared neighborhood-color refinement narrows candidates, followed by deterministic backtracking with exact edge/non-edge checks. Atom names address source atoms and provide stable ordering; they do not constrain chemically permitted permutations.
- Terminal H/D/T atoms are retained in the chemical graph and collapsed into labeled inventories during heavy-atom search. Supported stereo contexts cannot have equivalent hydrogen neighbors at a stereo site, so one canonical hydrogen extension suffices. Nonterminal hydrogen graphs are refused. Hydrogens never enter the RMSD sum or the reported map count.
- A fixed tetrahedral site must preserve the parity of its four explicitly bonded neighbors. An E/Z bond must preserve the combined substituent parity at its two ends. Matching R/S or E/Z labels alone is insufficient. The common named graph supplies the neighbor frame when a site stays fixed. A moved stereo site is supported only when invariant neighbor colors distinguish its ordering; otherwise the **entire calculation** returns `unsupported_stereo`. An uncertain candidate is never silently dropped while claiming an exact minimum.
- The initial implementation therefore does not provide general CIP assignment, implicit-neighbor tetrahedral stereo, axial/non-tetrahedral stereo or unrestricted symmetry between unresolved stereo environments. It accepts the deposited labels as constraints and does not infer stereochemistry from distorted experimental ligand coordinates. These explicit limits preserve the declared exactness for supported inputs.
- Production bounds are 256 heavy atoms, 100,000 visited search states (including the root) and 4,096 admissible heavy-atom maps. Attempting a state/map beyond its limit returns `search_limit`/`map_limit` with no partial maps or score. A search finishing exactly at the limit is complete. Labels/neighbor preparation are also bounded by the worker deadline; these limits are policy values, not measured performance guarantees.
- Only the comparison coordinates receive the supplied column-major proper rigid protein transform. The calculator performs no ligand fitting or centering. It computes equal-weight heavy-atom RMSD for every admissible map, retains the name-matched score, and selects the minimum. Maps within 1e-12 Å of the numerical minimum tie by comparison atom IDs in sorted reference-atom-ID order. The reported score and per-pair distances belong to the selected map.
- Evaluated results carry algorithm/policy versions, input key, matched count, admissible map count, visited states, full fit/scope and input identity, both source/ligand/conformer/occupancy/chemistry contexts, and every atom pair with distance in Å. Scientific refusals remain distinct from operation failures.

## Worker lifecycle

`LigandPoseClient` runs graph preparation/search/scoring in `ligandPoseWorker.ts`. It transfers distinct owned coordinate copies, including when reference and comparison originally share a buffer. Starting a replacement request terminates the old worker. Explicit cancellation or an AbortSignal rejects with `AbortError`; the 5,000 ms startup/execution watchdog rejects with `TimeoutError`. Neither produces a measured result. Ownership and input-key guards ignore queued late events. Different clients remain independent. Coordinate ingestion/CCD acquisition still use M4-A's separate preparation interface; M4-C owns slot state and invokes the calculator.

The worker is validated through an isolated, production-built test entry at `/pose-check/`. This exercises Vite's emitted module worker and real Chromium execution without adding a hidden product feature. M4-C also exercises the worker through production comparison controls, slot invalidation, exports and saved results.

## Independent M4-B reference

`scripts/ligand-pose-reference.py` uses RDKit **2026.03.6** (package `2026.3.6`), NumPy **2.4.2** and Gemmi **0.7.5**. It independently parses the existing CCD/coordinate files, constructs explicitly hydrogenated chemical graphs, enumerates full-graph matches with `useChirality=True`, `uniquify=False` and `maxMatches=100000`, then projects and deduplicates heavy-atom maps. Exhausting that reference limit fails generation. It never reads the application's mapping output.

The reference applies the previously pinned NumPy protein transform and calls RDKit `CalcRMS` with independently generated maps and `symmetrizeConjugatedTerminalGroups=False`. `CalcRMS` measures in place; `GetBestRMS` would add a ligand alignment and is not used. See the [RDKit alignment documentation](https://www.rdkit.org/docs/source/rdkit.Chem.rdMolAlign.html). Tetrahedral/E/Z labels and permutation handling are separate concerns; RDKit's [stereochemistry discussion](https://www.rdkit.org/docs/RDKit_Book.html#stereochemistry) describes its stereo assignment and matching model.

`tests/fixtures/ligand-pose/reference.json` records complete admissible map sets, minima, name-matched scores, exact coordinate inputs/transforms and source hashes. `reference-manifest.json` pins both that output and its generator. Existing coordinate, CCD and engine/comparison golden files are unchanged. Synthetic SMILES and algebraic coordinates are labeled artificial; the coordinates are not claimed to be molecular conformations. Separate artificial graph tests isolate parity constraints and combinatorial limits without claiming chemically valid molecules.

Observed results, using Float32-extracted coordinates promoted to Float64 and the frozen protein transforms:

- **3PTB/1S0R BEN, global fit:** 2 maps; corrected **1.081198193559 Å**, name-matched **1.901536092844 Å**.
- **3PTB/1S0R BEN, binding-site fit:** 2 maps; corrected **1.075828880790 Å**, name-matched **1.898440781472 Å**.
- Five synthetic cases match RDKit's complete map sets: a ring (8), an asymmetric graph (1), a tetrahedral stereocenter (1), paired stereocenters (2), and E/Z alkene stereo (2). Coordinate permutations chosen from admissible maps give corrected zero, as expected.

The frozen-transform score checks use 1e-10 Å tolerance; the observed Chromium differences on these seven cases were below 2e-15 Å. A separate integration check prepares the actual BEN snapshots and uses the application's existing global/site protein fits; those scores agree with the independently fitted reference within 1e-4 Å. These numerical agreements are about the same frozen inputs and declared strict graph policy, not universal accuracy bounds.

An independent exhaustive permutation check for the small ring compares the entire map set and minimum without the application's refinement/backtracking. Additional exact tests cover residual 3–4–0 displacement (5 Å), a known rotation plus translation, invariant input buffers, reflection/scale/shear refusal, deterministic ties under reordered arrays, terminal nitrogen distinction, stereo parity, ambiguous moving stereo, and no score on exhausted budgets.

Reproduce the independent observations and real-worker check:

```sh
UV_CACHE_DIR=/tmp/molecules-pose-uv-cache uv venv --python python3.12 /tmp/molecules-pose-reference
UV_CACHE_DIR=/tmp/molecules-pose-uv-cache uv pip install --python /tmp/molecules-pose-reference/bin/python rdkit==2026.3.6 numpy==2.4.2 gemmi==0.7.5 pillow==12.3.0
/tmp/molecules-pose-reference/bin/python scripts/ligand-pose-reference.py
npx vitest run tests/ligand-pose-calculation.test.ts tests/ligand-pose-client.test.ts
node scripts/ligand-pose-worker-check.mjs
```

The browser script creates and removes its own temporary build, uses local port 4182, and leaves the application's `dist` untouched. It checks seven reference scores/map counts plus supersession, AbortSignal cancellation and caller-buffer retention. Deterministic client tests additionally exercise timeout, queued late replies, worker/serialization errors and separate clients.

## M4-B verification result

All **269 unit/scientific tests in 36 files** pass, including **25 new M4-B tests** (20 calculation/reference checks and 5 deterministic client-lifecycle checks). Source/test formatting, type checking, the `/Molecules/` production build and diff checks pass. The separate production-built worker harness passed all seven reference cases and lifecycle/buffer checks in Chromium. No source scientific fixtures or existing goldens were changed. The full product browser suite was not rerun because M4-B adds no product UI/controller wiring; the real-worker check covers the new runtime path.

## M4-C UI and per-slot lifecycle

`LigandPoseSummary.tsx` exposes Calculate/Recalculate pose, per-side coherent conformers, the reference occupancy threshold, cancellation, fixed-fit context, corrected/name-matched RMSD, matched atoms, permitted maps, cache/pinned mode and the chosen chemistry hashes. An explicit refresh action requests chemistry again and recalculates. Refusals and operation errors are visible without clearing interaction analyses or other slots. HEM remains unavailable.

`PoseController` owns each slot's preparation abort, worker and current input identity. A changed ligand, conformer, occupancy, pairing, fit scope/transform or source context removes the displayed result synchronously. Active poses recompute; fingerprint filters, non-occupancy interaction settings and visibility do not affect the measurement. Obsolete alternate labels are cleared when a ligand changes; another alternate is never selected automatically. The shared `comparisonFitKey` prevents scoring against a fit from earlier pairing/interpretation inputs while a refit is pending. Store notifications are guarded against reentrant scheduling: changing one shared reference setting starts one replacement per active slot. Cancellation, removal, disposal and queued stale successes cannot install a result into another input context or slot.

The atom-map inspector submits an M2 `pose_atom` investigation with slot/snapshot/result and atom identities. Both sides carry atom IDs as well as residue context. The viewer bypasses Mol*'s default residue granularity for already-resolved loci, so only the selected atoms are highlighted. The displacement is a geometric line with its own label, not an inferred chemical interaction. `poseDisplacementPoint` returns owned displayed endpoints and applies each structure's transform exactly once; unit tests compare every drawn endpoint distance against the scientific result and verify snapshot buffers stay unchanged. Hidden comparisons draw neither their atom highlight nor the displacement; the reference atom remains selected. A changed or removed result clears the atom investigation.

Desktop and 390px screenshots were reviewed. The atom selection review caught and fixed Mol*'s automatic atom-to-residue expansion. The paired atom list scrolls within the panel and controls fit the narrow viewport. Browser tests also exercise keyboard-capable native selects/buttons and focus the selected atom pair in the rendered scene.

## M4-C export, result integrity and session restoration

Comparison JSON **schema 2**, `comparison-1.2.0`, adds optional per-slot pose selections, full prepared input and result, every mapped atom pair/distance, chemical graphs, source/chemistry hashes, parser/policy/algorithm versions, fixed transform/scope/fit identity, and chemistry origin/URL/retrieval metadata when available locally. Float64 coordinate buffers are explicitly serialized as arrays. Non-evaluated states remain reasons, not zero scores. **Export pose JSON** uses the same comparison format without requiring interaction classification; the fingerprint export action also exports the complete comparison independent of row filters. Original source bytes are not packaged and these analytical records are not workspace import bundles.

`data/poseResults.ts` stores evaluated inputs/results together with an integrity hash. Valid revisions are retained for the same full input key; conflicting output cannot replace one. A corrupted record is refused and can be repaired by explicit recalculation. New definitions remain hash-addressed add-only revisions. A successful measurement can be displayed/exported when result storage fails, but the UI explains it was not saved and the session does not claim a persisted result reference.

Session **schema 4** adds per-slot pose conformers/result references and the reference's ligand and minimum occupancy, including sessions where no interaction analysis has run. Descriptors also retain the exact selected protein fit and its input identity. Readers accept schemas 1–4. Restoration waits for pinned reference/slot context, loads the saved record, checks its integrity and supported versions, re-prepares both ligands using explicit pinned chemistry IDs without requests, and requires the recreated complete input key to equal the saved key. This validates the record without re-running the map search or presenting a new calculation as the saved one. Missing, damaged or incompatible results/chemistry show unavailable and require an explicit recalculation. Saved pose settings take precedence over settings from an older pinned interaction run.

M4-C adds 17 deterministic controller/storage/selection tests: cache reuse without interaction classification; occupancy and fit invalidation; coherent conformers; unrelated-filter/visibility stability; cancellation/removal/disposal and late replies; slot isolation and single scheduling on shared changes; exact offline restore; missing/corrupt pins; mismatched current inputs; explicit damaged-result repair; immutable valid results; typed-coordinate/full-provenance exports; structure-qualified atom selection; transformed endpoint agreement; and schemas 1–4.

Seven production browser workflows cover the complete UI path: calculation without interaction analysis, full export, paired atom inspection, global/site fit and occupancy changes, cached reuse and narrow layout; schema 4 exact offline restoration; separate missing-result and missing-chemistry restorations with no requests; cancellation/removal during delayed chemistry; an explicitly labeled synthetic alternate conformer; and HEM refusal alongside a usable hemoglobin comparison.

## M4-C verification result

All **286 unit/scientific tests in 37 files** pass, including the 17 new M4-C tests. Formatting, type checking, root/subpath production builds and root hosting smoke pass. The final complete `/Molecules/` browser suite passes all **47 workflows** (12.5 minutes), including the seven new pose workflows. Desktop/390px and atom-highlight screenshots were reviewed. Existing comparison output dumps match all four prior golden hashes after normalizing only `comparison-1.2.0` back to `comparison-1.1.0`; the expected golden changes are version-only. Engine/biology goldens and pinned coordinate/CCD/reference observations are unchanged.

Reproduce: `npm test`; `npm run format:check`; `VITE_BASE_PATH=/Molecules/ npm run build`; `PLAYWRIGHT_ORIGIN=http://127.0.0.1:4180 PLAYWRIGHT_BASE_PATH=/Molecules/ npm run test:e2e:built`. Focus the new workflows with `-- ligand-pose.spec.ts`. Do not rebuild while browser checks are running.

## Remaining release gates

Broader same-component pairs from at least three additional protein families and calibrated search/performance evidence remain required before the broader M4 release claim. No deployment or live-provider/CORS check was performed. M4-C supplies the requested UI, atom highlighting, exports and saved results locally; hosted checks remain distinct from these deterministic results.
