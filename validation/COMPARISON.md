# Phase 4 comparison validation

Evidence for structural comparison (`COMPARISON_VERSION = comparison-1.0.0`). The plan is in [docs/PHASE_4_PLAN.md](../docs/PHASE_4_PLAN.md). Inputs are the frozen fixtures in `tests/fixtures/biology` (coordinates, SIFTS and UniProt records with SHA-256 manifest).

## Residue correspondence (4B)

Correspondence uses only the Phase 3 exact SIFTS mapping. Checked in `tests/comparison-correspondence.test.ts`:

| Pair | Shared accessions | Chain pairings | Paired | Other |
| --- | --- | --- | --- | --- |
| 3PTB ↔ 1S0R | P00760 | A↔A (same author chain) | 223 | none |
| 1S0Q ↔ 1S0R | P00760 | A↔A (same author chain) | 223 | none |
| 4HHB ↔ 1HHO | P68871, P69905 | B↔B, A↔A (same author chain) | 287 | 4HHB C and D unpaired (1HHO deposits one αβ dimer) |
| 3PTB ↔ 4HHB | none | none | 0 | comparison refused |

Author numbering differs at all 223 trypsin positions: 3PTB uses chymotrypsinogen numbering (Asp189 = UniProt 194), 1S0R numbers from 1 and 1S0Q from 660. Pairing by author numbering, or by offset, would have been wrong at every position. Every paired trypsin residue has the same component in both structures.

Synthetic in-memory modifications of the 1S0R mapping check the labels for an unobserved position (`reference_only`), an ambiguous mapping (`not_comparable`, with the reason), a missing SIFTS row (`reference_only`) and an engineered mutation (paired, with both deposited residues).

## Superposition (4C)

Method: least-squares rigid fit of paired Cα atoms (preferred conformer, positive occupancy) by Horn's quaternion method (J. Opt. Soc. Am. A 4, 629, 1987).

Outlier rejection:
- Up to five refits, each after rejecting pairs that deviate by more than 2 × the current core RMSD.
- Rejection stops rather than keep fewer than half the pairs, or fewer than 10 atoms.

Scopes:
- `global`: every paired residue.
- `binding_site`: reference residues with a heavy atom within 8 Å of the reference target ligand.

**Independent check.** `scripts/comparison-reference.py` refits the application's paired coordinates (`validation/comparison/*.pairs.json`) with numpy 2.5.3 SVD (Kabsch, with reflection correction) and the same rejection policy. `tests/comparison-superposition.test.ts` requires:
- identical fitted and rejected sets, and identical cycle counts;
- core and all-pair RMSD within 1e-3 Å;
- transform elements within 1e-4.

All six cases agree:

| Case | Core RMSD (Å) | All-pair RMSD (Å) | Fitted / paired Cα | Cycles |
| --- | --- | --- | --- | --- |
| 3PTB ↔ 1S0R, global | 0.166 | 0.285 | 213 / 223 | 2 |
| 3PTB ↔ 1S0R, binding site (BEN) | 0.111 | 0.124 | 31 / 32 | 1 |
| 1S0Q ↔ 1S0R, global | 0.052 | 0.246 | 182 / 223 | 5 |
| 4HHB ↔ 1HHO, αβ dimer (asymmetric units) | 0.618 | 0.956 | 244 / 287 | 5 |
| 4HHB ↔ 1HHO, tetramer (assembly 1) | 2.242 | 2.348 | 563 / 574 | 3 |
| 4HHB ↔ 1HHO, binding site (HEM A) | 0.487 | 0.639 | 47 / 51 | 4 |

Interpretation and limits:
- **Hemoglobin quaternary change.** The T→R transition shows as a tetramer core RMSD 3.6 times the dimer's. Rejection removes only 11 tetramer atoms, because a quaternary rotation spreads deviations over whole subunits rather than producing a few outliers. The all-pair RMSD is shown beside the core RMSD for this reason.
- **Tetramer pairing.** In 1HHO's assembly, both dimers carry author chains A and B under different operators. 4HHB C and D therefore pair with the symmetry-generated dimer by chain order, and the panel labels that basis.
- **Over-rejection for near-identical structures.** For 1S0Q ↔ 1S0R (same crystal form and resolution), the core RMSD is tiny (0.05 Å), so the 2 × RMSD threshold keeps rejecting until the 50% floor would be reached. The core RMSD then describes the most rigid part of the chain, not the whole structure.
- **Not structural alignment.** Superposition never runs without SIFTS-paired residues.

## Interaction fingerprints (4D)

**Rows.** One row per reference chain instance, UniProt position and chemical interaction type: hydrogen bond, salt bridge, hydrophobic contact, π-stacking, cation–π, halogen bond, metal coordination and water bridge. Proximity contacts and clashes are not fingerprinted.

**Cells.** Each cell is `present`, `absent`, `not_evaluated`, `not_observed` or `not_comparable`. Only the first two are measurements:
- `not_evaluated`: the type was not evaluated, the residue's chain was not in the receptor, or chemistry was skipped for a residue missing expected heavy atoms.
- `not_observed`: no observed, exactly mapped residue at that position.
- `not_comparable`: an ambiguous or conflicting mapping.

**Comparability.** A comparison column is refused unless its analysis has the reference's engine, ruleset and every parameter.

**Similarity.** Tanimoto over the rows measured in both structures.

**Margins.** Every gained or lost cell carries two distances:
- the present side's distance inside the cutoff;
- for hydrophobic contacts, hydrogen bonds and salt bridges, the absent side's closest candidate atoms beyond it (element-based, so it errs low).

It is flagged `marginal` (≈ in the matrix) within 0.5 Å of the cutoff.

Application results (`tests/comparison-fingerprint.test.ts`; default parameters, no CCD downloads, as in the reference set):

| Pair | Ligand | Rows | Shared | Gained | Lost | Tanimoto |
| --- | --- | --- | --- | --- | --- | --- |
| 3PTB ↔ 1S0R | BEN | 7 | 7 | 0 | 0 | 1.00 |
| 2DN2 (deoxy) ↔ 2DN1 (oxy) | HEM α | 21 | 15 | 3 | 3 | 0.71 |
| 4HHB (deoxy) ↔ 1HHO (oxy) | HEM α | 21 | 11 | 4 | 6 | 0.52 |

**Shared interactions.** The benzamidine salt bridge to Asp189 (UniProt 194), its hydrogen bonds and its water bridges appear in both trypsin structures, although the two entries number every residue differently. In both hemoglobin pairs, the proximal His F8 (UniProt 88) coordinates the iron in both states.

**Changes are mostly marginal.** Every hydrophobic change in both hemoglobin pairs is marginal, with present margins of 0.02–0.50 Å. The non-marginal changes:
- the loss of the His E7 (UniProt 59) π-stack, plus a cation–π candidate in 4HHB↔1HHO;
- water bridges at UniProt 59 and 62 (4HHB↔1HHO);
- the loss of the Lys61 (UniProt 62)–propionate hydrogen bond in 2DN2↔2DN1. Its absent side's closest N/O atoms lie 0.99 Å beyond the cutoff, so the side chain moved.

### Comparison with ProLIF 2.2.2

`scripts/comparison-prolif.py` runs ProLIF on each structure with the reference-set preparation:
- Open Babel protonation of the polymer chains.
- Deposited ligand heavy atoms, with CCD-template bond orders or Open Babel perception, plus RDKit hydrogens.
- No waters.

The test maps ProLIF's residues to UniProt positions through the application's SIFTS correspondence and compares the interactions gained and lost between the two structures. Water bridges are excluded, since ProLIF runs without waters. Rows where the application did not measure both cells are excluded.

**4HHB ↔ 1HHO is not checked.** Open Babel fragments 4HHB's heme: its 1984 propionate geometry is perceived as an epoxide-like ring and a separate formate. ProLIF then reports no interactions at all for that ligand. The modern 1.25 Å deoxy/oxy pair 2DN2 ↔ 2DN1 (Park et al. 2006) is used instead. ProLIF still perceives one 2DN1 propionate as a gem-diol, which affects only hydrogen-bond typing at that group.

The tools agree on no gained or lost interaction. Every disagreement is explained:

| Pair | Row | Application | ProLIF | Explanation |
| --- | --- | --- | --- | --- |
| 3PTB ↔ 1S0R | hydrophobic @197 (Gln192) | absent in both | lost | ProLIF's hydrophobic-typed distance goes from 4.37 to 4.98 Å, crossing its 4.5 Å cutoff. The application's carbon–carbon distances (4.21, 4.24 Å) lie outside its 4.0 Å cutoff in both. |
| 2DN2 ↔ 2DN1 | hydrophobic @47, @66, @106 | gained (marginal) | present in both | Application distances straddle 4.0 Å (Phe46 3.97/3.66 Å; Ala65 4.02/3.82 Å; Leu105 4.30/3.90 Å). ProLIF's 4.5 Å cutoff counts them in both states. |
| 2DN2 ↔ 2DN1 | hydrophobic @62 (Lys61) | lost (marginal) | present in both | Application contact 3.94 Å in deoxy, absent in oxy. Same cutoff effect. |
| 2DN2 ↔ 2DN1 | hydrophobic @84, @94 (Leu83, Val93) | present in both | lost | ProLIF types only 14 of 43 heme atoms as hydrophobic. Its typed distances go from 4.36 to 4.73 Å and from 4.34 to 4.52 Å, crossing 4.5 Å. The application's contacts are 3.6–3.8 Å in both states. |
| 2DN2 ↔ 2DN1 | π-stacking @59 (His58) | lost | absent in both | ProLIF detects no His58–porphyrin stacking in either state. The application's deoxy stack has a centroid distance of 3.47 Å. |
| 2DN2 ↔ 2DN1 | hydrogen bond @62 (Lys61 NZ–propionate) | lost | absent in both | ProLIF's ligand preparation leaves the propionates neutral and finds no Lys61 hydrogen bond in either state. The application's deoxy N–O distance is 2.91 Å, and the oxy side chain has moved away (0.99 Å beyond cutoff). |

**Conclusion.** Interaction fingerprint differences between structures are dominated by contacts near a cutoff. Two tools with different cutoffs (4.0 and 4.5 Å) and atom typing disagree on all of them, even where the coordinates barely move. The application therefore reports a margin with every change and marks those within 0.5 Å. Without a margin, a gained or lost hydrophobic contact should not be read as a structural difference.

## Binding-site differences (4E)

**Site.** Residues with a heavy atom within 5 Å of either structure's ligand. Comparison residues are mapped through the correspondence, so an apo structure is assessed in the reference's site.

**Measurements.** For each paired site residue, after superposition:
- Cα displacement.
- Side-chain RMSD over heavy atoms matched by name. Equivalent atoms may swap (Asp OD1/OD2, Glu OE1/OE2, Phe/Tyr ring CD/CE, Arg NH1/NH2), and the smallest RMSD is used.
- χ1 and χ2 (IUPAC-IUB), with differences taken modulo 180° for Asp, Phe and Tyr χ2.

Side chains and torsions are compared only between identical residue types.

**Significance.** The larger shift (Cα or side chain) is compared with 2σ, where σ = √(σ_ref² + σ_cmp²) from each structure's Cruickshank DPI (deposited ESU_R_free when present). It is `not_assessable` when either value is missing. DPI describes an atom with average B and excludes superposition error, so it underestimates the error of mobile atoms. The panel says so, and always shows the shift itself.

**Rotamer changes.** A χ difference above 60° (half a rotamer well).

**Waters.**
- Site waters have an oxygen within 4 Å of a ligand or site-residue heavy atom, in the reference frame.
- A water is `conserved` when a superposed partner lies within 1.0 Å.
- Comparison waters within 2.5 Å of a reference ligand heavy atom occupy the ligand site.

Checked in `tests/comparison-site.test.ts` (global superposition):

| Pair | Site residues | σ (Å) | Beyond 2σ | Rotamer changes | Reference waters conserved | Comparison waters in ligand site |
| --- | --- | --- | --- | --- | --- | --- |
| 1S0R (holo) ↔ 1S0Q (apo) | 16 | 0.031 | 14 | 0 | 16 / 22 | 6 |
| 3PTB ↔ 1S0R | 17 | not assessable (3PTB lacks DPI inputs) | – | 1 (Gln192, Δχ2 151°) | 7 / 8 | 0 |
| 2DN2 (deoxy) ↔ 2DN1 (oxy) | 24 | not assessable | – | 1 (Leu83) | 11 / 21 | 1 |

**Apo/holo trypsin.** At 1.02 Å the combined DPI is only 0.031 Å, so Cα shifts of 0.1–0.35 Å around the S1 pocket exceed 2σ. The largest is Gln174, which is Gln192 in chymotrypsinogen numbering. These shifts are statistically above the DPI estimate, but small. Six apo waters occupy the benzamidine site, as expected for a ligand that displaces ordered water.

**Trypsin crystals.** Gln192, a known flexible residue at the rim of the S1 pocket, adopts a different rotamer in 3PTB and 1S0R.

**Hemoglobin.** In the α heme pocket, the F-helix residues Leu83, Leu86, His87 (proximal) and Leu91 shift by more than 1 Å between deoxy and oxy. This is the T→R ligation shift of the F helix.

**Equivalent atoms.** Swapping Asp189 OD1/OD2 in memory (artificial) leaves its side-chain RMSD unchanged and changes Δχ2 by under 5°: the deposited carboxylate oxygens are not exactly 180° apart.
