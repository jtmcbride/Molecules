# Molecular Interaction Explorer

A browser application for exploring deposited molecular structures with linked 3D, sequence, ligand, and residue views. This is the first implementation of Phase 1 of the architecture plan.

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

The interface does not display computed interaction classifications in Phase 1. B factors are shown as deposited atomic properties, not as a general confidence score. The exported manifest contains identities and source provenance; it is not a coordinate-file replacement or an interaction-analysis export.

## GitHub and GitHub Pages

The project is ready to connect to a new GitHub repository. It includes independent validation and Pages deployment workflows.

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
  structure/
    adapter.ts            Mol* lifecycle, scene building, and selection translation
    extract.ts            Assembly-space coordinates and normalized identities
    controller.ts         Serialized scene updates and stale-request rejection
  data/
    provider.ts           RCSB/local ingestion, validation, hashes, and metadata
    repository.ts         Versioned IndexedDB source and session persistence
  state/
    explorer.ts           UI state and domain references
tests/
  structure.test.ts       Real and synthetic scientific regression tests
  fixtures/               Synthetic identity/model/assembly edge cases
  e2e/                    Real-browser workflow and error recovery tests
```

Mol* owns the rendered scene. `StructureSnapshot` owns the application's scientific representation. Mol* objects do not enter the domain model. Atom positions are stored in `Float32Array` in the selected assembly's coordinate frame, with residue indices, occupancy, and B-factor arrays. The adapter stores mappings in both directions between domain residues and Mol* unit/element selections.

Snapshot identity includes the input SHA-256 hash, model number, and assembly selection. Chain identities include the label chain and assembly operator instance. Residue identities include the source residue index and component; atom identities include the source atom row. Author and label numbering remain separate. Full operator transforms and compositions are retained.

The parser and dependency versions are pinned by package.json and package-lock.json. Source bytes are cached by their content hash. Saved sessions reference those exact bytes rather than asking a remote service for an entry that may have changed.

## Conformers and limits

All deposited alternate conformers remain visible and are preserved in the domain snapshot. For future computation, a preferred conformer is recorded per residue by mean occupancy, with deterministic alphabetical tie-breaking. Shared atoms are retained; atom identities are deduplicated by name within that preferred residue conformer. This does not establish compatibility between disorder groups in different residues. Phase 2 must apply and report its full conformer policy before calculating interactions.

Current limits:

- Coordinate file size: 40 MB.
- Selected structure: 250,000 atomic elements, including assembly copies.
- One loaded structure and one structural model at a time.
- Atomic mmCIF/BinaryCIF only; legacy PDB, compressed files, and coarse-only models are not supported.
- Parsing and scene construction currently use Mol* on the main thread. Download cancellation aborts the request; cancellation during parsing discards its result and clears the scene once the current serialized operation finishes.
- Cache reads reuse downloaded bytes; there is no automatic source-refresh policy or LRU eviction yet.
- Session restoration saves structure/context/selection/representation/water state; camera orientation is not restored.
- Inter-residue bond chemistry, connectivity provenance, UniProt mapping, and interaction analysis remain Phase 2/3 work.

## Test evidence

Scientific fixtures verify author/label numbering, insertion codes, sequence gaps, null nonpolymer numbering, coherent alternate conformers, model isolation, deterministic identity, transformed assembly copies, real atom counts, and repeated heme instances.

Browser tests verify linked selection, ligand inspection, models/assemblies, representation/water controls, IndexedDB restoration, manifest downloads, malformed-input recovery, overlapping load requests, API-independent examples, and a phone-width layout.

## Scientific sources and dependencies

- [Mol*](https://molstar.org/) — molecular parsing and visualization; MIT license.
- [RCSB PDB](https://www.rcsb.org/) — public structural data.
- [PDB identifiers](https://www.rcsb.org/docs/general-help/identifiers-in-pdb).
- [Biological assemblies](https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/biological-assemblies).
- Sample source files: [3PTB mmCIF](https://files.rcsb.org/download/3PTB.cif), [4HHB mmCIF](https://files.rcsb.org/download/4HHB.cif).
- BinaryCIF regression fixture: [RCSB ModelServer 3PTB](https://models.rcsb.org/3ptb.bcif).

The synthetic fixture is explicitly artificial and used only for regression tests. DM Sans and IBM Plex Mono fonts are bundled locally from their fontsource packages.
