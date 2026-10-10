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
