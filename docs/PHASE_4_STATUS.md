# Phase 4 implementation status

Updated 2026-10-10. Comparison `comparison-1.0.0`, comparison JSON schema 1, session schema 3, Dexie version 4. Engine, ruleset and biology versions are unchanged (`contacts-2.1.0`, `molstar-5.13.1-ligand-3`, `biology-1.1.0`). Plan and implementation record: [PHASE_4_PLAN.md](PHASE_4_PLAN.md). Validation: [validation/COMPARISON.md](../validation/COMPARISON.md).

## Implemented

- **4A: workspace.** Up to seven comparison structures beside the reference.
  - Each has an independent source, snapshot, pinned interpretation and queued analysis.
  - They are display-only Mol* cartoons drawn through a transform node.
  - Failures are isolated from the reference.
  - Session schema 3 saves and restores them.
  - Least-recently-used eviction of cached coordinates beyond 300 MB never removes open or saved-session sources.
- **4B: correspondence.** Chain pairing per shared UniProt accession (user, same author chain, chain order), with user overrides saved in the session. Residue correspondence is exact SIFTS only, with explicit unpaired and not-comparable statuses and residue changes.
- **4C: superposition.** Horn least-squares fit of paired Cα atoms with iterative outlier rejection, over the whole structure or the reference ligand's site. It runs automatically and drives the display. All six fixture fits match numpy SVD exactly.
- **4D: fingerprints.** UniProt-keyed rows with five cell states and Tanimoto similarity over measured cells only.
  - Columns are refused unless engine, ruleset and parameters match.
  - Gained and lost cells carry distance margins, with changes within 0.5 Å marked ≈.
  - Exports: comparison JSON and fingerprint CSV.
- **4E: binding-site differences.** Per paired site residue: Cα displacement, side-chain RMSD with equivalent-atom swaps, χ1/χ2 and rotamer changes. Shifts are compared with twice the combined DPI. Site-water conservation and apo waters in the ligand site are reported.
- **4F: release.**
  - Hash-pinned golden comparison output for four fixture pairs.
  - Browser workflows for adding, pairing, superposing, fingerprinting, exporting, saving, restoring and failure isolation.
  - Documentation.

## Findings recorded during implementation

- Author numbering differs at every residue between the trypsin entries 3PTB, 1S0R and 1S0Q. SIFTS pairs all 223 positions exactly.
- Fingerprint changes between structures were dominated by contacts near a cutoff: the application and ProLIF agree on none of the gained or lost interactions in the fixture pairs, and every disagreement is explained. Hence the margins and the ≈ marker.
- Open Babel fragments 4HHB's heme, so ProLIF reports nothing for it. The 1.25 Å pair 2DN2/2DN1 is used for the ProLIF fingerprint check.
- At atomic resolution the combined DPI is about 0.03 Å, so small apo/holo shifts (0.1–0.35 Å) exceed 2σ. The panel explains what σ omits.

## Scope and next useful changes

- **Phase 5:**
  - sequence-alignment correspondence for structures without SIFTS coverage or of different proteins (labeled as inferred);
  - symmetry-corrected ligand pose RMSD;
  - protein–protein interfaces and mutations.
- **Comparison structures:**
  - picking and selection in comparison structures (display-only now);
  - per-atom error models (B-factor-scaled coordinate error) for shift significance;
  - comparison of more than one reference ligand per structure.

## Verification

`npm run format:check`, `npm test`, `npm run build` and `npm run test:e2e` pass. The comparison-specific suites are `tests/comparison-*.test.ts`, `tests/cache.test.ts` and `tests/e2e/comparison.spec.ts`.
