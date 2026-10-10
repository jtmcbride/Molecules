import {
  RULESET_VERSION,
  type AnalysisRequest,
  type AnalysisRun,
  type ChemicalDefinition,
} from "../domain/analysis";
import type { StructureSnapshot } from "../domain/types";
import { STANDARD_COMPONENTS } from "./policy";

/**
 * Chemistry source per component, in priority order: an applied CCD definition, embedded
 * chem_comp_bond data, then a Mol* standard residue template. Components without one are unknown.
 */
export function chemistrySources(
  snapshot: StructureSnapshot,
  components: Set<string>,
  definitions: ChemicalDefinition[],
): AnalysisRun["chemistrySources"] {
  const embedded = new Set(snapshot.chemistry.embeddedBondComponentIds);
  const sources: AnalysisRun["chemistrySources"] = [];
  for (const componentId of [...components].sort()) {
    const ccd = definitions.find(
      (d) =>
        d.componentId === componentId &&
        snapshot.chemistry.appliedChemicalDefinitionHashes?.includes(
          d.contentHash,
        ),
    );
    if (ccd)
      sources.push({
        componentId,
        source: "ccd",
        contentHash: ccd.contentHash,
        url: ccd.url,
        retrievedAt: ccd.retrievedAt,
      });
    else if (embedded.has(componentId))
      sources.push({
        componentId,
        source: "embedded",
        contentHash: snapshot.provenance.contentHash,
      });
    else if (STANDARD_COMPONENTS.has(componentId))
      sources.push({
        componentId,
        source: "standard_template",
        version: RULESET_VERSION,
      });
  }
  return sources;
}

/** Assumptions attached to every run of this ruleset. Change only with a RULESET_VERSION bump. */
export const ASSUMPTIONS = [
  "Coordinates are in Å and include the selected assembly transformations.",
  "The selected ligand and polymer receptor chains define endpoints. Eligible deposited waters mediate bridges only when enabled. Other ligand/ion instances are excluded.",
  "Missing atoms and hydrogens are not added. Zero and unknown occupancies are excluded. Standard amino acids and components with atom dictionaries are checked for missing eligible heavy atoms; incomplete endpoints are skipped for nonmetal chemical classification. Completeness of other components is not established.",
  "Metal coordination uses element-specific target distances per metal and donor element (Bazayeva et al., Acta Cryst. D80, 362 (2024)) plus a tolerance, or the uniform cutoff when the policy is uniform or no target exists.",
  "Noncovalent pairs separated by one or two covalent bonds are excluded; ligand–receptor pairs up to three bonds apart are excluded across a covalent attachment. Metal coordination candidates retain deposited coordinate-bond pairs.",
  "Heavy-atom overlaps between typed hydrogen-bond donor and acceptor atoms are short hydrogen bonds, not steric clashes; without chemical typing, such overlaps remain clash candidates.",
  "His salt bridges are pH-dependent candidates (side-chain pKa about 6). Hydrogen bonds and water bridges to Asn/Gln amide or His ring atoms carry flip/tautomer ambiguity labels. His/Cys side chains coordinating a metal ion are not ionic partners, and the coordinating atom is not a hydrogen-bond or water-bridge partner. Protonation, flips and tautomers are labeled, not resolved.",
  "Mol* infers connectivity/valence when deposited chemistry is incomplete. Standard residue templates treat ARG/LYS/HIS as positive and ASP/GLU as negative for ionic candidates.",
  "Mol* contact refinement suppresses redundant hydrophobic contacts and hydrogen bonds overlapping ionic contacts. Negative nitrogen features require an explicit negative formal charge in this ruleset.",
  "Distance measurements and chemical candidates do not estimate affinity or binding energy.",
];

export interface QualityInputs {
  snapshot: StructureSnapshot;
  request: AnalysisRequest;
  incomplete: Map<string, string[]>;
  unknownComponents: string[];
  excludedDisorderedResidues: number;
  excludedOccupancyAtoms: number;
  covalentAttachments?: {
    ligandAtom: number;
    receptorAtom: number;
    provenance: string;
  }[];
  unrecordedCovalent?: [number, number][];
  exemptedClashes?: number;
}

/** "CYS A:481 SG" for a domain atom index. */
export function atomLabel(snapshot: StructureSnapshot, atom: number): string {
  const r = snapshot.residues[snapshot.atomBuffer.residueIndices[atom]],
    c = snapshot.chains.find((ch) => ch.id === r.chainId)!;
  return `${r.componentId} ${c.authAsymId}:${r.authSeqId ?? "?"}${r.insertionCode ?? ""} ${snapshot.atoms[atom].name}`;
}

/** Structure flags plus run-specific completeness, chemistry, conformer and occupancy notes. */
export function qualityFlags(x: QualityInputs): string[] {
  const residues = new Map(x.snapshot.residues.map((r) => [r.id, r]));
  const incomplete = [...x.incomplete].map(([id, atoms]) => {
    const r = residues.get(id)!,
      c = x.snapshot.chains.find((c) => c.id === r.chainId)!;
    return `Missing/excluded heavy atoms in ${r.componentId} ${c.authAsymId}:${r.authSeqId ?? "unnumbered"}${r.insertionCode ?? ""} (${c.operatorId}): ${atoms.join(", ")}. Nonmetal chemical classification skipped.`;
  });
  return [
    ...x.snapshot.provenance.qualityFlags,
    ...incomplete,
    ...(x.unknownComponents.length
      ? [`Unknown component chemistry: ${x.unknownComponents.join(", ")}.`]
      : []),
    ...(x.request.parameters.conformerPolicy === "preferred_residue"
      ? [
          "Preferred conformers are selected independently per residue. Compatibility across residues is unverified.",
        ]
      : []),
    ...(x.excludedDisorderedResidues
      ? [`${x.excludedDisorderedResidues} disordered residues were excluded.`]
      : []),
    ...(x.excludedOccupancyAtoms
      ? [`${x.excludedOccupancyAtoms} atoms were excluded by occupancy.`]
      : []),
    ...(x.covalentAttachments ?? []).map(
      (l) =>
        `Covalently attached ligand: ${atomLabel(x.snapshot, l.ligandAtom)}–${atomLabel(x.snapshot, l.receptorAtom)} (${l.provenance === "geometry_inferred" ? "geometry-inferred" : "deposited"} bond). Pairs up to three bonds apart across the link are excluded.`,
    ),
    ...(x.unrecordedCovalent ?? []).map(
      ([a, b]) =>
        `Possible unrecorded covalent attachment: ${atomLabel(x.snapshot, a)}–${atomLabel(x.snapshot, b)} is closer than the sum of covalent radii plus 0.4 Å with no recorded bond. No bond was inferred.`,
    ),
    ...(x.exemptedClashes
      ? [
          `${x.exemptedClashes} van der Waals overlap(s) between typed hydrogen-bond donor and acceptor atoms were treated as short hydrogen bonds, not steric clashes.`,
        ]
      : []),
  ];
}
