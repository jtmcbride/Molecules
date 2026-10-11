import {
  CONSEQUENCE_CODES,
  type FunctionalAnnotation,
  type InterpretationSnapshot,
  type VariantConsequence,
} from "../domain/biology";
import type { AnalysisRun, InteractionType } from "../domain/analysis";
import type { StructureSnapshot } from "../domain/types";
import { isHydrogenElement } from "../domain/elements";
import { SIDECHAINS } from "../analysis/completeness";
import { interpretationVariantStates, isVariantAnnotation } from "./variants";

export type ConsequenceCode = (typeof CONSEQUENCE_CODES)[number];
/** Chemical interaction types; proximity contacts and steric overlaps are not evaluated. */
export const CONSEQUENCE_INTERACTION_TYPES: readonly InteractionType[] = [
  "hydrogen_bond",
  "salt_bridge",
  "hydrophobic_contact",
  "pi_stacking",
  "cation_pi",
  "halogen_bond",
  "metal_coordination",
  "water_bridge",
];
const BACKBONE = new Set(["N", "CA", "C", "O", "OXT"]);
export const RESIDUE_NAMES: Record<string, string> = {
  A: "ALA",
  R: "ARG",
  N: "ASN",
  D: "ASP",
  C: "CYS",
  Q: "GLN",
  E: "GLU",
  G: "GLY",
  H: "HIS",
  I: "ILE",
  L: "LEU",
  K: "LYS",
  M: "MET",
  F: "PHE",
  P: "PRO",
  S: "SER",
  T: "THR",
  W: "TRP",
  Y: "TYR",
  V: "VAL",
};

/**
 * Atom-level consequence of replacing deposited residue `deposited` with `replacement` for one
 * receptor atom name. Atoms are matched only as backbone or Cβ: side-chain atoms beyond Cβ
 * are never treated as shared, even when two residues use the same name (Asp/Asn OD1).
 */
export function atomConsequence(
  atomName: string,
  replacement: string,
  interactionType: InteractionType,
  role: string,
): ConsequenceCode {
  if (BACKBONE.has(atomName))
    return atomName === "N" &&
      replacement === "P" &&
      role === "donor" &&
      (interactionType === "hydrogen_bond" ||
        interactionType === "water_bridge")
      ? "backbone_nitrogen_without_hydrogen"
      : "deposited_atom_retained";
  if (atomName === "CB")
    return replacement === "G"
      ? "deposited_atom_absent"
      : "deposited_atom_retained";
  return "deposited_atom_absent";
}

/**
 * Consequences for every chemical interaction of `run` whose receptor residue carries a
 * single-residue curated variant whose stated original is the deposited residue. Everything
 * else at a variant position is reported as `not_evaluated` with the reason.
 */
export function variantConsequences(
  interpretation: Pick<
    InterpretationSnapshot,
    "snapshotId" | "version" | "annotations" | "mappings" | "proteins"
  >,
  run: AnalysisRun,
  snapshot: Pick<StructureSnapshot, "id" | "residues" | "atoms">,
): VariantConsequence[] {
  if (
    run.snapshotId !== interpretation.snapshotId ||
    snapshot.id !== interpretation.snapshotId
  )
    throw Error(
      "Interpretation, analysis and structure belong to different coordinate snapshots.",
    );
  const residues = new Map(snapshot.residues.map((r) => [r.id, r]));
  const variants = interpretation.annotations.filter(isVariantAnnotation);
  const states = new Map(
    interpretationVariantStates({
      ...interpretation,
      annotations: variants,
    }).map((s) => [JSON.stringify([s.annotationId, s.chainInstanceId]), s]),
  );
  const output: VariantConsequence[] = [];
  for (const interaction of run.interactions) {
    if (!CONSEQUENCE_INTERACTION_TYPES.includes(interaction.type)) continue;
    const residue = residues.get(interaction.receptor.residueId);
    if (!residue || residue.kind !== "polymer") continue;
    const mappings = interpretation.mappings.filter(
      (m) => m.residueId === residue.id && m.status === "exact",
    );
    for (const mapping of mappings) {
      const here = variants.filter(
        (a) =>
          a.proteinId === mapping.proteinId &&
          a.valid &&
          a.start.position !== undefined &&
          a.end.position !== undefined &&
          a.start.position <= mapping.uniprotPosition &&
          a.end.position >= mapping.uniprotPosition,
      );
      for (const annotation of here) {
        const base = {
          annotationId: annotation.id,
          interactionId: interaction.id,
          residueId: residue.id,
        };
        const reason = notEvaluatedReason(
          annotation,
          residue.componentId,
          states.get(JSON.stringify([annotation.id, mapping.chainInstanceId])),
        );
        if (reason) {
          output.push({ ...base, status: "not_evaluated", reason });
          continue;
        }
        const names = interaction.receptor.atomIndices
          .map((i) => snapshot.atoms[i])
          .filter((atom) => atom && !isHydrogenElement(atom.element));
        const expected = new Set([
          ...BACKBONE,
          ...SIDECHAINS[residue.componentId].split(" ").filter(Boolean),
        ]);
        const unexpected = names.find((atom) => !expected.has(atom.name));
        if (unexpected) {
          output.push({
            ...base,
            status: "not_evaluated",
            reason: `Atom ${unexpected.name} is not a standard ${residue.componentId} atom name.`,
          });
          continue;
        }
        for (const replacement of annotation.substitution!.alternatives) {
          const atoms = interaction.receptor.atomIndices.flatMap((i) => {
            const atom = snapshot.atoms[i];
            return atom && !isHydrogenElement(atom.element)
              ? [
                  {
                    atomIndex: i,
                    atomName: atom.name,
                    code: atomConsequence(
                      atom.name,
                      replacement,
                      interaction.type,
                      interaction.receptor.role,
                    ),
                  },
                ]
              : [];
          });
          const kept = atoms.filter(
            (a) => a.code === "deposited_atom_retained",
          ).length;
          output.push({
            ...base,
            status: "evaluated",
            deposited: annotation.substitution!.original,
            replacement,
            atoms,
            retained:
              kept === atoms.length ? "all" : kept === 0 ? "none" : "some",
            sideChainAdded:
              annotation.substitution!.original === "G" && replacement !== "G",
          });
        }
      }
    }
  }
  return output;
}

function notEvaluatedReason(
  annotation: FunctionalAnnotation,
  componentId: string,
  state: ReturnType<typeof interpretationVariantStates>[number] | undefined,
): string | undefined {
  const substitution = annotation.substitution;
  if (
    annotation.start.modifier !== "exact" ||
    annotation.end.modifier !== "exact"
  )
    return "The feature bounds are uncertain.";
  if (!substitution) return "The source states no residue replacement.";
  if (
    substitution.original.length !== 1 ||
    substitution.alternatives.some((a) => a.length !== 1)
  )
    return "Multi-residue replacements, insertions and deletions are not evaluated.";
  // Glycine's entry is empty, so test membership rather than truthiness.
  if (!Object.hasOwn(SIDECHAINS, componentId))
    return `The deposited residue ${componentId} is not a standard amino acid.`;
  if (!state) return "The deposited residue at this position is not compared.";
  if (state.state === "not_evaluated") return state.reason;
  if (state.state === "carries")
    return "The deposited residue is already the stated replacement.";
  if (state.state === "other")
    return `The deposited residue (${state.deposited}) is not the stated original (${substitution.original}).`;
  return undefined;
}
