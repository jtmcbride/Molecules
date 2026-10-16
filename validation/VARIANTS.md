# Phase 5 curated-variant validation

Evidence for the curated-variant track (`BIOLOGY_VERSION = biology-1.2.0`, interpretation JSON schema 3, `COMPARISON_VERSION = comparison-1.1.0`). The plan and implementation record are in [docs/PHASE_5_PLAN.md](../docs/PHASE_5_PLAN.md). Inputs are the frozen fixtures in `tests/fixtures/biology` (coordinates, SIFTS, UniProt and RCSB sequence-coordinates responses, with SHA-256 manifest). These checks establish regression behavior and agreement between independent sources. They do not validate UniProt's variant statements, and nothing here predicts a variant's effect.

## What is claimed

- **Records.** A curated variant is UniProt's `Natural variant` or `Mutagenesis` feature, with the replacement UniProt states and its cross-references. UniProt's description is quoted unchanged.
- **Deposited residue.** For each chain instance, whether the deposited residues at the variant's positions are the stated replacement (`carries`), the original, neither, or `not_evaluated` with a reason. Only exact SIFTS mappings of observed residues are read.
- **Consequences.** For each analyzed chemical interaction at a single-residue variant whose original is the deposited residue: which interacting deposited atoms are part of the replacement residue. Nothing is modeled, and whether the replacement forms this or another interaction is never stated.
- **Carriers.** Deposited PDB entries whose entity sequence has the replacement at the variant's positions, from RCSB's SIFTS-derived alignments. A sequence-level statement; coordinates and SIFTS labels are checked when an entry is opened.

## Records (`tests/variants.test.ts`)

| Record | Checked |
| --- | --- |
| P68871 (Hb β) | 261 natural variants; 258 state a replacement, 3 do not (Hb Bruxelles, a deletion, among them); none flagged; E7V (Hb S) with dbSNP rs334 |
| P01009 (α1-antitrypsin) | Nine-residue replacement 190–198 kept whole; Pittsburgh M382R (natural variant) and M382V (mutagenesis) kept as separate records |
| P00760 (bovine trypsin) | No natural variants or mutagenesis features; reported as such, not as zero |
| Synthetic (artificial in-memory edits) | Original disagreeing with the sequence, uncertain bounds and a malformed replacement are dropped with a flag; the rest of the record still parses |

Sequence conflicts and isoform `Alternative sequence` features keep their previous form; only variant types carry a replacement.

## SIFTS natural variants (`tests/variants.test.ts`, `validation/COMPARISON.md`)

SIFTS labels residues of natural-variant entries `Variant`. Before `biology-1.2.0` they fell to `sequence_mismatch`. 2HBS (deoxy sickle haemoglobin) β Val6 now maps exactly to P68871 7 in all four β chains, with identity `natural_variant` and change E → V. 4HHB ↔ 2HBS pairs all 574 positions, with E7V as a residue change in both reference β chains. Dropping the annotation in memory (artificial) returns the position to `sequence_mismatch` and the variant state to `not_evaluated`.

| Entry | Variant | Deposited state | SIFTS identity |
| --- | --- | --- | --- |
| 2HBS | P68871 E7V (Hb S) | carries (4 β chains) | natural_variant |
| 2HBS | P68871 E7K (Hb C) | other | natural_variant |
| 1OPH | P01009 M382R (Pittsburgh) | carries | engineered_mutation |
| 1OPH | P01009 M382V (mutagenesis) | other | engineered_mutation |
| 1OPH | P01009 190–198 replacement | original | match |
| 4HHB | P68871 E7V | original (chains B, D) | match |

1OPH shows why the SIFTS identity is reported beside the state: the deposited Arg382 is the Pittsburgh variant, and SIFTS curates it as an engineered mutation. Neither label replaces the other.

## Binding-site counts (`tests/variants.test.ts`, browser workflow)

| Analysis | Contact residues with natural variants | Chain background |
| --- | --- | --- |
| 4HHB chain B heme | 18 / 21 (86 %) | 130 / 146 (89 %) |
| 2HBS chain B heme (contacts in chains B and H) | 20 / 24 | 260 / 292 |
| 3PTB benzamidine | P00760 lists no natural variants | – |

Hemoglobin β has curated variants at 130 of its 147 positions, so a variant at a heme-contact residue is the expectation, not a finding. Site-level and context counts are identical with and without variant records.

## Structural consequences (`tests/variant-consequences.test.ts`)

4HHB chain B heme, default parameters:

| Position | Replacements | Interaction (receptor atoms) | Statement |
| --- | --- | --- | --- |
| His93 (proximal, author 92) | D, N, P, Q | metal coordination (NE2) | deposited atom absent in each replacement |
| His64 (distal, author 63) | Y (Hb M Saskatoon) | water bridge (ND1) | deposited atom absent |
| Phe43 (author 42) | L (Louisville), S (Hammersmith) | hydrophobic contacts (CE1, CZ, CE2) | deposited atoms absent |
| Phe43 | Hb Bruxelles (deletion) | – | not evaluated: no stated replacement |

38 consequences are evaluated and 5 are not. Synthetic cases (artificial records on bovine trypsin, which has none) check a deposited glycine (`sideChainAdded`), Asp189 (UniProt 194) salt bridges with D→N, multi-residue and mismatched-original records, and a renamed non-standard component. Unit cases check backbone atoms, proline's backbone nitrogen as a donor only, Cβ to glycine, and no name equivalence (Asp OD1 vs Asn OD1, Leu CD1 vs Ile CD1).

**Wording.** Every sentence comes from `src/biology/consequenceText.ts`. A test generates all sentences for the 380 ordered residue pairs and each deposited atom name (more than 1,000 distinct sentences) and rejects effect words (lost, disrupt, abolish, destabilize, pathogenic, benign, affinity, damaging, deleterious, weaken, strengthen, impair). UniProt's quoted text is exempt and shown as a quotation.

**Known understatement.** In Hb M Saskatoon (β H64Y) and Hb M Hyde Park (proximal His→Tyr), the replacement tyrosine binds the heme iron. The atom-level statement ("ND1 … not part of Tyr") is true and says nothing about the tyrosine's own interaction. That is why the wording never says an interaction is lost.

## Carriers (`tests/variant-carriers.test.ts`)

Frozen RCSB sequence-coordinates responses (POST GraphQL; exact request bodies in the manifest), retrieved 2026-10-10:

| Accession | Deposited entities | Computed models (not used) |
| --- | --- | --- |
| P68871 | 351 | 1 (AlphaFold) |
| P69905 | 358 (7 with multi-region alignments) | 1 |
| P01009 | 57 | 1 |
| P00760 | 618 | 1 |

| Variant | Entries whose entity sequence carries it |
| --- | --- |
| P68871 E7V (Hb S) | 1HBS, 1NEJ, 2HBS, 3W4U, 5E6E, 5E83, 5U3I, 5UFJ, 7K4M, 7UVB |
| P01009 M382R (Pittsburgh) | 1D5S, 1OO8, 1OPH, 1QMB, 3NDD, 3NDF, 3T1P, 5IO1 |
| P01009 E366K (Z) | 5IO1, 5NBV |

**Cross-check against SIFTS.** For every SIFTS-mapped standard residue of the nine frozen entries, the residue the RCSB alignment gives at that UniProt position equals the SIFTS residue: 4,175 of 4,175 (1OPH 636, 2HBS 1,148, 4HHB 574, 1HHO 287, 2DN1 287, 2DN2 574, 3PTB 223, 1S0R 223, 1S0Q 223). This supports RCSB's statement that the alignments are SIFTS-derived. It does not cover entries outside the fixtures.

**Refusals.** An aligned UniProt sequence that differs from the pinned record (source conflict), a GraphQL error and an entity whose regions disagree with its sequence (artificial in-memory edits) are refused or set aside. Insertions, deletions and uncertain bounds are not looked up.

## Browser workflows (`tests/e2e/variants.spec.ts`)

1. 4HHB chain B heme: binding-site counts 18 / 21 beside 130 / 146; "UniProt P68871 lists no mutagenesis features"; His92's variants with quoted text, deposited state and the H→D consequence; variant categories off by default.
2. Carrier lookup for P68871 from β Glu6, opening 2HBS as a comparison structure (E7V paired), saving and restoring the session with biology requests blocked: the lookup is restored as pinned with no new request.
3. A failed lookup (HTTP 400) shows its error and leaves the interpretation, binding-site summary and analysis intact.

## Golden output (`tests/variants-golden.test.ts`)

SHA-256 of the full variant output (records, projections, deposited states, binding-site variant overlaps, consequences) for 4HHB chain B heme, 2HBS chain B heme, 3PTB benzamidine and 1OPH, pinned in `tests/fixtures/golden/variants.json`. Regenerate deliberately with `UPDATE_VARIANTS_GOLDEN=1` and record the reason here. `DUMP_VARIANTS_GOLDEN=<dir>` writes the canonical JSON.

## Limits

- UniProt canonical sequences only; isoform variants are not converted. ClinVar, gnomAD and predictors are not used.
- Consequences cover single-residue replacements of standard deposited residues and the chemical interaction types; proximity contacts and steric overlaps are not evaluated.
- Carriers are sequence-level. The sequence-coordinates API has no release number, so a lookup is reproducible only through its pinned response. Very large responses (more than 10 MB) fail per protein.
- Four-character PDB entries only; computed models are never listed.

## Change log

- **biology-1.2.0 (Phase 5).** Introduced; see above.

## Protein-level discovery (M3, package 0.5.2)

The protein table is a display selector over the pinned interpretation. It uses the existing projection and deposited-state policies; it introduces no variant-effect model or scientific version change. Feature totals count source records once per protein, with chain instances expanded underneath. Interpretation JSON/CSV remains the complete export independent of table pagination or filters.

`tests/variant-table.test.ts` checks P68871's 261 records, P00760's absence of curated records, the intact P01009 replacement at 190–198, and identical totals before/after the 1HHO assembly duplicates its beta chain. Synthetic edits separately exercise outside-fragment, unobserved, ambiguous, uncertain and partially observed multi-position features. Synthetic interactions isolate proximity/chemical/clash receptor membership and missing/mismatched-analysis availability. Existing scientific goldens remain the calculation checks.

`tests/carrier-controller.test.ts` checks per-accession deduplication, ready/pinned reuse, cancellation and retry, late-result rejection and isolated failures. `tests/selection.test.ts` checks persistent residue-set resolution and invalidation after coordinate replacement. The browser variant suite adds protein search → chain inspection → evidence → carrier → comparison, shared lookup reuse, pagination, phone-width containment, chain re-selection, and filtering without changing the binding-site summary. Existing browser workflows continue to cover pinned restoration and provider failure. Frozen responses establish reproducible local behavior; live provider/CORS checks belong to the release checklist.
