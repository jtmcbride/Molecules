import type { VariantConsequence } from "../domain/biology";
import type { InteractionType } from "../domain/analysis";
import { RESIDUE_NAMES } from "./consequences";

/*
 * The only source of consequence wording (biology-1.2.0). Sentences state facts about the
 * deposited atoms and the replacement residue's composition. They never say whether the
 * replacement forms this or another interaction: a substituted tyrosine binds the heme iron
 * in Hb M Saskatoon (beta H64Y). tests/variant-consequences.test.ts rejects effect words in
 * every sentence this module can produce.
 */

const name = (code: string) => {
  const three = RESIDUE_NAMES[code];
  return three ? three[0] + three.slice(1).toLowerCase() : code;
};
const INTERACTION_NAMES: Record<InteractionType, string> = {
  proximity_contact: "proximity contact",
  hydrogen_bond: "hydrogen bond",
  hydrophobic_contact: "hydrophobic contact",
  salt_bridge: "salt bridge",
  pi_stacking: "π-stacking",
  cation_pi: "cation–π contact",
  metal_coordination: "metal coordination",
  water_bridge: "water bridge",
  steric_clash: "steric overlap",
  halogen_bond: "halogen bond",
};
export const interactionName = (type: InteractionType) =>
  INTERACTION_NAMES[type];

/** One sentence per deposited receptor atom. */
export function atomSentence(
  atom: Extract<VariantConsequence, { status: "evaluated" }>["atoms"][number],
  deposited: string,
  replacement: string,
) {
  switch (atom.code) {
    case "backbone_nitrogen_without_hydrogen":
      return "N: proline's backbone nitrogen carries no hydrogen to donate.";
    case "deposited_atom_retained":
      return atom.atomName === "CB"
        ? `CB: present in ${name(replacement)}.`
        : `${atom.atomName}: a backbone atom, present in every amino acid.`;
    case "deposited_atom_absent":
      return atom.atomName === "CB"
        ? "CB: glycine has no CB."
        : `${atom.atomName}: a side-chain atom of the deposited ${name(deposited)}, not part of ${name(replacement)}.`;
  }
}

/** Sentences for one consequence, in display order. */
export function consequenceSentences(
  consequence: VariantConsequence,
): string[] {
  if (consequence.status === "not_evaluated")
    return [`Not evaluated: ${consequence.reason}`];
  const { deposited, replacement } = consequence;
  const headline =
    consequence.retained === "all"
      ? `All interacting deposited atoms are part of ${name(replacement)}.`
      : consequence.retained === "none"
        ? `None of the interacting deposited atoms are part of ${name(replacement)}.`
        : `Some interacting deposited atoms are not part of ${name(replacement)}.`;
  return [
    headline,
    ...consequence.atoms.map((a) => atomSentence(a, deposited, replacement)),
    ...(consequence.sideChainAdded
      ? [
          `${name(replacement)} adds side-chain atoms that are not modeled; contacts and overlaps they would make are not evaluated.`,
        ]
      : []),
    `Atom positions after substitution, and whether ${name(replacement)} forms this or another interaction, are not evaluated.`,
  ];
}

/** Words that would claim an effect. Quoted source text is exempt and shown as a quotation. */
export const FORBIDDEN_CONSEQUENCE_WORDS = [
  "lost",
  "lose",
  "loss",
  "disrupt",
  "abolish",
  "destabiliz",
  "stabiliz",
  "pathogenic",
  "benign",
  "affinity",
  "damag",
  "deleterious",
  "weaken",
  "strengthen",
  "impair",
];
