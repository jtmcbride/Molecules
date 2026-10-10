# Phase 2.x implementation plan: interaction ruleset revision

Status: planned, 2026-10-10. Not started. Baseline: `main` after the Phase 3 follow-up milestones (engine `contacts-2.1.0`, ruleset `molstar-5.13.1-ligand-2`, `biology-1.1.0`). This revision comes before Phase 4, because comparing interactions across structures is only meaningful once the rules behind them are right.

## Outcome and boundaries

A user analyzing a covalent inhibitor, a halogenated ligand, a metal site, a disordered binding site or a glycan gets interactions whose rules match the chemistry. Every uncertainty that X-ray coordinates cannot resolve is labeled rather than decided silently. Each rule change is measured against an independent reference set, not argued from a single example.

In scope: the deferred Phase 2.x items listed in [PHASE_3_PLAN.md](PHASE_3_PLAN.md#deferred-phase-2x-ruleset-revisions-enabled-by-3h), plus the validation harness needed to measure them.

Out of scope:
- **Protonation, tautomer and flip preparation (Reduce/PROPKA).** R2 labels these ambiguities and does not resolve them. Explicit-hydrogen input files already work and remain the documented route to geometry-supported H-bonds.
- **Energies, affinities and scoring.**
- **Protein–protein interfaces** (Phase 5).
- **Structural comparison** (Phase 4).

## Ground rules

1. **One ruleset release.** All milestones ship as `RULESET_VERSION = molstar-5.13.1-ligand-3`. During development each milestone regenerates `tests/fixtures/golden/engine.json` deliberately (`UPDATE_ENGINE_GOLDEN=1`). It records the hash change, the per-case count deltas and the reason in `validation/README.md`. No golden regeneration is ever bundled with an unrelated change.
2. **Measured effect.** From V0 onward, every milestone reports its effect on the reference set: per-category agreement against two external tools, before and after. A rule change that lowers agreement needs a written scientific justification, such as the reference tool being demonstrably wrong for that case.
3. **No silent changes to old work.** The analysis cache key already includes the ruleset version, so new runs recompute. Pinned sessions keep their saved `AnalysisRun` and say which ruleset produced it. A refresh produces a new run under the new ruleset.
4. **One classifier per change.** The 3H module boundaries hold: rules change inside `classify.ts`, `contacts.ts`, `metal.ts` or a new sibling module, each with positive, negative and at-cutoff unit tests.
5. **Schema changes are additive.** New fields on `MolecularInteraction` and `AnalysisRun` are optional. The analysis JSON export moves to schema 3 once, at release. The Phase 2 CSV gains columns only at the end.

## Verified fixture candidates

Retrieved and inspected 2026-10-10 from RCSB (title, resolution, and the specific feature verified in the coordinates). Freeze them with SHA-256 manifests when each milestone starts.

| Entry | Content | Resolution | Verified feature | Milestone |
| --- | --- | --- | --- | --- |
| 5P9J | BTK with ibrutinib (8E8, bound form) | 1.08 Å | Cys481 SG–8E8 CAA 1.85 Å; `struct_conn` covale recorded (single-row category) | R1 |
| 4G5J | EGFR with afatinib (0WN, bound form) | 2.8 Å | Cys797 SG–0WN C30 1.84 Å; `struct_conn` covale recorded | R1 |
| 1J91 | Maize CK2α with 4,5,6,7-tetrabromobenzotriazole (TBS) | 2.22 Å | Brominated ligand; Br···O halogen-bond geometry to be confirmed in V0 | R4 |
| 1K4C | KcsA–Fab, high K⁺ | 2.0 Å | K⁺ with 60 `metalc` records | R3 |
| 1ATP | PKA catalytic subunit with ATP and Mn²⁺ | 2.2 Å | Mn²⁺ coordinated by ATP phosphates (11 `metalc` records) | R3, R6 |
| 1RMD, 3PTB | Existing fixtures (Zn site; Ca²⁺ and benzamidine) | 2.1, 1.7 Å | Already frozen | R2, R3 |

Not yet chosen, and chosen by script rather than from memory in V0:
- **Altloc structure:** a high-resolution complex with alternate conformers on at least two residues within 5 Å of the ligand, at least one of them making a polar contact.
- **Glycoprotein:** an N-glycan of at least three residues in a branched entity, with a contacting protein surface.

The V0 scan script records its candidate list and the selection criteria. None of the five verified entries has alternate conformers within 5 Å of its ligand.

Note for scripts: mmCIF categories with a single row are written as key–value pairs, not `loop_` tables. 5P9J and 4G5J record their covalent links that way. Mol* parses both forms. Ad hoc validation scripts must too.

## Milestones and acceptance gates

Estimates are engineering working days, excluding review. Total: 13–22 days.

### V0 — Reference validation harness (3–5 days)

Files: `scripts/reference-set.py` (successor to `scripts/plip-reference.py`), `validation/reference-set.json`, `tests/reference-set.test.ts`, `validation/README.md`.

- Assemble 20–30 complexes: an Astex Diverse Set subset (Hartshorn et al., J. Med. Chem. 2007) for drug-like ligands, plus the verified entries above and the two script-selected entries. Cover H-bonds, salt bridges, π-stacking, cation–π, halogen bonds, metals (Zn, Mg/Mn, Ca, K, Na), covalent ligands, altlocs and glycans.
- Run PLIP 3.0.0 (already pinned) and a second tool. Recommended: ProLIF (Bouysset & Fiorucci, J. Cheminform. 2021), which also produces interaction fingerprints that Phase 4 needs. Arpeggio (Jubb et al., J. Mol. Biol. 2017) covers more contact types but is harder to install reproducibly. Pin tool versions, inputs and preparation exactly as for the current PLIP reference.
- Normalize observations to type + receptor residue + ligand atom group. Tests compute per-category agreement for the current ruleset and pin it as the baseline. Like today, reference generation runs outside CI; tests read pinned observations.
- Produce a per-case discrepancy table that later milestones update.

Acceptance: baseline agreement is recorded for every category and tool; all inputs are hash-pinned; the scan script reproducibly selects the altloc and glycan entries; no change to engine output (goldens untouched).

### R1 — Covalent ligands and clash exemptions (1–2 days)

Files: `src/analysis/connectivity.ts`, `src/analysis/contacts.ts`, `src/analysis/classify.ts`, `src/domain/analysis.ts`, `src/components/AnalysisPanel.tsx`.

- Detect ligand–receptor covalent attachment from the selected context's connectivity (Mol* includes `struct_conn` covale bonds). Record it on the run as `covalentAttachments: { ligandAtom, receptorAtom, provenance }[]` and label the ligand as covalently attached in the UI.
- Extend bonded-pair exclusion to atom pairs three bonds apart only when the shortest path crosses a ligand–receptor covalent link. Intra-ligand and intra-receptor exclusion stay at two bonds.
- Add a geometric check: a ligand–receptor heavy-atom pair closer than the sum of covalent radii plus 0.4 Å, with no recorded bond, adds a quality flag ("possible unrecorded covalent attachment"). It never adds a bond.
- Exempt typed donor–acceptor pairs from steric clashes and report them as short hydrogen-bond contacts. This needs donor/acceptor typing before the clash step: compute clashes after Mol* features, or pass feature sets into `stericClashes`.

Acceptance: 5P9J and 4G5J report a covalent attachment and contain no proximity contacts or clashes between atoms three bonds apart across the link; a synthetic N···O pair at 2.45 Å is a short H-bond contact, not a clash; 3PTB, 1EVE and 1RMD counts are unchanged, or any change is explained.

### R2 — Ambiguity labels (1–2 days)

Files: `src/analysis/classify.ts`, `src/analysis/policy.ts`, `src/domain/analysis.ts`, `src/components/AnalysisPanel.tsx`, `src/analysis/export.ts`.

- Add `ambiguities?: ("his_protonation" | "amide_flip" | "his_tautomer")[]` to `MolecularInteraction`. Detection and distances are unchanged.
- Salt bridges involving His become a separate `ph_dependent` tier (His side-chain pKa is about 6), shown distinctly from Arg/Lys/Asp/Glu salt bridges.
- Flag H-bonds involving Asn OD1/ND2, Gln OE1/NE2 or His ND1/NE2 as flip- or tautomer-ambiguous, since X-ray data rarely distinguishes them.
- Exclude His or Cys side chains coordinating a metal from ionic typing. This needs metal ions in the context even when they are not the target. Add non-target metal ions as context-only atoms used for this check, never as endpoints until R6.

Acceptance: synthetic fixtures for each ambiguity; the 1RMD zinc-coordinating cysteines and histidine are excluded from ionic candidates; ambiguity labels appear in the inspector, JSON and an appended CSV column.

### R3 — Element-specific metal coordination distances (1–2 days)

Files: new `src/analysis/metalDistances.ts`, `src/analysis/metal.ts`, `src/domain/analysis.ts` (parameters), `src/components/AnalysisPanel.tsx`.

- Replace the uniform 3.0 Å cutoff with target distances by metal and donor element, transcribed from Harding's tables (Acta Cryst. D62, 678, 2006), plus a documented tolerance. Expected ranges: Zn/Mg/Mn about 2.0–2.2 Å, Ca/Na about 2.4 Å, K about 2.8 Å. Record the table source and version in the module and in run assumptions.
- Metals missing from the table fall back to the uniform cutoff, with a per-interaction note.
- Add a parameter: metal distance policy `element_specific` (default) or `uniform` (the current behavior, for comparison).

Acceptance: 1K4C K⁺ partners are retained; second-shell Zn partners beyond tolerance in synthetic fixtures are rejected; 1RMD keeps its four partners; 1ATP Mn²⁺ partners are reported and compared with deposited `metalc` records.

### R4 — Halogen bonds (1–2 days)

Files: `src/analysis/parameters.ts`, `src/analysis/classify.ts`, `src/domain/analysis.ts`, `tests/fixtures/halogen-bond.cif`.

- Enable Mol*'s halogen-bond provider and expose its distance and angle parameters. Add `halogen_bond` to `InteractionType`, labels, colors, evaluation, export and the 3D legend.
- Add a synthetic positive/negative fixture (C–Br···O=C at bonding and non-bonding angles), and add 1J91 to the PLIP comparison.

Acceptance: synthetic angle boundaries behave as specified; 1J91 Br···O contacts are reported and compared with PLIP; ligands without halogens show `halogen_bond` as evaluated with zero results, not as not evaluated.

### R5 — Per-altloc ensemble analysis (3–5 days)

Files: `src/analysis/policy.ts`, new `src/analysis/ensemble.ts`, `src/analysis/engine.ts`, `src/domain/identity.ts`, `src/domain/analysis.ts`, `src/components/AnalysisPanel.tsx`, `src/biology/projection.ts` (binding-site union).

- Add the conformer policy `ensemble`. For each altloc label in the context (bounded, e.g. at most 4), select atoms with no altloc or that label. A residue lacking the label contributes its highest-occupancy conformer, flagged as an assumed combination. Run the existing pipeline once per label.
- Merge per-conformer results by type, residues and atom names, since atom rows differ between conformers. Record `conformers: { altId, occupancy }[]` and presence `all` or `partial` on each interaction.
- The binding-site union includes residues contacting in any conformer; the summary marks partial-only residues.
- Decision needed: whether `ensemble` replaces `exclude_disordered` as the default (recommended), or ships as an option for one release. A ligand with altlocs is analyzed per conformer instead of being refused.

Acceptance: on the script-selected altloc entry, interactions present only in conformer B are labeled partial with B's occupancy; a structure without altlocs gives results identical to `exclude_disordered` apart from schema fields; runtime grows roughly linearly with the number of labels.

### R6 — Multi-residue ligands and non-polymer receptor components (3–4 days)

Files: `src/domain/analysis.ts` (request), `src/analysis/policy.ts`, `src/structure/extract.ts`, `src/components/AnalysisPanel.tsx`, `src/state/explorer.ts`, `src/biology/projection.ts`.

- Ligand groups: build selectable groups from branched entities (glycans), covalently linked ligand residues and BIRD/PRD molecules (`pdbx_molecule`), alongside single residues. `AnalysisRequest.ligandResidueIds` becomes an array. A single-residue request is the one-element case, and its cache key is unchanged in meaning.
- Receptor components: allow selected cofactors and metal ions (heme, NAD, Zn, Mn) as receptor endpoints. Report contacts with them separately from polymer contacts. The Phase 3 binding-site summary keeps its polymer-only denominators and lists cofactor contacts beside them.
- Intra-group pairs (sugar–sugar inside a glycan) are excluded as ligand–ligand contacts.

Acceptance: the script-selected glycan is analyzed as one group with no intra-glycan contacts; 1ATP ATP analyzed with Mn²⁺ as a receptor component reports Mn–phosphate coordination; existing single-residue runs keep identical scientific output.

## Release (included in estimates)

- Bump `RULESET_VERSION` to `molstar-5.13.1-ligand-3` and the analysis JSON export to schema 3. Regenerate goldens once more with all rules, and update `validation/README.md` with the final agreement tables against the V0 baseline.
- Update README interaction definitions, defaults, uncertainty policy and limits. Update `docs/PHASE_2_STATUS.md` and CLAUDE.md.
- Run production-browser tests for the covalent label, ambiguity labels, halogen bonds, ensemble presence and a glycan/cofactor analysis.

## Verification matrix

| Case | Required result |
| --- | --- |
| Covalent ligand (5P9J, 4G5J) | Attachment recorded; no proximity contacts or clashes between atoms three bonds apart across the link |
| Unrecorded close contact (synthetic) | Quality flag; no inferred bond |
| Short H-bond (synthetic, 2.45 Å) | Short H-bond contact, not a clash |
| His salt bridge | `ph_dependent` tier, distinct from Arg/Lys |
| Asn/Gln/His H-bonds | Flip/tautomer ambiguity labels |
| Metal-bound His/Cys (1RMD) | Excluded from ionic typing |
| K⁺ (1K4C), Zn second shell (synthetic) | Retained, rejected |
| Halogen bond (synthetic, 1J91) | Angle boundaries respected; PLIP comparison recorded |
| Altloc binding site (selected) | Per-conformer presence and occupancy; no refusal of altloc ligands |
| Glycan (selected), ATP–Mn (1ATP) | One ligand group; cofactor as receptor endpoint |
| Unchanged chemistry (3PTB, 1EVE, 1RMD) | Every count change explained in the validation record |
| Pinned session from ruleset ligand-2 | Restores its saved run and labels the ruleset; refresh recomputes |

## Decisions needed before starting

1. **Run V0 first?** Recommended. Without it, rule changes are judged against three reference structures.
2. **Second reference tool:** ProLIF (recommended, also gives Phase 4 fingerprints) or Arpeggio.
3. **Altloc default:** make `ensemble` the default in this release (recommended), or ship it as an option first.
4. **Protonation preparation stays out of scope**, with R2 labeling ambiguity rather than resolving it. Confirm.

## Phase 4 prerequisites this revision does not cover

- Interaction fingerprints keyed by UniProt position, built on the Phase 3 exact mapping.
- More than one loaded structure, with independent snapshots, analyses and interpretations.
- IndexedDB cache eviction and size accounting, since several structures will be cached.
