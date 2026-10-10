# Phase 2 implementation status

Updated 2026-10-10. Engine `contacts-2.1.0`, ruleset `molstar-5.13.1-ligand-3` (Phase 2.x complete; see [PHASE_2X_PLAN.md](PHASE_2X_PLAN.md)).

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

## Ruleset ligand-3 additions (Phase 2.x)

- Reference validation set (26 cases) against PLIP 3.0.0 and ProLIF 2.2.2 with pinned per-category agreement.
- Covalent attachments recorded; ligand–receptor pairs up to three bonds apart across them excluded; unrecorded close pairs flagged; typed donor–acceptor overlaps reported as short H-bonds, not clashes.
- His salt bridges pH-dependent; Asn/Gln amide and His ring H-bonds flip/tautomer-labeled; metal-coordinating His/Cys excluded as ionic and hydrogen-bond partners.
- Element-specific metal–donor distances (Bazayeva et al. 2024) plus tolerance.
- Halogen bonds.
- Per-conformer ensemble analysis as the default.
- Multi-residue ligand groups and cofactor/ion receptor components.

## Scope and next useful changes

- Explicit protonation preparation, broader curated validation, large-assembly memory budgets, cache eviction and interaction fingerprints.
- Protein–protein interfaces remain Phase 5; structural comparison is Phase 4.

See README.md for exact definitions, defaults, uncertainty policy and export semantics.

## Verification

- Deterministic scientific tests cover structural identity, geometry, eligibility, chemical dictionaries, completeness, each interaction category and classifier, golden engine output, graph consistency, spatial-index brute-force agreement (including a 100,000-atom lattice) and both reference comparisons.
- Production-browser workflows cover exploration and analysis, including covalent, halogen, ambiguity, ensemble, glycan and cofactor workflows (`tests/e2e/ruleset.spec.ts`). Software-WebGL tests run serially to avoid competing CI renderers.
- Live Pages checks pass for 3PTB, its biological assembly, and the 4HHB biological assembly, including contact selection and JSON export.
