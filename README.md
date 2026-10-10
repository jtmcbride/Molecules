# Molecular Interaction Explorer

A browser application for exploring deposited molecular structures with linked 3D, sequence, ligand, and residue views. Phases 1–3 are implemented: structure exploration, ligand-centered interaction computation, and functional interpretation through exact SIFTS/UniProt correspondence and traceable evidence. [Phase 3 implementation record](docs/PHASE_3_PLAN.md) describes its contracts and acceptance gates.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

```sh
npm test           # Scientific identity, geometry and reference regression tests
npm run typecheck
npm run format:check  # Prettier (CI-enforced); npm run format to apply
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

Ruleset `molstar-5.13.1-ligand-3` (engine `contacts-2.1.0`). Changes since `ligand-2` are listed in the [Phase 2.x plan](docs/PHASE_2X_PLAN.md) and the [validation change log](validation/README.md#ruleset-molstar-5131-ligand-3-change-log).

Select a ligand instance or a multi-residue ligand group (glycan, BIRD molecule, covalently linked ligand residues), choose polymer receptor chains and, optionally, nearby cofactors or ions as receptor components, then **Run analysis**. The default ligand is BEN in 3PTB. Results identify its well-known ASP189 charged-group contact, alongside nearby atoms, hydrogen-bond candidates, and hydrophobic contacts. Contact rows select exact participating atoms, draw the selected interaction in 3D (centroid lines for rings; two legs through a water mediator), and synchronize the receptor residue in the sequence. The binding neighborhood is the union of computed contact residues; it is shown as sticks in 3D and marked in the sequence.

| Result | Definition | Interpretation |
| --- | --- | --- |
| Proximity | All eligible heavy-atom pairs within the configured cutoff (default 5 Å) | Measured geometry; proximity alone is not favorable binding |
| Hydrogen bond | Mol* donor/acceptor typing, distance and orientation rules (default 3.5 Å, including sulfur) | Candidate with implicit hydrogens; geometry-supported when explicit hydrogens pass the rules; Asn/Gln amide and His ring partners labeled flip/tautomer-ambiguous; metal-coordinating atoms excluded |
| Hydrophobic | Mol* nonpolar atom typing and refined contacts (default 4 Å) | Geometrically supported contact, without an energy estimate |
| Salt bridge | Mol* opposing charged groups, minimum atom-pair distance (default 4 Å) | Candidate dependent on inferred protonation; His salt bridges labeled pH-dependent; metal-coordinating His/Cys excluded |
| π-stacking | Aromatic ring centroids, planes and offsets (5.5 Å, 2 Å offset, 30° deviation) | Geometrically supported planar-ring contact |
| Cation–π | Charged-group/ring centroid proximity and offset (6 Å, 2 Å offset) | Candidate dependent on inferred charge |
| Metal coordination | Mol* element/partner typing; element-specific metal–donor target distance (Bazayeva et al. 2024) plus 0.5 Å tolerance, uniform 3 Å fallback; coordinate bonds retained | Candidate; selected partners and angles do not define a full coordination sphere |
| Halogen bond | Mol* Cl/Br/I donor and N/O/S acceptor typing; X···A ≤ 4 Å, C–X···A within 30° of linear, X···A–Y ≥ 90° | Geometry-supported σ-hole contact without an energy estimate; fluorine is not a donor |
| Water bridge | Deposited-water mediator, two leg distances (2.5–4.1 Å) and bridge angle (71–140°) | Candidate; water hydrogen orientation is uncertain |
| Steric clash | Published nonmetal VdW radii minus atom distance; overlap ≥0.6 Å; typed donor–acceptor pairs exempt (short H-bonds) | Heavy-atom overlap candidate, without an energetic score |

A dedicated Web Worker parses an owned copy of source bytes and computes the result. Source arrays used by rendering are never detached. A uniform spatial grid searches proximity pairs; Mol* 5.13.1 supplies valence, features, geometry tests and refinement. The adapter translates those results into normalized atom and residue graphs. The engine is versioned separately from Mol*. The UI shows **not evaluated** when component chemistry is absent, preserving measured proximity rather than reporting misleading chemical zeroes.

Chemistry comes from embedded `chem_comp_bond`, optional RCSB Chemical Component Dictionary downloads, or Mol* standard residue templates. External definitions are requested by component ID; local coordinate files are never sent to a server. Definitions and successful analyses are cached in IndexedDB. Fetch failure preserves measured proximity and supported overlap results for unknown chemistry. Downloads are bounded to 32 missing components per analysis; additional components stay explicitly untyped. Unknown receptor components are skipped for chemical classification. Ion targets support proximity and metal-coordination candidates without requesting unsupported ion bond definitions. Invalid optional dictionaries are reported and never cached as applied chemistry.

The default conformer policy is a per-conformer ensemble. Each alternate-conformer label (up to four) is analyzed separately, from the shared atoms plus that label's alternates; residues lacking the label contribute their preferred conformer, flagged as an assumed combination. Each interaction reports the conformers containing it, with occupancy, and whether it is present in all or only some. "Exclude disordered residues" and exploratory "Preferred per residue" remain available. Hydrogen/deuterium/tritium atoms can supply geometry but are excluded from proximity contacts. Atoms with zero, negative, unknown, or below-threshold occupancy are omitted. Pairs separated by one or two covalent bonds in the selected context are excluded from noncovalent results. Ligand–receptor pairs up to three bonds apart are excluded, which only matters across a covalent attachment; such attachments are recorded and labeled. Unbonded ligand–receptor pairs within covalent distance are flagged, but no bond is inferred. Metal-coordinate bond pairs are retained for coordination analysis. Bond provenance distinguishes dictionary/explicit connectivity from geometry-inferred connectivity. Standard amino-acid and component atom dictionaries identify missing/excluded heavy atoms. Nonmetal chemical classification skips incomplete endpoints and reports partial evaluation. Completeness of components without supported atom dictionaries is not established.

Mol* assumes ARG/LYS/HIS positive and ASP/GLU negative in its ionic rules. The wrapper requires an explicit negative formal charge for nitrogen-only negative features. Mol* refinement retains selected closest hydrophobic contacts and suppresses hydrogen bonds overlapping salt bridges. Counts therefore are algorithm-dependent. No binding affinity, energy, or stability score is claimed.

Results are keyed by source SHA-256, model, assembly, exact ligand/operator identity, receptor selection, all parameters, engine/parser/ruleset versions, and chemical-definition hashes. Changing the context or settings clears the displayed result. Cancellation aborts definition requests, terminates computation, and rejects stale results. Results above one million interactions are rejected with a smaller-selection request; no truncated scientific result is returned. Table pagination affects display only.

**JSON** exports the complete analysis, settings, assumptions, evaluation status, chemistry provenance, normalized graph, bond data, atom identities and assembly coordinates. Ring centroids/offsets/plane angles, water mediator/legs/angles, metal selected-partner information and overlap/radii are preserved. Export schema is version 3: it adds covalent attachments, ambiguity labels, conformer presence, halogen bonds, metal limits, ligand groups and receptor components. Unknown occupancies serialize as `null`. **CSV** exports all unfiltered interactions, atom names, residue identities, geometry, ambiguity labels (appended column) and run/source references; use the accompanying JSON for full calculation parameters and evidence. Neither export includes the original coordinate-file bytes.

Phase 2 validation includes deterministic scientific tests, controlled positive/negative geometry fixtures, a 100,000-atom spatial regression, hash-pinned golden engine output, and a 26-case reference set compared against separately executed PLIP 3.0.0 and ProLIF 2.2.2. The reference set has pinned per-category agreement and documented discrepancies. [Validation evidence and discrepancies](validation/README.md) document source hashes, preparation, reproducibility and remaining scientific limits. These checks do not claim PLIP equivalence or general detection accuracy. Protein–protein analysis, protonation preparation, energetic modeling and full large-assembly benchmarking remain later work.

## Phase 3 capabilities and scientific policy

Biological annotations load independently after a public PDB structure opens. Select a chain to see its protein identity, reviewed status, entry/sequence versions, mapping coverage, and functional tracks. The residue inspector preserves author, label and UniProt numbering. Selecting a feature selects its exactly mapped observed residues in 3D; missing coordinates and uncertain correspondence never create an atom selection.

In 3PTB, the ASP189 salt-bridge contact maps to P00760 position 194 and a binding-site feature. UniProt active-site position 200 selects SER195 (deposited label 177). In 4HHB, alpha chains map to P69905 and beta chains to P68871, including biological-assembly instances.

Mappings require matching discovery chain/entity IDs, individual SIFTS correspondence, author numbering/insertion codes and UniProt sequence identity. Modified residues require a deposited `chem_comp` parent. Conflicts, unsupported isoforms and ambiguous rows remain visible; no author-number offset or sequence-alignment guess is used. Multiple accessions in a chimeric chain remain separate and require a protein choice.

Position correspondence and residue identity are recorded separately. When SIFTS curates a difference as an `Engineered mutation` or a sequence `Conflict`, the position still maps exactly and annotations project onto it with a visible label, e.g. `S200A (engineered)` for the catalytic Ser195Ala mutant in 1OPH. An unexplained difference stays `sequence_mismatch` and does not project.

Initial categories are active sites, binding sites, domains, regions, sites, signal peptides, propeptides and processed chains. Function/catalytic statements and their own evidence are available separately. Uncertain or invalid feature bounds are retained but do not project as exact structural features. Evidence drawers distinguish coordinate provenance, computed geometry and database annotations, preserving attached ECO codes/citations. A reviewed record does not establish experimental support for each feature.

Binding-site summaries show mapped, ambiguous and unmapped polymer-contact residues with explicit denominators. The headline counts site-level features only (active sites, binding sites, sites) and shows the chain background beside it: in 3PTB, 4 of 17 mapped BEN-contact residues carry site features, against 11 of 223 mapped residues in the chain. Domains and regions are listed as context and never counted as functional overlap, because they can span most of a chain (the P00760 Peptidase S1 domain covers 221 of 223 mapped residues). Processing features are excluded. Proximity, chemical contacts and clashes remain separate. Neither overlap nor contact counts establish functional importance or affinity. Annotation filters leave interaction runs unchanged.

UniProt binding-site features name their ligand. Each overlapping binding site is compared with the analyzed component by ChEBI identifier only: `same`, `different` (a different ChEBI entity; charge states and conjugate forms have separate entries) or `unresolved` (a generic label such as "substrate", or no ChEBI cross-reference for the analyzed component). Component cross-references come from RCSB chemical component records, requested by component ID and pinned in the interpretation snapshot.

The summary also shows structure evidence: method, resolution and R-free from the coordinate file, and an estimated coordinate error when the file supplies the inputs. That estimate is the deposited ESU based on R-free, or otherwise Cruickshank's DPI_free = sqrt(N_atoms / n_obs) · C^(-1/3) · d_min · R_free. The analyzed ligand instance's fit (RSCC, RSR, modeled completeness) comes from RCSB's wwPDB-derived validation record; it is unavailable when no structure factors were deposited (as in 4HHB). When a coordinate error is known, interaction rows whose measurement lies within √2 × that error of its cutoff are marked borderline. This is display/export metadata; no interaction is reclassified.

**Interpretation JSON** (schema 2) includes protein/feature snapshots, residue correspondence and identity, projections, ligand identities and validation scores, evidence, source hashes, coordinates, structure quality, the binding-site summary (site/context overlaps with background rates and ligand relations), coordinate-uncertainty metadata with borderline interaction IDs, and the unchanged current Phase 2 analysis, when available. **Residue annotations CSV** includes every deposited polymer position, including explicit unmapped rows, as a separate correspondence/feature export. Columns appended in biology-1.1.0 are `feature_category`, `feature_ligand`, `feature_ligand_id`, `residue_identity` and `residue_change`. The Phase 2 interaction CSV remains unchanged. Raw biological response bytes are preserved locally in IndexedDB.

Biological sources normally reuse cached snapshots for seven days. Expired sources are requested again, with labeled stale-cache fallback during service failure. Manual refresh creates a new interpretation revision; failure preserves the previous interpretation. Saved session schema 2 pins its interpretation and analysis, category filters and protein choice. Schema 3 adds comparison structures, each with its own pinned interpretation, analysis, ligand choice, visibility and display transform. Restoration uses those saved revisions without new biological requests; explicitly refresh and save to replace them. Schema 1 sessions remain readable.

Local files receive no automatic biological requests. Explicitly associate a PDB accession to retrieve identifiers only; every polymer chain must match the full deposited sequence and numbering (at least 10 positions). Coordinates are never uploaded. Unsupported/truncated constructs remain unannotated while exploration and interaction computation continue.

See [biological validation evidence](validation/BIOLOGY.md) for frozen source hashes, regression cases and limitations.

## Phase 4 capabilities and scientific policy

Up to seven comparison structures load beside the reference structure. Each keeps its own coordinates, snapshot, SIFTS/UniProt interpretation and analysis, built by the same code and versions as the reference. Comparison structures are display-only cartoons in their own colour; picking, selection and the analysis panel stay with the reference. Loading a different reference structure, model or assembly closes the comparison. A failed or cancelled comparison structure never affects the reference or other comparison structures.

**Residue correspondence** uses only the Phase 3 exact SIFTS mapping:
- Chain instances pair per shared UniProt accession: the user's choice first, then the same author chain ID and operator, then order of appearance. The basis of each pairing is shown, and homo-oligomers pair chain by chain.
- Residues pair when both are observed and exactly mapped to the same UniProt position. Other positions are `reference_only`, `comparison_only` or `not_comparable` (ambiguous, conflicting or mismatched mapping, with the reason).
- Paired residues that differ, such as engineered mutations, keep both identities.
- Author numbering is never used: across the trypsin fixtures it differs at every position.
- Structures sharing no accession are not compared.

**Superposition** is a least-squares rigid fit (Horn quaternion method) of paired Cα atoms:
- Up to five outlier-rejection cycles at 2 × the core RMSD, never keeping fewer than half the pairs or 10 atoms.
- Two scopes: all paired residues, or residues within 8 Å of the reference ligand.
- Core and all-pair RMSD are both reported. The fit runs automatically and refits when pairings, scope or the reference ligand change.
- The transform moves only the display and comparison measurements, never a snapshot.

**Interaction fingerprints** have one row per reference chain, UniProt position and chemical interaction type:
- Cells are `present`, `absent`, `not evaluated`, `not observed` or `not comparable`. Only present and absent are measurements, and only they enter the Tanimoto similarity.
- A comparison structure is analyzed with the reference's current parameters, using as receptor its chains paired with the reference receptor. A column whose engine, ruleset or parameters differ is refused.
- Every gained or lost cell carries its distance from the cutoff, and changes within 0.5 Å are marked ≈. Against ProLIF, fingerprint changes between structures were dominated by such contacts (see validation).

**Binding-site differences** cover paired residues within 5 Å of either ligand, after superposition:
- Cα displacement, side-chain RMSD (equivalent atoms may swap) and χ1/χ2 changes, with a rotamer change above 60°.
- Shifts are compared with twice the combined Cruickshank coordinate error, or labeled not assessable. That error describes an average-B atom and leaves out fit error.
- Site waters are conserved when superposed oxygens lie within 1.0 Å. Comparison waters in the reference ligand site are reported.

**Comparison JSON** (schema 1, `comparison-1.0.0`) records every structure's source hash, pinned analysis and interpretation, chain pairings and residue correspondence, superposition and policy, fingerprints and binding-site differences. The **fingerprint CSV** has one line per row and structure. Saved sessions (schema 3) restore comparison structures, pairings, superposition scope and analyses without new biological requests.

See [comparison validation evidence](validation/COMPARISON.md) for the numpy superposition check, the ProLIF fingerprint comparison and the documented limits.

## Phase status

- **Phase 1 — complete:** reliable structure exploration, identity and linked selection. [Status](docs/PHASE_1_STATUS.md).
- **Phase 2 — complete:** ligand-centered interaction categories, reproducible graph/geometry, worker execution, caching and exports; documented scientific preparation limits remain. [Status](docs/PHASE_2_STATUS.md).
- **Phase 3 — complete, including follow-up milestones 3F–3J:** validated SIFTS mappings, UniProt identity/features, linked annotation tracks, residue context, site-level binding-site summaries with background rates and ligand relations, engineered-mutation projection, structure-quality and ligand-fit evidence, pinned sessions and interpretation exports. [Validation and limits](validation/BIOLOGY.md); [plan and implementation record](docs/PHASE_3_PLAN.md).
- **Phase 2.x — complete:** ruleset `molstar-5.13.1-ligand-3`: reference validation harness, covalent ligands, ambiguity labels, element-specific metal distances, halogen bonds, per-conformer ensembles and multi-residue ligands/receptor components. [Plan and record](docs/PHASE_2X_PLAN.md).
- **Phase 4 — complete:** structural comparison of up to eight structures by SIFTS residue correspondence, Cα superposition validated against numpy, interaction fingerprints keyed by UniProt position with ProLIF-checked change margins, and binding-site differences judged against coordinate error. [Validation](validation/COMPARISON.md); [plan and record](docs/PHASE_4_PLAN.md); [status](docs/PHASE_4_STATUS.md).
- **Phase 5 — pending:** mutations, protein interfaces and advanced analyses.

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
    types.ts              Rendering-independent structure, quality and session models
    identity.ts           Compound identity and coherent conformer policy
    elements.ts           Element-symbol normalization and hydrogen detection
    analysis.ts           Independent interactions, graph, binding site and provenance
    biology.ts            Proteins, features, mappings, evidence and interpretation snapshots
    comparison.ts         Comparison sessions, correspondence, superposition, fingerprint and site contracts
  biology/
    mapping.ts, projection.ts  Exact correspondence, residue identity, projection and binding-site summary
    controller.ts, load.ts     Independent loading, cancellation and pinned restoration
    siftsWorker.ts, siftsClient.ts  Off-thread SIFTS decompression and XML parsing
    evidence.ts, export.ts     Statement provenance and interpretation exports
  analysis/
    worker.ts, client.ts   Dedicated computation and cancellation
    engine.ts             Orchestration only: eligibility → connectivity → contacts → Mol* features → classification
    parameters.ts         Mol* provider settings and the reproducibility cache key
    connectivity.ts       Selected sub-structure, covalent adjacency and bonded-pair exclusion
    contacts.ts           Proximity pairs and steric-overlap candidates
    features.ts           Mol* feature → domain atom groups and ligand/receptor orientation
    classify.ts           One pure classifier per interaction type with explicit rejection reasons
    metal.ts              Metal–partner pairing and partner-angle annotation
    collector.ts          Deduplication, the one-million-interaction guard and rejection counts
    evaluation.ts, provenance.ts  Evaluation status, assumptions, quality flags and chemistry sources
    uncertainty.ts        Cutoff margins and borderline flags from coordinate error (display only)
    spatial.ts, policy.ts  Uniform-grid search and explicit eligibility rules
    prepare.ts, export.ts  Worker parsing/CCD injection and reproducible exports
  comparison/
    controller.ts         Comparison slots: loading, pinned restore, interpretation, queued analysis
    correspondence.ts     SIFTS-only chain pairing and residue correspondence
    superposition.ts      Horn least-squares Cα fit with outlier rejection
    fingerprint.ts        UniProt-keyed fingerprints, comparability and change margins
    siteDifferences.ts, torsions.ts  Residue shifts, χ angles and site waters
    derived.ts, export.ts  Memoized derived results; comparison JSON and fingerprint CSV
  components/
    AnalysisPanel.tsx      Settings, filters, contact inspection and export controls
    ComparisonPanel.tsx    Comparison structures, pairings, superposition, site differences
    FingerprintMatrix.tsx  Fingerprint matrix with similarity and margins
  structure/
    adapter.ts            Mol* lifecycle, scene building, and selection translation
    extract.ts            Assembly-space coordinates and normalized identities
    quality.ts            Refinement statistics and Cruickshank coordinate error
    controller.ts         Serialized scene updates and stale-request rejection
  data/
    provider.ts           RCSB/local ingestion, validation, hashes, and metadata
    chemistry.ts          Optional component dictionary acquisition
    sifts.ts, uniprot.ts   Validated biological provider adapters
    chemcomp.ts, ligandFit.ts  RCSB chemical identity (ChEBI) and ligand validation adapters
    biologyResources.ts   Bounded acquisition, freshness and stale fallback
    repository.ts         Versioned IndexedDB source, session, chemistry and result caches; cache budget
    cache.ts              Least-recently-used eviction planning
  state/
    explorer.ts           UI state and domain references (reference structure)
    comparison.ts         Comparison slots
tests/
  structure.test.ts       Real and synthetic structural regression tests
  analysis.test.ts        Scientific geometry, chemistry and graph validation
  engine-golden.test.ts   Hash-pinned engine output for reference and synthetic cases
  classify.test.ts        Per-classifier positive, negative and at-cutoff cases
  contracts.test.ts       Plan contract excerpt ↔ src/domain/biology.ts drift check
  comparison-*.test.ts    Correspondence, superposition (numpy), fingerprints (ProLIF), site differences, golden hashes
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
- One reference structure and one structural model at a time, plus up to seven comparison structures, each within the per-structure limits. Comparison structures are display-only (no picking) and are drawn as cartoons with their ligands.
- Atomic mmCIF/BinaryCIF only; legacy PDB, compressed files, and coarse-only models are not supported.
- Parsing and scene construction currently use Mol* on the main thread. Download cancellation aborts the request; cancellation during parsing discards its result and clears the scene once the current serialized operation finishes.
- Cache reads reuse downloaded bytes; there is no automatic source-refresh policy. Cached coordinates beyond 300 MB are evicted least recently used first, with their analyses and interpretations. Open structures and the saved session's structures are never evicted. The Source tab shows cache use and clears unused entries.
- Session restoration saves structure/context/selection/representation/water state; camera orientation is not restored.
- Saved schema 2 sessions also reference the current analysis and interpretation; camera orientation and annotation selection are not restored.
- Biological annotation supports four-character PDB accessions, up to 32 protein records, four concurrent protein requests, a 20-second request timeout and at most two transient retries. Extended structure IDs remain viewable without this mapping.
- SIFTS compression requires a browser with `DecompressionStream`; inputs/output are bounded to 10/50 MB, XML to 500,000 correspondence rows, and provider JSON to 5 MB discovery / 10 MB UniProt. Decompression and XML parsing run in a dedicated module worker that is terminated on cancellation.
- Ensemble analysis covers at most four alternate-conformer labels; beyond that the preferred conformer per residue is analyzed, with a flag.
- Ligand chemical identities and validation scores are requested for at most 32 distinct components and 32 nonpolymer instances per structure; branched entities have no validation request. A failed ligand record is a quality flag and never blocks annotation.
- No inferred alignment fallback, isoform conversion, PDBe binding-site cross-check or mutation-effect interpretation is included. Comparison never pairs residues without SIFTS, never aligns different proteins and does not compute symmetry-corrected ligand pose RMSD (Phase 5).

## Test evidence

Scientific fixtures verify author/label numbering, insertion codes, sequence gaps, null nonpolymer numbering, coherent alternate conformers, model isolation, deterministic identity, transformed assembly copies, real atom counts, and repeated heme instances.

Browser tests run the production build and verify worker computation, contact selection, JSON/CSV exports, cache reuse/invalidation, missing-chemistry fallback, cancellation, linked selection, ligand inspection, models/assemblies, representation/water controls, IndexedDB restoration, manifest downloads, malformed-input recovery, overlapping load requests, API-independent examples, a phone-width layout, and the comparison workflows: adding, pairing, superposing, fingerprinting, exporting, saving and restoring comparison structures, and failure isolation from the reference.

## Scientific sources and dependencies

- [Mol*](https://molstar.org/) — molecular parsing and visualization; MIT license.
- [RCSB PDB](https://www.rcsb.org/) — public structural data.
- [PDB Chemical Component Dictionary](https://www.wwpdb.org/data/ccd) — chemical definitions; fetched from RCSB.
- [Mol* interaction implementation](https://github.com/molstar/molstar/tree/v5.13.1/src/mol-model-props/computed/interactions) — chemistry and geometry rules wrapped by this engine.
- [SIFTS](https://www.ebi.ac.uk/pdbe/docs/sifts/) — residue-level PDB/UniProt correspondence.
- [UniProt](https://www.uniprot.org/) — protein identity, sequences, features and statement evidence.
- [RCSB Data API](https://data.rcsb.org/) — chemical component cross-references (ChEBI) and per-instance ligand validation scores. GET requests with the GitHub Pages Origin returned `Access-Control-Allow-Origin: *` on 2026-10-10.
- Coordinate error: Cruickshank, Acta Cryst. D55, 583 (1999); Blow, Acta Cryst. D58, 792 (2002).
- [PDB identifiers](https://www.rcsb.org/docs/general-help/identifiers-in-pdb).
- [Biological assemblies](https://pdb101.rcsb.org/learn/guide-to-understanding-pdb-data/biological-assemblies).
- Sample source files: [3PTB mmCIF](https://files.rcsb.org/download/3PTB.cif), [4HHB mmCIF](https://files.rcsb.org/download/4HHB.cif).
- BinaryCIF regression fixture: [RCSB ModelServer 3PTB](https://models.rcsb.org/3ptb.bcif).

The synthetic fixture is explicitly artificial and used only for regression tests. DM Sans and IBM Plex Mono fonts are bundled locally from their fontsource packages.
