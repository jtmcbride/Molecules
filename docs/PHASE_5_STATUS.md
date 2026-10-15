# Phase 5 implementation status

Updated 2026-10-10. Curated-variant track complete: `biology-1.2.0`, interpretation JSON schema 3, `comparison-1.1.0`, package 0.5.0. Engine and ruleset versions are unchanged (`contacts-2.1.0`, `molstar-5.13.1-ligand-3`); analysis JSON stays schema 3, comparison JSON schema 1, session schema 3 (with an optional `carrierResourceIds` field) and Dexie version 4. Plan and implementation record: [PHASE_5_PLAN.md](PHASE_5_PLAN.md). Validation: [validation/VARIANTS.md](../validation/VARIANTS.md).

## Implemented

- **5V-A: variant records.**
  - UniProt `Natural variant` and `Mutagenesis` features keep their stated replacement, checked against the sequence, and their cross-references.
  - SIFTS `Variant` residues map exactly as `natural_variant`, so natural-variant entries such as 2HBS pair in comparisons.
  - Each variant is compared with the deposited residues: `carries`, `original`, `other` or `not_evaluated`.
- **5V-B: display and exports.**
  - Variant categories are offered but off by default.
  - The residue view quotes each variant with its evidence and deposited state.
  - The binding-site summary counts contact residues with variants beside the chain background.
  - Interpretation JSON schema 3 and the CSV carry the new fields.
- **5V-C: structural consequences.** Atom-level statements for each chemical interaction at a single-residue variant: which interacting deposited atoms are part of the replacement. The wording comes from one module, and a test rejects effect words.
- **5V-D: deposited structures carrying a variant.**
  - On request, the app looks up RCSB's SIFTS-derived entity alignments for the accession and lists the entries carrying each replacement.
  - Any of them opens as a comparison structure.
  - Lookups are pinned with the session.
- **5V-E: release.**
  - Hash-pinned golden variant output for four cases.
  - Browser workflows.
  - Validation record and documentation.

## Findings recorded during implementation

- Hemoglobin β has curated variants at 130 of 147 positions. 18 of 21 heme-contact residues in 4HHB chain B carry one, against 130 of 146 in the chain: a variant at a contact residue says little by itself.
- SIFTS labels natural-variant residues `Variant`, which the mapping did not accept before: 2HBS β Val6 was `sequence_mismatch`.
- In Hb M Saskatoon (β H64Y) the replacement tyrosine binds the heme iron, so consequence wording states atom facts only.
- The sequence-coordinates GraphQL endpoint accepts POST only, and each response also aligns one AlphaFold model, which is not used.
- RCSB's alignments agree with SIFTS at all 4,175 mapped residues of the nine frozen entries.
- Glycine's empty side-chain entry was first treated as a non-standard residue; a synthetic case caught it.

## Scope and next useful changes

The proposed order, implementation details, and acceptance gates are in [Development plan after v0.5.0](NEXT_DEVELOPMENT_PLAN.md). That plan separates release/workflow improvements from the remaining scientific tracks below.

- **Remaining Phase 5 tracks**, each to be planned separately:
  - symmetry-corrected ligand pose RMSD;
  - protein–protein interfaces;
  - sequence-alignment correspondence (labeled as inferred).
- **Variants:**
  - ClinVar or gnomAD as further pinned sources, if wanted;
  - isoform-aware variants;
  - consequences for multi-residue replacements;
  - a protein-level variant table.

## Verification

`npm run format:check`, `npm test`, `npm run build` and `npm run test:e2e` pass. The variant-specific suites are `tests/variants.test.ts`, `tests/variant-consequences.test.ts`, `tests/variant-carriers.test.ts`, `tests/variants-golden.test.ts` and `tests/e2e/variants.spec.ts`.
