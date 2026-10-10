# Phase 2 scientific validation

The application uses the pinned Mol* 5.13.1 rules plus explicitly versioned adapter policy. It does not reproduce PLIP's chemistry preparation or claim identical scientific classifications. Validation combines independent geometry checks, controlled positive/negative examples, deposited structures and a separately executed PLIP reference.

## Deterministic fixtures

The Phase 1–2 suite has 31 tests across structural identity, geometry, eligibility, chemical dictionaries, completeness, interaction categories, graph consistency and reference comparisons (`npm test` now runs 81 tests including Phase 3). All tests run without scientific-service requests. Synthetic files are artificial examples, not experimental observations:

- `hydrogen-geometry.cif`: explicit SER donor hydrogen points toward an acetamide acceptor. Reversing only the hydrogen removes the hydrogen bond while preserving heavy-atom distances.
- `pi-stacking.cif`: parallel complete six-membered aromatic rings, centroid separation 3.6 Å. Reduced distance cutoff or increased lateral offset rejects the contact.
- `cation-pi.cif`: LYS charged group over an aromatic ring; changing distance/offset rejects it.
- `metal-coordination.cif`: zinc 2.2 Å from a histidine ring nitrogen, including inferred/deposited connectivity handling. A 2.1 Å cutoff rejects it. Metal atoms are not assigned a van der Waals clash.
- `water-bridge.cif`: deposited water between SER and acetamide endpoints, both legs 2.8 Å and bridge angle 90°. Disabling water, excluding its occupancy, narrowing leg distances or raising the angle minimum rejects it. The water has a distinct graph identity.
- Steric tests use supported published radii, exact overlap arithmetic, bonded-neighbor exclusion and independent search bounds. A 1 Å proximity cutoff does not prevent finding overlap candidates beyond that cutoff.
- Incomplete receptor/ligand examples retain measured contacts, report expected missing/excluded heavy atoms and skip nonmetal chemical classification on those endpoints. Malformed/mismatched optional CCD definitions are reported and never attributed as applied chemistry.

Independent spatial tests compare index results with brute force over negative coordinates and multiple cutoffs/cell sizes. A 100,000-atom lattice fixture validates five indexed queries against full scans. Analytical ring-normal tests include perpendicular and degenerate inputs.

## Engine restructuring and golden output (milestone 3H)

In engine `contacts-2.1.0`, `src/analysis/engine.ts` is orchestration only. Each rule lives in its own module, and each interaction type has its own pure classifier (`src/analysis/classify.ts`). Before the split, `tests/engine-golden.test.ts` recorded the SHA-256 of every run's canonical scientific fields for 13 cases: 3PTB BEN under default, CCD-supplied, varied-parameter and chemistry-disabled settings; 1EVE E20; 1RMD ZN; and every synthetic category fixture. The restructured engine reproduces all 13 hashes byte-for-byte, confirmed again against the pre-change commit. `RULESET_VERSION` is unchanged because no rule changed. The only output addition is `stats.rejections`, which counts why Mol* candidate edges did not become interactions (for example, 3PTB BEN: 2 refinement-filtered, 3 not ligand–receptor). Those counts are recorded in the golden file but excluded from the hash. `tests/classify.test.ts` covers each classifier with positive, negative and exactly-at-cutoff cases. Regenerate the golden file only for a deliberate ruleset change (`UPDATE_ENGINE_GOLDEN=1 npm test`), and document why here. `DUMP_ENGINE_GOLDEN=<dir>` writes full canonical JSON for diffing.

Element symbols are normalized once when the snapshot is built. `isHydrogenElement` is the single hydrogen/deuterium/tritium test. A lowercase/mixed-case `type_symbol` fixture gives identical eligibility, completeness and explicit-hydrogen classification. Mol* already upper-cases `type_symbol`, so this removed a latent inconsistency rather than changing results.

## External reference: PLIP 3.0.0

`plip-reference.json` contains normalized observations generated locally by a separate PLIP checkout:

- Source: https://github.com/pharmai/plip, tag v3.0.0, commit `017a4e35115f26af70f9e822a63766c800835d9d`.
- Python 3.12.14; `openbabel-wheel==3.1.1.23`, `lxml==6.1.3`, `numpy==2.5.3`.
- Command: `plipcmd.py -f <deposited.pdb> -x --nofix --nofixfile -o <temporary-directory>`; default local hydrogen addition is enabled. No structure relaxation or upstream file correction is requested.
- Input PDB and mmCIF files were independently downloaded from `https://files.rcsb.org/download/<accession>.<extension>` on 2026-10-09. Byte hashes are pinned in the reference manifest. The application parses the mmCIF input; PLIP reads the corresponding PDB input. Tests verify reference endpoint coordinates occur in the mmCIF within 0.002 Å.
- PLIP citation: Schake et al., PLIP 2025, https://doi.org/10.1093/nar/gkaf361.

Reference cases were selected from PLIP's published validation topics: 1EVE aromatic interactions (Chakrabarti et al., geometry of planar-group interactions, 2007), and 1RMD zinc coordination (Harding, architecture of metal coordination groups, 2004). 3PTB provides the bundled trypsin binding example. Reference generation does not run in normal CI; pinned observations make tests independent of Python/Open Babel installation and live downloads. No PLIP implementation is included in the application.

### Observed comparison

Counts below use the application's default eligible-atom policy and thresholds. “Shared” refers to type + receptor residue, not necessarily identical atom-group membership. Tests also verify common direct endpoint distances and deposited coordinate identity.

| Case / selected ligand | App result counts | PLIP result counts | Shared observations |
| --- | --- | --- | --- |
| 3PTB BEN A:1 | 4 hydrogen bonds, 1 hydrophobic, 1 salt bridge, 2 water bridges | 2 hydrogen bonds, 1 hydrophobic | Hydrogen bonds at GLY219 and ASP189; hydrophobic contact at VAL213 |
| 1EVE E20 A:2001 | 2 π-stacks, 1 cation–π, 8 hydrophobic, 3 water bridges | 1 π-stack, 1 cation–π, 7 hydrophobic, 1 hydrogen bond, 4 water bridges | TRP279 stacking, PHE330 cation–π; hydrophobic residues and water bridges at TYR121/HIS440 |
| 1RMD ZN A:119 | 4 metal partners | 4 metal partners | HIS43 and CYS41/CYS61/CYS64; all four selected polymer partners agree |

### Discrepancy investigation

- **Ligand perception:** the recorded Open Babel/PLIP run perceives one aromatic E20 ring, whereas deposited chemical definitions used by Mol* support two. The application consequently reports the additional TRP84 π-stack, which is also an interaction discussed in the PLIP literature-validation test. The reference manifest retains perceived SMILES and ring count. This current-tool comparison is not treated as a perfect oracle.
- **Charge/protonation:** PLIP's recorded BEN perception produces hydrogen bonds at ASP189 but no salt bridge. Mol* types the benzamidine/ASP charged groups and the app explicitly labels that salt bridge a candidate. Neither preparation proves solution protonation state. Added PLIP hydrogens are absent from the application's default deposited-coordinate computation.
- **Distance thresholds:** the recorded PLIP hydrogen bond at PHE288 in 1EVE has donor–acceptor distance about 4.00 Å, outside the app's default 3.5 Å cutoff. It is therefore correctly absent under the chosen app rules.
- **Water bridges:** differences remain in donor/acceptor perception, hydrogen preparation, angular rules and shortest-bridge refinement. The app reports deposited-water candidates with both leg distances and bridge angles; it does not assume water hydrogen orientations are experimentally established. Shared residue observations are retained, and synthetic positive/negative tests verify the implemented rule boundaries independently. Full PLIP water-bridge equivalence is not claimed.
- **Hydrophobic refinement:** multiple valid nonpolar pairs can collapse differently under each tool's aromatic-overlap/contact refinement. Counts are algorithm-dependent and are not affinity estimates.
- **Occupancy/completeness:** 3PTB contains zero-occupancy deposited atoms. The app excludes them and flags affected residues as incomplete, so nonmetal evaluation is partial across the selected receptor. These residues do not disappear from measured-geometry results.
- **Coordination scope:** the app's zinc result contains selected polymer endpoints and partner angles. It does not reproduce PLIP's full metal-complex geometry fit or include other ligand/solvent partners. No tetrahedral/octahedral assignment is claimed. Pathologically dense inputs with more than 64 selected partners retain all partner interactions/counts but omit quadratic angle enumeration with an explicit note.

These findings are investigated, recorded differences rather than failures hidden by count tolerances. More ligand classes, explicit protonation preparation and broader curated systems would be needed for claims about general chemical-detection accuracy.

### Regeneration

Use an isolated environment; PLIP source stays outside this repository:

```sh
python3.12 -m venv /tmp/plip-validation
/tmp/plip-validation/bin/pip install openbabel-wheel==3.1.1.23 lxml==6.1.3 numpy==2.5.3
git clone --depth 1 --branch v3.0.0 https://github.com/pharmai/plip.git /tmp/plip-source
PLIP_SOURCE=/tmp/plip-source /tmp/plip-validation/bin/python scripts/plip-reference.py
npm test
```

Review any regenerated differences before updating scientific expectations. Source hash changes require retrieving and reviewing matching mmCIF/PDB inputs, not merely changing assertions.

## Scale and browser verification

A local Node 24 run on 2026-10-09 built the 100,000-atom grid in approximately 34 ms, with five queries plus independent brute-force validation taking approximately 83 ms. The coordinate buffer alone occupies 1.2 MB. These are observations from this environment, not browser speed promises or whole-engine memory measurements. Reproduce with `RECORD_REFERENCE=1 npm test`; diagnostic JSON is written under `/tmp`. Normal tests assert correctness rather than a machine-specific timing threshold.

Production Playwright tests cover every added category's inspector/3D selection/export, two-leg water presentation, settings invalidation, cached dictionaries/results, cancellation and error recovery, as well as Phase 1 workflows. One software-WebGL browser runs at a time. The application caps input at 40 MB/250,000 selected atoms and results at one million interactions. Large assemblies may still be expensive during parsing, rendering and chemistry feature construction; the grid benchmark is not a full assembly benchmark.

## Scientific limits retained after Phase 2

- Hydrogen/protonation/tautomer preparation, missing-atom rebuilding and energetic modeling are absent.
- Completeness checks cover standard amino-acid heavy atoms and supplied component atom dictionaries; unsupported dictionaries and nucleic components may have unverified completeness.
- Preferred alternate conformers remain exploratory; cross-residue disorder compatibility is not established.
- Metal coordination and water bridges are candidates with explicitly limited interpretation.
- Heavy-atom overlap is a geometric candidate, not a validated all-atom clash score.
- Workflows are ligand-centered. Protein–protein interfaces and structural comparison belong to later phases.
