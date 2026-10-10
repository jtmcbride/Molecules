# Phase 2 implementation status

Updated 2026-10-10. Engine `contacts-2.0.0`, ruleset `molstar-5.13.1-ligand-2`.

## Implemented

- Dedicated cancellable Web Worker for source parsing and ligand interaction computation.
- Uniform spatial grid and eligible heavy-atom proximity search.
- Explicit receptor chains, ligand instance, model, assembly, occupancy and conformer scope.
- Mol* chemistry wrapper for hydrogen-bond, hydrophobic and salt-bridge candidates.
- π-stacking and cation–π (ring centroids, planes, offsets), metal-coordination candidates with selected-partner angles, deposited-water bridges (two legs plus bridge angle) and heavy-atom steric-overlap candidates.
- Embedded/CCD/standard-template chemistry provenance and explicit unknown-chemistry evaluation status.
- Heavy-atom completeness for standard amino acids and supplied component dictionaries; incomplete endpoints skip nonmetal chemical classification.
- Scoped bond connectivity and exclusion of pairs one or two bonds apart (coordinate bonds retained for metal analysis).
- Independent atom-level interactions, residue adjacency and binding-site summaries.
- Binding neighborhood in 3D and sequence; exact atom selection and dashed selected-contact geometry.
- Analysis settings, receptor selection, result filters, pagination and geometry inspection.
- Versioned IndexedDB analysis/chemical-definition caches and stale-result cancellation.
- JSON (schema 2) with full provenance, atom identities and coordinates; unfiltered CSV interactions.
- Recorded comparison against separately executed PLIP 3.0.0 on 3PTB, 1EVE and 1RMD ([validation/README.md](../validation/README.md)).

## Scope and next useful changes

Ruleset revisions are planned in [PHASE_2X_PLAN.md](PHASE_2X_PLAN.md) (validation harness V0, then R1–R6):

- Per-altloc ensemble analysis instead of whole-residue exclusion by default.
- Halogen bonds, element-specific metal distances, His pH-dependent tier and amide/His flip flags.
- Covalent-ligand detection with exclusion of pairs three bonds apart across the link.
- Multi-residue ligands and non-polymer receptor components.
- Broader curated validation, explicit protonation preparation, large-assembly memory budgets, cache eviction and interaction fingerprints.
- Protein–protein interfaces remain Phase 5.

See README.md for exact definitions, defaults, uncertainty policy and export semantics.

## Verification

- 31 Phase 1–2 deterministic scientific tests cover structural identity, geometry, eligibility, chemical dictionaries, completeness, each interaction category, graph consistency, spatial-index brute-force agreement (including a 100,000-atom lattice) and the PLIP reference comparison.
- 13 Phase 1–2 production-browser workflows cover exploration and analysis. Software-WebGL tests run serially to avoid competing CI renderers.
- Live Pages checks pass for 3PTB, its biological assembly, and the 4HHB biological assembly, including contact selection and JSON export.
