# Molecular Interaction Explorer

A browser application for exploring deposited molecular structures with linked 3D, sequence, ligand, and residue views. Phase 1 exploration and the first ligand-centered Phase 2 interaction engine are implemented.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

```sh
npm test           # Scientific identity and coordinate regression tests
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e   # Real-browser integration tests
```

For an existing system Chromium installation, set `PLAYWRIGHT_CHROMIUM_PATH` to its executable path. Browser tests use software WebGL to support CI machines without a GPU.

## Phase 1 capabilities

- Load public structures by PDB accession, including extended accession syntax.
- Open local mmCIF (`.cif`, `.mmcif`) and BinaryCIF (`.bcif`) files without uploading them.
- Explore bundled, unmodified RCSB structures: 3PTB (trypsin/benzamidine) and 4HHB (human hemoglobin).
- Select a structural model and either the asymmetric unit or a deposited biological assembly.
- Browse polymer chains and individual ligand/ion instances.
- Select residues in the sequence or 3D view and inspect the same domain identity.
- Show the deposited polymer sequence, including positions without observed coordinates.
- Switch polymer representations between cartoon, atoms, and molecular surface; toggle water.
- Inspect atom coordinates, occupancies, B factors, numbering, insertion codes, and assembly operators.
- Cache source bytes in IndexedDB and explicitly save the current session for restoration in the same browser.
- Inspect source provenance and export a structure manifest.

B factors are shown as deposited atomic properties, not as a general confidence score. The exported manifest contains identities and source provenance; it is not a coordinate-file replacement or an interaction-analysis export.

## Phase 2 capabilities and scientific policy

Select a ligand instance, choose polymer receptor chains, and **Run analysis**. The default ligand is BEN in 3PTB. Results identify its well-known ASP189 charged-group contact, alongside nearby atoms, hydrogen-bond candidates, and hydrophobic contacts. Contact rows select exact participating atoms, draw the selected interaction in 3D, and synchronize the receptor residue in the sequence. The binding neighborhood is the union of computed contact residues; it is shown as sticks in 3D and marked in the sequence.

| Result | Definition | Interpretation |
| --- | --- | --- |
| Proximity | All eligible heavy-atom pairs within the configured cutoff (default 5 Å) | Measured geometry; proximity alone is not favorable binding |
| Hydrogen bond | Mol* donor/acceptor typing, distance and orientation rules (default 3.5 Å, including sulfur) | Candidate with implicit hydrogens; geometry-supported when explicit hydrogens pass the rules |
| Hydrophobic | Mol* nonpolar atom typing and refined contacts (default 4 Å) | Geometrically supported contact, without an energy estimate |
| Salt bridge | Mol* opposing charged groups, minimum atom-pair distance (default 4 Å) | Candidate dependent on inferred protonation; solution pH is not modeled |

A dedicated Web Worker parses an owned copy of source bytes and computes the result. Source arrays used by rendering are never detached. A uniform spatial grid searches proximity pairs; Mol* 5.13.1 supplies valence, features, geometry tests and refinement. The adapter translates those results into normalized atom and residue graphs. The engine is versioned separately from Mol*. The UI shows **not evaluated** when component chemistry is absent, preserving measured proximity rather than reporting misleading chemical zeroes.

Chemistry comes from embedded `chem_comp_bond`, optional RCSB Chemical Component Dictionary downloads, or Mol* standard residue templates. External definitions are requested by component ID; local coordinate files are never sent to a server. Definitions and successful analyses are cached in IndexedDB. Fetch failure preserves proximity-only results for unknown chemistry. Downloads are bounded to 32 missing components per analysis; additional components stay explicitly untyped. Unknown receptor components are skipped for chemical classification. Ion targets support proximity only in this version.

Default policy excludes whole residues with alternate locations. Exploratory preferred-per-residue mode picks the recorded coherent residue conformer and labels its limitations. Hydrogen/deuterium/tritium atoms can supply geometry but are excluded from proximity contacts. Atoms with zero, negative, unknown, or below-threshold occupancy are omitted. Pairs separated by one or two covalent bonds in the selected context are excluded. Bond provenance distinguishes dictionary/explicit connectivity from geometry-inferred connectivity. Chemistry completeness is not established: missing heavy atoms can affect inferred valence.

Mol* assumes ARG/LYS/HIS positive and ASP/GLU negative in its ionic rules. The wrapper requires an explicit negative formal charge for nitrogen-only negative features. Mol* refinement retains selected closest hydrophobic contacts and suppresses hydrogen bonds overlapping salt bridges. Counts therefore are algorithm-dependent. No binding affinity, energy, or stability score is claimed.

Results are keyed by source SHA-256, model, assembly, exact ligand/operator identity, receptor selection, all parameters, engine/parser/ruleset versions, and chemical-definition hashes. Changing the context or settings clears the displayed result. Cancellation aborts definition requests, terminates computation, and rejects stale results. Results above one million interactions are rejected with a smaller-selection request; no truncated scientific result is returned. Table pagination affects display only.

**JSON** exports the complete analysis, settings, assumptions, evaluation status, chemistry provenance, normalized graph, bond data, atom identities and assembly coordinates. Unknown occupancies serialize as `null`. **CSV** exports all unfiltered interactions, atom names, residue identities, geometry and run/source references; use the accompanying JSON for full calculation parameters and evidence. Neither export includes the original coordinate-file bytes.

Current validation includes independent spatial-versus-brute-force checks, the 3PTB/ASP189 regression, and a synthetic explicit-hydrogen case whose classification changes when hydrogen orientation reverses while heavy-atom distances remain fixed. This is not a claim of PLIP equivalence. Broader curated PLIP comparisons, protonation-aware preparation, large-assembly benchmarks, π interactions, metal coordination, water bridges, steric clashes and protein–protein analysis remain future work.

## GitHub and GitHub Pages

Code is hosted at https://github.com/jtmcbride/Molecules and the app is published at https://jtmcbride.github.io/Molecules/. Independent validation and Pages deployment workflows run on pushes to main.

1. Push the project to the repository's `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the build source.
3. Run the **Deploy to GitHub Pages** workflow, or push to `main`.

The workflow uses `/<repository-name>/` as Vite's base path. Repositories named `*.github.io` use `/`. Sample downloads, dynamically imported Mol* code, fonts, and the favicon use the build's base path.

For a manual build at another subpath:

```sh
VITE_BASE_PATH=/molecular-interaction-explorer/ npm run build
```

No server, runtime keys, or scientific-service credentials are needed. Remote coordinates are loaded from `files.rcsb.org`, and optional metadata from `data.rcsb.org`. Failure to fetch metadata does not prevent coordinate exploration. On 2026-10-09, GET requests with an example GitHub Pages Origin returned `Access-Control-Allow-Origin: *` from both services; verify again against the deployed origin when connecting the repository.

Bundled samples and cached bytes allow exploration when scientific APIs are unavailable. This version has no service worker and does not promise that the application shell can load without an internet connection on a first visit.

## Architecture

```text
src/
  App.tsx                 Explorer workspace and synchronized views
  domain/
    types.ts              Rendering-independent structure and session models
    identity.ts           Compound identity and coherent conformer policy
    analysis.ts           Independent interactions, graph, binding site and provenance
  analysis/
    worker.ts, client.ts   Dedicated computation and cancellation
    engine.ts             Mol* chemistry wrapper and normalized interaction graph
    spatial.ts, policy.ts  Uniform-grid search and explicit eligibility rules
    prepare.ts, export.ts  Worker parsing/CCD injection and reproducible exports
  components/
    AnalysisPanel.tsx      Settings, filters, contact inspection and export controls
  structure/
    adapter.ts            Mol* lifecycle, scene building, and selection translation
    extract.ts            Assembly-space coordinates and normalized identities
    controller.ts         Serialized scene updates and stale-request rejection
  data/
    provider.ts           RCSB/local ingestion, validation, hashes, and metadata
    chemistry.ts          Optional component dictionary acquisition
    repository.ts         Versioned IndexedDB source, session, chemistry and result caches
  state/
    explorer.ts           UI state and domain references
tests/
  structure.test.ts       Real and synthetic structural regression tests
  analysis.test.ts        Scientific geometry, chemistry and graph validation
  fixtures/               Synthetic identity/model/assembly edge cases
  e2e/                    Real-browser workflow and error recovery tests
```

Mol* owns the rendered scene. `StructureSnapshot` owns the application's scientific representation. Mol* objects do not enter the domain model. Atom positions are stored in `Float32Array` in the selected assembly's coordinate frame, with residue indices, occupancy, and B-factor arrays. The adapter stores mappings in both directions between domain residues and Mol* unit/element selections.

Snapshot identity includes the input SHA-256 hash, model number, and assembly selection. Chain identities include the label chain and assembly operator instance. Residue identities include the source residue index and component; atom identities include the source atom row. Author and label numbering remain separate. Full operator transforms and compositions are retained.

The parser and dependency versions are pinned by package.json and package-lock.json. Source bytes are cached by their content hash. Saved sessions reference those exact bytes rather than asking a remote service for an entry that may have changed.

## Conformers and limits

All deposited alternate conformers remain visible and are preserved in the domain snapshot. For computation, a preferred conformer is recorded per residue by mean occupancy, with deterministic alphabetical tie-breaking. Shared atoms are retained; atom identities are deduplicated by name within that preferred residue conformer. This does not establish compatibility between disorder groups in different residues. Analysis defaults to excluding whole residues that contain alternate locations. The optional preferred-per-residue mode is explicitly exploratory and flags unverified cross-residue compatibility.

Current limits:

- Coordinate file size: 40 MB.
- Selected structure: 250,000 atomic elements, including assembly copies.
- One loaded structure and one structural model at a time.
- Atomic mmCIF/BinaryCIF only; legacy PDB, compressed files, and coarse-only models are not supported.
- Parsing and scene construction currently use Mol* on the main thread. Download cancellation aborts the request; cancellation during parsing discards its result and clears the scene once the current serialized operation finishes.
- Cache reads reuse downloaded bytes; there is no automatic source-refresh policy or LRU eviction yet.
- Session restoration saves structure/context/selection/representation/water state; camera orientation is not restored.
- Analysis settings and results are cached independently of saved explorer sessions. Restore the structure, then run the same configuration to retrieve its cached result.
- UniProt mapping and functional annotations remain Phase 3 work.

## Test evidence

Scientific fixtures verify author/label numbering, insertion codes, sequence gaps, null nonpolymer numbering, coherent alternate conformers, model isolation, deterministic identity, transformed assembly copies, real atom counts, and repeated heme instances.

Browser tests run the production build and verify worker computation, contact selection, JSON/CSV exports, cache reuse/invalidation, missing-chemistry fallback, cancellation, linked selection, ligand inspection, models/assemblies, representation/water controls, IndexedDB restoration, manifest downloads, malformed-input recovery, overlapping load requests, API-independent examples, and a phone-width layout.

## Scientific sources and dependencies

- [Mol*](https://molstar.org/) — molecular parsing and visualization; MIT license.
- [RCSB PDB](https://www.rcsb.org/) — public structural data.
- [PDB Chemical Component Dictionary](https://www.wwpdb.org/data/ccd) — chemical definitions; fetched from RCSB.
- [Mol* interaction implementation](https://github.com/molstar/molstar/tree/v5.13.1/src/mol-model-props/computed/interactions) — chemistry and geometry rules wrapped by this engine.
- [PDB identifiers](https://www.rcsb.org/docs/general-help/identifiers-in-pdb).
- [Biological assemblies](https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/biological-assemblies).
- Sample source files: [3PTB mmCIF](https://files.rcsb.org/download/3PTB.cif), [4HHB mmCIF](https://files.rcsb.org/download/4HHB.cif).
- BinaryCIF regression fixture: [RCSB ModelServer 3PTB](https://models.rcsb.org/3ptb.bcif).

The synthetic fixture is explicitly artificial and used only for regression tests. DM Sans and IBM Plex Mono fonts are bundled locally from their fontsource packages.
