# Phase 2 implementation status

## Implemented

- Dedicated cancellable Web Worker for source parsing and ligand interaction computation.
- Uniform spatial grid and eligible heavy-atom proximity search.
- Explicit receptor chains, ligand instance, model, assembly, occupancy and conformer scope.
- Mol* chemistry wrapper for hydrogen-bond candidates, hydrophobic contacts and salt-bridge candidates.
- Embedded/CCD/standard-template chemistry provenance and explicit unknown-chemistry evaluation status.
- Scoped bond connectivity and exclusion of one/two-bond pairs.
- Independent atom-level interactions, residue adjacency and binding-site summaries.
- Binding neighborhood in 3D and sequence; exact atom selection and dashed selected-contact geometry.
- Analysis settings, receptor selection, result filters, pagination and geometry inspection.
- Versioned IndexedDB analysis/chemical-definition caches and stale-result cancellation.
- JSON with full provenance, atom identities and coordinates; unfiltered CSV interactions.
- Scientific regression fixtures and production-browser integration tests.

## Scope and next useful changes

- Start with ligand-centered analysis. Protein–protein interfaces and π, metal, water-bridge and clash categories need separate rule sets and fixtures.
- Expand curated external validation, including PLIP comparisons with matched preparation and explicit discrepancy review.
- Add chemistry-completeness assessment before stronger classification claims. Unknown/missing atom chemistry and inferred protonation remain explicit limitations.
- Benchmark large assemblies and set measured memory budgets. Current atom/file limits remain unchanged, with a one-million-interaction rejection guard.
- Add cache eviction/refresh, persistent analysis configurations, binding-site statistics and interaction fingerprints for later comparisons.
- Functional residue mappings and evidence integration remain Phase 3.

See README.md for exact definitions, defaults, uncertainty policy and export semantics.

## Verification

- Eighteen scientific tests pass, including geometry, CCD injection, unknown chemistry, covalent exclusions, assembly identity and occupancy/conformer policies.
- Eight production-browser workflows cover exploration and analysis. Software-WebGL tests run serially to avoid competing CI renderers.
- Live Pages checks pass for 3PTB, its biological assembly, and the 4HHB biological assembly, including contact selection and JSON export.
