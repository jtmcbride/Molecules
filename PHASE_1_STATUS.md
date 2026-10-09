# Phase 1 implementation status

## Implemented

- React/TypeScript/Vite project and static GitHub Pages workflows.
- Independent domain model, assembly-space typed coordinate buffers, and versioned provenance.
- Mol* lifecycle and bidirectional identity/selection adapter.
- PDB accession ingestion, local mmCIF/BinaryCIF ingestion, and bundled examples.
- Model/assembly selectors, chain and ligand browser, sequence with unresolved positions, and atom inspector.
- Cartoon/atom/surface representations, water visibility, camera focus/reset, and expanded view.
- Source cache and explicit saved-session restoration in IndexedDB.
- Structure manifest export and scientific/UI regression suites.

## Remaining hardening after the first usable version

- GitHub Pages publication is complete at https://jtmcbride.github.io/Molecules/.
- Phase 2 now extracts bond connectivity with explicit versus geometry-inferred provenance. See PHASE_2_STATUS.md.
- Move expensive extraction/parsing off the main thread where Mol* integration permits it; benchmark larger assemblies.
- Add cache refresh/eviction and a larger fixture corpus for modified residues, microheterogeneity, and unusual polymer chains.
- Improve keyboard-only 3D interaction and add optional camera-state persistence.
- Phase 2 defaults to excluding disordered residues and explicitly flags exploratory per-residue conformer selection.

## Verification

- TypeScript checks and the production build pass.
- Ten scientific regression tests pass.
- Five Chromium integration tests pass, including actual 3D picking, saved-session restoration, and local BinaryCIF ingestion.
- A separate production smoke check passes at `/molecular-interaction-explorer/`, including dynamic Mol* loading, bundled assets, and molecular-surface rendering.

## Phase 2 handoff

Build ligand-centered proximity contacts over `StructureSnapshot.atomBuffer` in a worker. Operate on a declared receptor selection and one model/assembly/conformer context. Establish atom/bond chemistry before adding donor/acceptor, hydrophobic, and charged-group rules. Keep detailed results outside Mol* and extend provenance with rule-set, chemistry-data, and parameter versions.
