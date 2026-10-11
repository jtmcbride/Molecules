# Phase 5 implementation plan: curated variants

Status: decisions accepted 2026-10-10; implementation on the `phase-5-variants` branch. Baseline: `main` after the Phase 4 release (engine `contacts-2.1.0`, ruleset `molstar-5.13.1-ligand-3`, `biology-1.1.0`, `comparison-1.0.0`, analysis JSON schema 3, interpretation JSON schema 2, comparison JSON schema 1, session schema 3, Dexie version 4).

Phase 5 covers mutations, protein–protein interfaces and alignment-based correspondence. This plan covers the first track only: curated sequence variants. The other tracks (symmetry-corrected ligand pose RMSD, protein–protein interfaces, inferred alignment correspondence) get their own plans.

## Outcome and boundaries

A user looking at a binding site sees which of its residues carry curated sequence variants, what the curating source says about each, which of the analyzed interactions use atoms that a substitution replaces, and which deposited structures carry the substitution. Every statement is either a quoted source record or a fact about the deposited coordinates. The application never predicts what a substitution does.

In scope:
- **Curated variant records.** UniProt `Natural variant` and `Mutagenesis` features of the canonical sequence, projected through the exact SIFTS mapping.
- **Rule-based structural consequences.** For each analyzed interaction at a variant position: whether the interacting deposited atoms remain in the substituted residue. Atom-level facts only.
- **Deposited structures carrying a substitution.** PDB entities whose deposited sequence has the variant residue at that UniProt position, opened as Phase 4 comparison structures for measured differences.
- **SIFTS `Variant` residues.** Structures of natural variants (sickle haemoglobin 2HBS) map exactly instead of falling to `sequence_mismatch`.

Out of scope:
- **Effect prediction of any kind.** No side-chain modeling, no ΔΔG or stability scores, no pathogenicity predictors (AlphaMissense, SIFT, PolyPhen, EVE). Each would need modeled coordinates or an external predictor and its own validation; none fits the "no affinity or energy" rule.
- **Clinical sources.** No ClinVar, gnomAD or other clinical classification or frequency. dbSNP identifiers are shown as cross-references only. The application is not a clinical interpretation tool and says so where variants are shown.
- **Statements about the substituted residue's chemistry.** See decision 3.
- **Isoform-specific variants.** Variants on non-canonical isoforms are not converted, as for every other UniProt feature.

## Findings that shaped this plan

Checked 2026-10-10 against the frozen fixtures and live RCSB/EBI responses.

- **The data is already pinned.** The frozen UniProt records contain the features: P68871 has 261 natural variants, P69905 151, P01009 38 plus one mutagenesis feature, and P00760 none. `uniprotSchema` currently drops `alternativeSequence` and `featureCrossReferences`, so the substitution itself is lost.
- **Variant density is high.** Hemoglobin β has curated variants at 130 of 147 positions and α at 97 of 142. "This contact residue has a variant" therefore says almost nothing without the background rate.
- **Records are irregular.** Some variants state no substitution (Hb Bruxelles, a deletion), and P01009 has a nine-residue replacement (190–198). Descriptions mix names, disease associations and effect statements ("in M-Saskatoon; O(2) affinity up"). Most carry ECO:0000269 with PubMed citations; some carry no evidence.
- **SIFTS curates natural variants as `Variant`.** 2HBS B:VAL6 maps to P68871 E7 with the annotation `Variant`. `mapResidues` only accepts `Engineered mutation` and `Conflict`, so today this residue is `unexplained_mismatch`/`sequence_mismatch`. It gets no exact mapping and would be `not_comparable` in a Phase 4 comparison. No current fixture contains a `Variant` annotation.
- **A substitution can create a different interaction.** In Hb M Saskatoon (β H64Y, the distal histidine; in the frozen P68871 record as "in M-Saskatoon; O(2) affinity up") the substituted tyrosine binds the heme iron, as it does in Hb M Hyde Park (proximal His→Tyr, not in the frozen record). A rule saying the substitution "loses" the histidine's heme interaction would be wrong.
- **Carriers can be found by accession.** The RCSB sequence-coordinates API (`https://sequence-coordinates.rcsb.org/graphql`, `alignments(from: UNIPROT, to: PDB_ENTITY)`) returns every entity sequence aligned to an accession, with `access-control-allow-origin: *`. Sizes: P68871 98 KB (352 entities), P00760 222 KB (619), P69905 100 KB, P01009 27 KB (58). RCSB's polymer-entity records give the alignment provenance as `SIFTS`. Lookups find the expected entries: β E7V → 2HBS, 1HBS and 8 more; β E7K (Hb C) → 11 entities; P01009 M382R (Pittsburgh) → 1OPH and 7 more; E366K (Z) → 5IO1, 5NBV.
- **The most frequent sequence difference is not a variant.** β V2M occurs in 63 entities: an initiator methionine of recombinant constructs. Carriers must be reported as "deposited sequence has this residue", and lookups start from curated variants, never from arbitrary differences.
- **RCSB's `pdbx_mutation` uses author numbering** (`E6V` for UniProt E7V, `S195A` for UniProt S200A). It is not used.

## Decisions

Accepted 2026-10-10.

1. **Sources:** UniProt `Natural variant` and `Mutagenesis` features only. They stay separate categories (observed in people versus engineered in a laboratory) and are never merged or counted together.
2. **Descriptions are quoted, not parsed.** UniProt's text is shown verbatim and attributed, with its evidence codes and citations. No effect category ("affinity up", "unstable") is extracted from it.
3. **Consequences are atom-level facts about the deposited residue.** Statements say whether the interacting deposited atoms are present in the substituted residue. They never say whether the substituted residue can make the same or another interaction (Hb M Saskatoon).
4. **Carrier lookup is on demand and pinned separately.** The user requests it per protein. The response is stored as its own pinned resource and referenced by the session, rather than fetched automatically with every interpretation (up to 32 extra requests of up to several hundred KB).
5. **SIFTS `Variant` gets its own identity** `natural_variant`, with the same exact-mapping treatment as `engineered_mutation`. It changes comparison correspondence, so `COMPARISON_VERSION` is bumped.
6. **The variant track is off by default.** With variants at most hemoglobin positions, showing them by default would bury site-level features.

## Ground rules

1. **Interpretation stays separate from analysis.** Variants and consequences are derived from an `InterpretationSnapshot` and a compatible `AnalysisRun`, never written into either. Engine and ruleset versions do not change.
2. **Quote, attribute, date.** Every variant statement shows its source record, evidence and retrieval time. A restored session shows the pinned record, never a refetched one.
3. **One wording module.** Consequence statements come from fixed text in one module. A test rejects words that claim effects ("lost", "disrupt", "abolish", "destabiliz", "pathogenic", "affinity", "damaging") in generated text. UniProt's quoted text is exempt and visibly quoted.
4. **Descriptive counts only.** Variant counts in a binding site always show the background rate over the same chain instances, as Phase 3 does for site features. No enrichment statistic.
5. **Not evaluated beats a guess.** Deletions, multi-residue replacements, non-standard deposited residues, uncertain boundaries and positions where the deposited residue differs from the variant's original residue get `not_evaluated` with a reason.
6. **Identifiers only leave the browser.** Carrier lookup sends a UniProt accession.

## Versions

- `BIOLOGY_VERSION` → `biology-1.2.0`: variant records, `natural_variant` identity, variant overlaps and consequences.
- Interpretation JSON schema 3: variants, consequences and carrier lookups. Schema 2 files still import.
- `COMPARISON_VERSION` → `comparison-1.1.0`: `natural_variant` positions pair instead of being `not_comparable`. The four golden pairs contain no SIFTS `Variant` residue: their outputs are unchanged apart from the version string, which alone changes their hashes.
- `RESIDUE_IDENTITIES` gains `natural_variant`, so the Phase 3 contract excerpt (`docs/PHASE_3_PLAN.md`, checked by `tests/contracts.test.ts`) is updated in the same change.
- Engine, ruleset, analysis JSON and Dexie versions are unchanged unless carrier storage needs a new table (5V-D decides; a new table means Dexie version 5).

## Fixtures

Existing frozen inputs cover most cases: P68871/P69905 with 4HHB (heme pocket variants), P01009 with 1OPH (the deposited A:R382 is both a SIFTS engineered mutation and UniProt's natural Pittsburgh variant M382R; a mutagenesis feature M382V at the same position; a nine-residue replacement; variants without a substitution), and P00760 with 3PTB (no curated variants).

New, frozen with SHA-256 when 5V-A starts:

| Input | Role |
| --- | --- |
| 2HBS mmCIF, discovery JSON, SIFTS XML | Sickle haemoglobin (β E7V), SIFTS `Variant` annotation; comparison with 4HHB |
| RCSB sequence-coordinates alignments for P68871, P69905, P01009, P00760 | Carrier lookup; cross-check against frozen SIFTS XML |

## Milestones and acceptance gates

Estimates are engineering working days, excluding review. Total: 12–17 days.

### 5V-A — Variant records and the `Variant` identity (2–3 days)

Files: `src/data/biologySchemas.ts`, `src/data/uniprot.ts`, `src/domain/biology.ts`, `src/biology/mapping.ts`, `tests/variants.test.ts`.

- **Schema.** Keep `alternativeSequence` (original and alternatives) and `featureCrossReferences` on UniProt features. `FunctionalAnnotation` gains optional `substitution` (`{ original, alternatives }`) and `crossReferences`. Missing or malformed substitutions stay `undefined`, never inferred from the description.
- **Category.** `featureCategory` gains `variant` for `Natural variant` and `Mutagenesis`. Variants never enter the site headline or context counts.
- **Identity.** SIFTS `Variant` → `natural_variant`, exact when position and residue checks agree, exactly like `engineered_mutation`. `residueChangeLabel` shows `E7V (natural variant)`.
- **Deposited match.** A mapped residue whose deposited residue equals one of a variant's alternatives records that the structure carries that substitution. The SIFTS identity is kept as it is: 1OPH A:382 stays `engineered_mutation` and also matches the Pittsburgh variant record.

Acceptance: P68871 yields 261 natural-variant records with 258 substitutions and 3 without; P01009 keeps the 190–198 replacement and the M382V mutagenesis feature as separate records; 2HBS B:VAL6 maps exactly to P68871 7 as `natural_variant`; 1OPH A:ARG382 matches M382R (Pittsburgh); engine and comparison goldens unchanged; contract test updated.

### 5V-B — Projection, tracks and binding-site summary (2–3 days)

Files: `src/biology/projection.ts`, `src/components/AnnotationTracks.tsx`, `src/components/ResidueBiology.tsx`, `src/components/BindingSiteSummary.tsx`, `src/biology/export.ts`.

- **Projection.** Variants project like other features: exact single positions select residues; uncertain or multi-residue spans are listed with their positions and never selected as one residue.
- **Tracks.** Separate `Natural variant` and `Mutagenesis` tracks, off by default.
- **Residue view.** Every variant at the residue: substitution, verbatim description, dbSNP cross-reference, evidence codes and citations, and the note that this is a database record, not a clinical interpretation.
- **Binding-site summary.** "Curated natural variants at *n* of *m* mapped contact residues", beside the background "*a* of *t* mapped residues in the same chains", and the same for mutagenesis. Proteins without records say "UniProt lists no natural variants for P00760", not 0 %.
- **Exports.** Interpretation JSON schema 3 and CSV include variant records and per-residue variant overlap.

Acceptance: the 4HHB chain B heme site lists its variant positions beside the chain background (curated variants at 130 of the 146 mapped positions, UniProt 2–147); 3PTB says P00760 lists none; an uncertain-boundary synthetic variant is listed and never selected; exports round-trip.

### 5V-C — Structural consequence rules (3–4 days)

Files: `src/biology/consequences.ts`, `src/components/VariantConsequences.tsx`, `tests/variant-consequences.test.ts`.

For each analyzed interaction whose receptor residue carries a single-residue substitution X→Y, and whose deposited residue is X, classify every receptor atom of the interaction by name:

| Deposited atom | Statement code | Wording |
| --- | --- | --- |
| Backbone N, CA, C, O, OXT | `deposited_atom_retained` | The interacting backbone atom is present in every amino acid. Its position after substitution is not evaluated. |
| Backbone N acting as hydrogen-bond donor, Y = Pro | `backbone_nitrogen_without_hydrogen` | Proline's backbone nitrogen carries no hydrogen. |
| CB, Y ≠ Gly | `deposited_atom_retained` | Cβ is present in the substituted residue. |
| CB, Y = Gly | `deposited_atom_absent` | Glycine has no Cβ. |
| Any side-chain atom beyond CB | `deposited_atom_absent` | The deposited side-chain atom is not part of the substituted residue. Whether the substituted residue forms this or another interaction is not evaluated. |
| X = Gly (no side chain) | `side_chain_added` | The substituted residue adds side-chain atoms that are not modeled. Contacts and clashes they would make are not evaluated. |

- **Not evaluated:** deletions, multi-residue replacements, uncertain boundaries, non-standard or modified deposited residues, deposited residue ≠ the variant's original residue (for example the structure already carries a variant), and interaction types whose receptor participant is not a polymer atom.
- **Group interactions** (rings, charged groups, hydrophobic contacts) are classified per participating atom; the row reports whether all, some or none of its deposited receptor atoms are retained.
- **Water bridges** classify the receptor atom of the protein leg.
- **No name equivalence.** Atom names shared by two residue types (Asp OD1 and Asn OD1, Leu CD1 and Ile CD1) are not treated as the same atom: anything beyond Cβ is absent unless X = Y.

Acceptance: 4HHB chain B heme: H93D/N/P/Q at the proximal histidine report the Fe–NE2 coordination as `deposited_atom_absent` with the "not evaluated" clause; H64Y (M-Saskatoon) at the distal histidine reports its side-chain contacts the same way, with the UniProt record quoted unchanged beside it; F43S (Hammersmith) side-chain contacts are absent while any backbone contact is retained; synthetic X→Pro on a backbone-N hydrogen bond, X→Gly on a CB contact and Gly→X cases give the expected codes; the wording test passes over every generated string.

### 5V-D — Deposited structures carrying a substitution (3–4 days)

Files: `src/data/variantCarriers.ts`, `src/data/biologySchemas.ts`, `src/biology/carriers.ts`, `src/components/VariantCarriers.tsx`, `src/comparison/controller.ts`.

- **Lookup.** On request, one `alignments(from: UNIPROT, to: PDB_ENTITY)` query per accession, with `query_sequence`, `target_sequence` and `aligned_regions`. Zod-validated; bounded by size (10 MB), timeout and retries like other biology sources; stored as a pinned resource with hash and retrieval time. The query sequence must equal the pinned UniProt sequence, otherwise the lookup is refused as `source_conflict`.
- **Carriers.** For each curated substitution, entities whose aligned target residue at that UniProt position equals the alternative: `sequence_carries`. Entities aligned elsewhere count as `not_covered`; entities with another residue are not listed. Every listed carrier is a sequence-level statement: whether the residue is observed in the coordinates is checked only when the entry is opened.
- **Open as comparison.** A carrier opens as a Phase 4 comparison structure. Its SIFTS mapping then gives the residue identity (`natural_variant`, `engineered_mutation`, `conflict`), and the comparison shows measured interaction and site differences. A carrier whose SIFTS residue disagrees with the alignment is flagged, not hidden.
- **Sessions.** The lookup's resource ID is saved; restoring never refetches.

Acceptance: from frozen responses, β E7V lists 2HBS and 1HBS among its carriers, P01009 M382R lists 1OPH and E366K lists 5IO1 and 5NBV; the alignment-derived residue at every variant position agrees with the frozen SIFTS XML for 1OPH, 2HBS, 4HHB, 1HHO, 2DN1, 2DN2, 3PTB, 1S0R and 1S0Q; opening 2HBS against 4HHB pairs UniProt 7 as E→V instead of `not_comparable`; a failed lookup leaves interpretation, analysis and comparison intact.

### 5V-E — Validation and release (2–3 days)

Files: `validation/VARIANTS.md`, `tests/e2e/variants.spec.ts`, `tests/variants-golden.test.ts`, README, CLAUDE.md, `docs/PHASE_5_STATUS.md`.

- Hash-pinned golden variant output (records, projection, binding-site overlap, consequences) for 4HHB, 1OPH, 2HBS and 3PTB.
- Browser workflows: show variant tracks, read a variant's record and consequences from a contact row, look up carriers, open one as a comparison structure, save and restore without new requests, failure isolation.
- Documentation of every rule, limit, wording choice and known case where the atom-level statement understates what a substitution does (Hb M Saskatoon, Hb M Hyde Park).

Acceptance: all gates above pass in CI; the release records `biology-1.2.0`, `comparison-1.1.0`, interpretation JSON schema 3 and the validation evidence.

## Risks

- **Reading proximity as causation.** A variant at a contact residue looks like an explanation. Mitigated by background rates, quoted source text, the wording test and no effect categories. It cannot be removed entirely.
- **Quoted text carries claims.** UniProt descriptions state effects ("unstable", "O(2) affinity up"). They are attributed and visibly quoted, never restated as the application's finding.
- **Unversioned carrier source.** The sequence-coordinates API has no release number, so lookups are reproducible only through the pinned response. Its SIFTS provenance comes from RCSB's entity records, not the API documentation; the cross-check against frozen SIFTS XML guards it.
- **Large proteins.** Entries with thousands of entities (lysozyme, thrombin, HIV protease) may exceed the size bound and fail per protein, with the reason shown.
- **Name-based atom classes.** Classification relies on standard atom names. Non-standard naming in a deposited residue makes that residue `not_evaluated` rather than guessed.

## Implementation record

- **5V-A.** As planned.
  - **Records.** `uniprotSchema` keeps `alternativeSequence` and `featureCrossReferences`, each dropped on its own if malformed so the rest of the record still parses. `parseUniProt` sets `substitution` only for `Natural variant` and `Mutagenesis` features with exact bounds whose stated original residues equal the sequence; otherwise it records a quality flag. Other feature types (sequence conflicts, isoform `Alternative sequence`) are unchanged. P68871: 261 natural variants, 258 with a replacement, none flagged.
  - **Category.** `featureCategory` returns `variant` for both types. `summarizeBindingSite` skips them, so site and context counts are unchanged. The interpretation CSV's feature-category column now says `variant` for these features instead of `processing_or_other`.
  - **Identity.** SIFTS `Variant` → `natural_variant`. 2HBS β Val6 (all four β chains) maps exactly to P68871 7 with `E → V`.
  - **Deposited match.** `src/biology/variants.ts` (`variantResidueStates`) compares each variant's stated residues with the deposited residues of every chain instance: `carries`, `original`, `other` or `not_evaluated` with a reason. Only exact mappings of observed residues are read, and the SIFTS identity is reported alongside. 2HBS carries E7V and reports Hb C (E7K) as `other`; 1OPH carries Pittsburgh M382R through a SIFTS engineered mutation, while the M382V mutagenesis feature is `other`; the nine-residue P01009 replacement is compared over its whole span.
  - **Comparison.** 4HHB ↔ 2HBS pairs all 574 positions, with E7V as a residue change in both β chains (`comparison-1.1.0`). Golden comparison outputs were dumped before and after the change: identical apart from the version string. Engine goldens unchanged.
  - **Fixtures.** 2HBS coordinates, discovery JSON and SIFTS XML, hash-pinned in the manifest.
  - **Tests.** `tests/variants.test.ts`.
- **5V-B.** As planned.
  - **Categories.** `ANNOTATION_TYPE_OPTIONS` offers `Natural variant` and `Mutagenesis`; `DEFAULT_ANNOTATION_TYPES` (the default selection) is unchanged. Track tooltips and the feature list show the stated replacement (`variantLabel`), with descriptions quoted.
  - **Residue view.** A separate "Curated variants at this position" block, independent of the category filter, lists each variant with its quoted description, deposited-residue state, cross-references and evidence, and the note that these are database records, not a clinical interpretation.
  - **Binding-site summary.** `variants` (one `VariantOverlap` per type) gives contact residues with variants, the chain background over the same chain instances, and the contacted accessions with and without records. 4HHB chain B heme: natural variants at 18 of 21 mapped contact residues against 130 of 146 in the chain; P68871 lists no mutagenesis features. 3PTB: P00760 lists no natural variants or mutagenesis features. Site-level and context counts are identical with and without variant records.
  - **Older interpretations.** `interpretationVariantStates` reports every variant of a pre-1.2.0 snapshot as `not_evaluated` with a reason to refresh, since those snapshots did not record replacements.
  - **Exports.** Interpretation JSON schema 3 adds `variantResidueStates` and the summary's `variants`; the CSV appends `variant_replacement`, `variant_cross_references` and `variant_deposited_state`.
- **5V-C.** As planned.
  - **Rules.** `src/biology/consequences.ts` (`variantConsequences`, `atomConsequence`) classifies the deposited receptor atoms of every chemical interaction (the fingerprint types: not proximity contacts or steric overlaps) at a single-residue variant whose stated original is the deposited residue. Backbone atoms are retained, except a backbone N acting as hydrogen-bond or water-bridge donor when the replacement is proline; Cβ is retained unless the replacement is glycine; every side-chain atom beyond Cβ is absent, with no name equivalence. A deposited glycine adds `sideChainAdded`. Atom names must belong to the deposited residue's standard heavy atoms (the completeness table), otherwise the consequence is `not_evaluated`.
  - **Not evaluated.** Uncertain bounds, no stated replacement, multi-residue replacements and insertions, non-standard components, a deposited residue that already is the replacement or differs from the stated original, and pre-1.2.0 interpretations.
  - **Wording.** `src/biology/consequenceText.ts` is the only source of consequence sentences. Every sentence ends with the statement that atom positions after substitution, and whether the replacement forms this or another interaction, are not evaluated. A test generates every sentence for all 380 residue pairs and their atom names and rejects effect words (`FORBIDDEN_CONSEQUENCE_WORDS`).
  - **4HHB chain B heme.** H93D/N/P/Q: the Fe–NE2 metal coordination atom is absent in each replacement. H64Y (Hb M Saskatoon): the water-bridge ND1 is absent, stated as an atom fact only, beside UniProt's quoted "in M-Saskatoon; O(2) affinity up". F43L/S (Louisville, Hammersmith): the ring-carbon hydrophobic contacts are absent; Hb Bruxelles (deletion) is not evaluated.
  - **Finding.** Glycine's empty side-chain entry made the first version treat glycine as non-standard; the synthetic Gly219 case caught it.
  - **Display and export.** The residue view lists the consequences under each variant for the current analysis (`H→D`, headline, one line per atom, the not-evaluated clause). Interpretation JSON adds `variantConsequences` when an analysis is included.
