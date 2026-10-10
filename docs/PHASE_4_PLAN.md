# Phase 4 implementation plan: structural comparison

Status: planned 2026-10-10 on the `phase-4-comparison` branch. Baseline: `main` after the Phase 2.x ruleset release (engine `contacts-2.1.0`, ruleset `molstar-5.13.1-ligand-3`, `biology-1.1.0`, analysis JSON schema 3, interpretation JSON schema 2, Dexie version 3).

## Outcome and boundaries

A user compares deposited structures of one protein: with and without a ligand, with different ligands, in different conformational states, or carrying an engineered mutation. The application shows which residues correspond, how the structures superpose, which interactions are kept, gained or lost, and how the binding site moves. Every comparison states what it is based on, and any difference smaller than the coordinate error is labeled as such.

In scope:
- Up to eight structures in one workspace: the reference structure (the existing single-structure explorer) and up to seven comparison structures.
- Residue correspondence through the Phase 3 exact SIFTS mapping.
- Least-squares superposition.
- Interaction fingerprints keyed by UniProt position.
- Binding-site differences: residue displacement, side-chain torsions, conserved waters.
- Cache size accounting and eviction.

Out of scope:
- **Sequence alignment** for structures without SIFTS coverage, or of different proteins. Correspondence by alignment is an inference and would need its own labeling and validation; Phase 5 can add it.
- **Ligand pose RMSD with symmetry correction.** Matching symmetric atoms needs graph isomorphism over chemical definitions; deferred to Phase 5.
- **Structural alignment without correspondence** (TM-align, CE). Superposition here always uses SIFTS-paired residues.
- **Local coordinate files as comparison structures without a PDB association.** They can join a comparison only when associated with a PDB entry, the same rule as Phase 3 annotations.
- **Energies, affinities, scoring, protein–protein interfaces** (Phase 5).

## Decisions

Accepted 2026-10-10:

1. **Correspondence:** SIFTS/UniProt exact mapping only.
2. **Size:** pairwise first, then up to eight structures for the fingerprint matrix.
3. **Superposition:** our own deterministic least-squares fit, not Mol*'s alignment.
4. **Ligand pose RMSD:** deferred to Phase 5.

## Ground rules

1. **The reference workspace does not change.** The existing explorer state, controller and analysis stay as they are. Comparison structures live in a separate store and controller. A comparison structure has its own source, snapshot, analysis and interpretation, each built by the same code paths and versions as the reference.
2. **Deposited coordinates stay deposited.** Snapshots keep their assembly-frame coordinates. A superposition is a stored transform applied to the display and to comparison measurements, never written into a snapshot or an `AnalysisRun`.
3. **Comparisons state their basis.** Every residue pair, chain pairing and superposition records how it was obtained. Unpaired, unobserved, ambiguous and not-evaluated positions stay visible and are never counted as "absent".
4. **Like for like.** Fingerprints are compared only between analyses with the same engine, ruleset and parameters. Otherwise the comparison is refused with the reason.
5. **One version for comparison semantics.** `COMPARISON_VERSION` (starting at `comparison-1.0.0`) is bumped whenever comparison output can change, and comparison JSON has its own schema number.
6. **Validated against an independent computation.** Superposition is checked against numpy SVD on the same atom pairs; fingerprint differences against ProLIF 2.2.2 on the same structure pairs.

## Fixtures

Retrieved and inspected 2026-10-10 from RCSB. Frozen with SHA-256 manifests when each milestone starts.

| Entry | Content | Resolution | Role |
| --- | --- | --- | --- |
| 3PTB | Bovine trypsin with benzamidine (existing sample) | 1.7 Å | Reference |
| 1S0R | Bovine trypsin with benzamidine, same study as 1S0Q | 1.02 Å | Same ligand, different crystal and resolution: fingerprints should largely agree |
| 1S0Q | Native bovine trypsin (no ligand) | 1.02 Å | Apo/holo comparison with 1S0R: site differences and water conservation |
| 4HHB | Human deoxyhemoglobin, T state (existing sample) | 1.74 Å | Reference |
| 1HHO | Human oxyhemoglobin, R state (αβ dimer in the asymmetric unit) | 2.1 Å | Quaternary change: superposition outlier rejection, heme contact changes |

UniProt records P00760, P69905 and P68871 are already frozen. New fixtures: coordinates, SIFTS discovery and residue XML for 1S0R, 1S0Q and 1HHO; RCSB chemical component and ligand-instance records where the interpretation requests them.

## Milestones and acceptance gates

Estimates are engineering working days, excluding review. Total: 14–21 days.

### 4A — Workspace for several structures (3–5 days)

Files: `src/domain/comparison.ts`, `src/state/comparison.ts`, `src/comparison/controller.ts`, `src/structure/adapter.ts`, `src/data/repository.ts`, `src/data/cache.ts`, `src/components/ComparisonPanel.tsx`.

- **Comparison store and controller.** One slot per comparison structure, each with its own phase, error, source, snapshot, interpretation, analysis, ligand choice, visibility and generation counter. Loads, interpretations and analyses for different slots are independent; cancelling or failing one never affects another or the reference. Analyses run one at a time through a queue.
- **Viewer.** The Mol* adapter adds, removes, shows and hides comparison structures without clearing the scene, and accepts a display transform per structure. Comparison structures use one colour each. Picking stays bound to the reference structure: the selection index checks that a picked location belongs to the reference, because Mol* unit IDs restart in every structure.
- **Reference changes.** Loading a different reference structure clears the comparison, with a notice. Changing the reference model or assembly clears it too, since correspondence and transforms depend on them.
- **Sessions.** Session schema 3 adds the comparison: per slot the source hash, model, assembly, ligand selection, analysis cache key, interpretation ID and display transform. Restoring never refetches biological sources (pinned rule). Schema 1 and 2 sessions still restore.
- **Cache accounting and eviction.** Dexie version 4 adds `byteLength` and `lastUsedAt` to cached sources. After caching a source, least-recently-used sources are evicted while the total exceeds a budget (300 MB of coordinates), never evicting a source the saved session references. Analyses and interpretations of an evicted source are deleted with it. Eviction planning is a pure function with unit tests. The Source tab shows cache use and offers to clear unreferenced entries.
- **Limits.** At most seven comparison structures. Each obeys the existing per-structure limits (40 MB input, 250,000 selected atoms).

Acceptance: a second structure loads beside the reference with its own snapshot, interpretation and analysis; failing or cancelling it leaves the reference untouched; the session restores both; eviction keeps referenced sources; no change to engine output (goldens untouched).

### 4B — Residue correspondence (2–3 days)

Files: `src/comparison/correspondence.ts`, `tests/comparison-correspondence.test.ts`.

- **Chain pairing.** For each UniProt accession shared by the two structures, reference chain instances are paired with comparison chain instances. Basis, in order: same author chain ID and operator (`same_author_chain`), then order of appearance (`chain_order`). The user can override a pairing (`user`). Homo-oligomers (hemoglobin α1/α2) therefore pair explicitly, never by accession alone.
- **Residue pairs.** Within a chain pair, residues pair when both mappings are `exact` at the same UniProt position and both residues are observed. Each UniProt position gets one status: `paired`, `reference_only`, `comparison_only` or `not_comparable` (ambiguous or conflicting mapping in either structure). Pairs whose residues differ (engineered mutations) stay paired and carry both residue identities.
- **No shared accession.** The comparison explains that the structures share no UniProt accession and offers nothing else.

Acceptance: 3PTB↔1S0R pairs all observed trypsin residues by UniProt position although author and label numbering differ between entries; 4HHB↔1HHO pairs chains A↔A and B↔B and reports the 4HHB-only C and D chains; synthetic mapping edge cases (ambiguous, unobserved, mutated) get the expected statuses.

### 4C — Superposition (2–3 days)

Files: `src/comparison/superposition.ts`, `tests/comparison-superposition.test.ts`, `validation/comparison.json`.

- **Fit.** Least-squares rigid fit (Horn's quaternion method; Horn, J. Opt. Soc. Am. A 4, 629, 1987) of paired Cα atoms, mapping the comparison structure onto the reference. Atoms come from each residue's preferred conformer with positive occupancy.
- **Outlier rejection.** Up to five cycles, each rejecting pairs deviating by more than twice the current RMSD, stopping when nothing changes or fewer than half the pairs (or fewer than 10 atoms) would remain. The result reports all-pair RMSD, core RMSD, atoms fitted, atoms rejected and cycles.
- **Scopes.** Whole structure (all paired residues of the chosen chain pairs) or binding site (paired residues within the reference analysis binding site; needs at least 10 pairs).
- **Display.** The transform is applied to the comparison structure in Mol* and stored in the session. Runs on the main thread: at most 8 × 250,000 atoms bounds the input, and Cα-only fits are a few thousand atoms.

Acceptance: synthetic rotations and translations are recovered to 1e-4 Å; on 3PTB↔1S0R and 4HHB↔1HHO the core RMSD and transform match an independent numpy SVD fit on the same pairs within 1e-3 Å (pinned in `validation/comparison.json`); 4HHB↔1HHO whole-tetramer fitting rejects atoms because of the T→R quaternary change, and a single αβ dimer fits with low RMSD.

### 4D — Interaction fingerprints (3–4 days)

Files: `src/comparison/fingerprint.ts`, `src/components/FingerprintMatrix.tsx`, `tests/comparison-fingerprint.test.ts`, `scripts/comparison-reference.py`.

- **Cells.** One row per reference chain instance, UniProt position and interaction type; one column per structure. Each cell is `present`, `absent`, `not_evaluated` (the type was not evaluated, or chemistry was skipped for an incomplete residue) or `not_observed` (no observed residue at that position in that structure, or no chain pairing). Interactions with non-polymer receptor components (cofactors, ions) form separate rows keyed by component ID and are marked as not UniProt-mapped.
- **Comparability.** Columns are compared only when the engine, ruleset and parameters match the reference analysis. A mismatching column is shown as refused with the differing fields.
- **Similarity.** Tanimoto over cells that are `present` or `absent` in both structures; the number of excluded cells is shown beside it.
- **Exports.** Comparison JSON (schema 1) with members, chain pairings, correspondence summary, transforms, fingerprints and every version; CSV of the matrix.

Acceptance: 3PTB↔1S0R share the benzamidine salt bridge to Asp189 (UniProt 194) and the core hydrogen bonds; not-evaluated and not-observed cells are never counted as absent; a parameter change refuses the comparison; gained and lost bits agree with ProLIF 2.2.2 run on the same pairs, with every disagreement explained in `validation/COMPARISON.md`.

### 4E — Binding-site differences (2–3 days)

Files: `src/comparison/siteDifferences.ts`, `src/comparison/torsions.ts`, `tests/comparison-site.test.ts`.

- **Displacement.** After superposition, for each paired residue in the union of both binding sites (or, for a structure without an analysis, residues within the reference binding site): Cα displacement and the RMSD of side-chain heavy atoms matched by atom name.
- **Torsions.** χ1 and χ2 for the standard amino acids (IUPAC-IUB definitions) and their change, accounting for the symmetric side chains of Asp, Glu, Phe and Tyr.
- **Coordinate error.** Displacements are compared with √(σ_ref² + σ_cmp²), where σ is each structure's Cruickshank DPI coordinate error from 3J. A displacement under twice that is labeled `within_coordinate_error`. Without DPI the comparison says the significance cannot be assessed.
- **Waters.** Binding-site waters of the reference (within 4 Å of the ligand or a binding-site residue) are `conserved` when a comparison water oxygen lies within 1.0 Å after superposition, otherwise `not_conserved`. Waters are reported per structure, not as a claim of displacement.

Acceptance: 1S0Q↔1S0R and 3PTB↔1S0R report displacements below coordinate error for most site residues and identify any residue that moves; symmetric side-chain flips are not reported as torsion changes; water conservation is reported for the apo/holo pair; the 4HHB↔1HHO heme pocket shows the expected T→R shifts.

### 4F — Validation and release (2–3 days)

Files: `validation/COMPARISON.md`, `validation/comparison.json`, `tests/e2e/comparison.spec.ts`, README, CLAUDE.md, `docs/PHASE_4_STATUS.md`.

- Pinned comparison outputs for the three fixture pairs, hash-checked like the engine goldens.
- Browser workflows: add a comparison structure, pair chains, superpose, read the fingerprint matrix, export, save and restore; failure isolation (a failed comparison load leaves the reference analysis intact).
- Documentation of every rule, limit and validated discrepancy.

Acceptance: all gates above pass in CI; the release records the comparison version, schema numbers and validation evidence.

## Risks

- **Mol* scene with several structures.** Selection, focus and the binding-site component assume one structure. Keeping picking bound to the reference avoids a large adapter rewrite; comparison structures are display-only in 4A.
- **Memory.** Eight large structures can exhaust browser memory. The per-structure atom limit and the seven-structure cap bound it; very large assemblies may still fail and must fail per slot.
- **ProLIF agreement.** Per-structure agreement between the tools is already below 1 (see `validation/README.md`), so the fingerprint validation measures agreement on differences, not identity.

## Implementation record

- **4A.** As planned.
  - **Viewer.** Comparison structures are display-only cartoons in one colour each, drawn through a Mol* transform node. Picking checks `loc.structure.root` against the reference structure.
  - **Store and controller.** `src/state/comparison.ts` and `src/comparison/controller.ts`. Each slot has its own generation and abort controller, and analyses run one at a time.
  - **Comparison analysis request.** The slot's ligand, all of its polymer chains as receptor, and the reference's current parameters. The default ligand is an instance of the reference target's component when one is present.
  - **Sessions.** Saved as schema 3 only when the comparison has structures; otherwise schema 2, so older deployments can still read them.
  - **Cache accounting.** Kept in a separate `sourceUsage` table, so eviction never loads coordinate bytes. Dexie version 4 fills it from existing sources on upgrade.
  - **Local files** load as comparison structures but get no residue mapping, so they cannot be paired.
  - **Fixtures.** 1S0R, 1S0Q and 1HHO coordinates (gzip of the downloaded bytes, with both hashes in the manifest), SIFTS and RCSB records frozen in `tests/fixtures/biology`.
- **4B.** As planned.
  - **Code.** `src/comparison/correspondence.ts` holds the pure function, memoized per slot in `src/comparison/derived.ts`. The panel shows the pairing table with a per-chain override, correspondence counts, residues that differ and unpaired chains. Overrides are saved in the session.
  - **Receptor chains.** A comparison analysis uses the comparison chains paired with the reference's receptor chains, or every polymer chain while no correspondence exists. The run records the choice.
  - **Finding.** Author numbering differs at every one of the 223 trypsin positions: 3PTB uses chymotrypsinogen numbering (16…), 1S0R starts at 1 and 1S0Q at 660. SIFTS pairs all 223 exactly. Pairing by author numbering would have been wrong throughout.
  - **4HHB↔1HHO.** Pairs A↔A and B↔B (287 residues); 4HHB chains C and D stay unpaired, because 1HHO deposits one αβ dimer.
- **4C.** As planned, with two deviations.
  - **Binding-site scope.** It means reference residues within 8 Å of the reference target ligand, not the analysis binding site. It needs no completed analysis, and an 8 Å pocket gives enough atoms for a fit (32 Cα for benzamidine against roughly 12 contact residues).
  - **Acceptance wording.** The 4HHB↔1HHO tetramer is fitted from assembly 1 of both entries. The quaternary change shows as a core RMSD of 2.24 Å against 0.62 Å for the αβ dimer; rejection removes only 11 atoms, because deviations spread over whole subunits.
  - **Validation.** All six fixture fits match numpy SVD exactly (`validation/COMPARISON.md`).
  - **Behavior.** The fit runs automatically once both residue mappings exist, and again whenever pairings, scope or the reference ligand change. The scope is saved in the session, and the stored transform is shown until the fit is recomputed.
- **4D.** As planned, plus distance margins.
  - **Margins.** Every gained or lost cell records how far it lies from the cutoff, and changes within 0.5 Å are flagged `marginal`. This came from the ProLIF comparison: the two tools agree on none of the changes, and every disagreement is a contact near one tool's cutoff (4.0 vs 4.5 Å) or a type ProLIF does not detect here.
  - **Second hemoglobin pair.** The ProLIF check uses 2DN2↔2DN1 (1.25 Å deoxy/oxy). Open Babel fragments 4HHB's heme, and ProLIF then reports no interactions.
  - **Scope.** Fingerprints cover chemical interaction types only, not proximity or clashes.
  - **Unplaced interactions.** Interactions whose residue has no exact mapping or chain pairing are counted per column.
  - **Exports.** Comparison JSON (schema 1) and fingerprint CSV.
  - **Shared preparation.** `scripts/reference-set.py` gained a `main()` guard so its preparation can be imported. Regenerated observations are identical as sets; only ProLIF's output order varies.
- **4E.** As planned.
  - **Site definition.** The 4 Å binding-site union became residues within 5 Å of either structure's ligand. It works for apo comparisons and does not depend on contact rules.
  - **Significance.** "Beyond 2σ" uses the combined DPI. At atomic resolution (1S0R↔1S0Q, σ 0.031 Å), most site residues exceed it with shifts under 0.4 Å. The panel explains that DPI describes an average-B atom and leaves out fit error, and always shows the shift.
  - **Outputs.** Site differences are included in the comparison JSON.

