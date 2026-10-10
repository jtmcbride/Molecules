import {
  FeatureTypes,
  InteractionType as MolType,
} from "molstar/lib/mol-model-props/computed/interactions/common";
import {
  DEFAULT_PARAMETERS,
  type Ambiguity,
  type AnalysisParameters,
  type MolecularInteraction,
} from "../domain/analysis";
import { metalDistanceLimit } from "./metalDistances";
import type { ResidueRecord, StructureSnapshot } from "../domain/types";
import { isHydrogenElement } from "../domain/elements";
import { reject, type InteractionDraft, type Rejection } from "./collector";
import type { Connectivity } from "./connectivity";
import { participantRole, type FeatureGroup } from "./features";
import { ringGeometry } from "./geometry";
import { angleDegrees, atomDistance } from "./spatial";

/** Everything a classifier may read. Classifiers are pure over this context. */
export interface ClassificationContext {
  snapshot: StructureSnapshot;
  target: ResidueRecord;
  connectivity: Connectivity;
  residueOf: (atom: number) => ResidueRecord;
  /** Components with embedded, CCD or standard-template chemistry. */
  knownComponents: Set<string>;
  /** Residues missing expected heavy atoms. */
  incomplete: Map<string, string[]>;
  /** Nonmetal chemical classification is enabled for this target. */
  chemicalEnabled: boolean;
  /** Request parameters (metal distance policy). Absent only in isolated classifier tests. */
  parameters?: AnalysisParameters;
  /** Receptor His/Cys side-chain atoms (and their residues) coordinating a metal ion. */
  metalSites?: { atoms: Set<number>; residues: Set<string> };
}

const AMIDE_ATOMS: Record<string, string[]> = {
  ASN: ["OD1", "ND2"],
  GLN: ["OE1", "NE2"],
};
const HIS_RING = ["ND1", "NE2"];
/** Ambiguities of a receptor polar atom: Asn/Gln amide orientation, His ring tautomer. */
export function polarAtomAmbiguities(
  ctx: ClassificationContext,
  atom: number,
): Ambiguity[] {
  const component = ctx.residueOf(atom).componentId,
    name = ctx.snapshot.atoms[atom].name;
  if (AMIDE_ATOMS[component]?.includes(name)) return ["amide_flip"];
  if (component === "HIS" && HIS_RING.includes(name)) return ["his_tautomer"];
  return [];
}

/** Validated ligand/receptor endpoints shared by every contact type. */
export interface Endpoints {
  ligand: FeatureGroup;
  receptor: FeatureGroup;
  base: Pick<
    MolecularInteraction,
    "ligand" | "receptor" | "distanceAngstrom" | "closestAtomPair"
  >;
  /** Either endpoint belongs to a residue with a recorded preferred alternate conformer. */
  disordered: boolean;
}

/**
 * Endpoint checks applied before any type rule: receptor chemistry is known, nonmetal
 * chemistry is enabled and complete, the receptor group is one residue, and (except for
 * metal coordination) no endpoint pair is one or two covalent bonds apart.
 */
export function validateEndpoints(
  ctx: ClassificationContext,
  ligand: FeatureGroup,
  receptor: FeatureGroup,
  type: number,
): Endpoints | Rejection {
  if (!ligand.atoms.length || !receptor.atoms.length)
    return reject("not_ligand_receptor");
  const receptorResidue = ctx.residueOf(receptor.atoms[0]);
  const metal = type === MolType.MetalCoordination;
  // A metal-ion receptor component needs no chemical definition for coordination.
  if (
    !ctx.knownComponents.has(receptorResidue.componentId) &&
    !(metal && receptorResidue.kind === "ion")
  )
    return reject("unknown_receptor_chemistry");
  if (!metal && !ctx.chemicalEnabled) return reject("chemistry_not_evaluated");
  if (!metal && ctx.incomplete.has(receptorResidue.id))
    return reject("incomplete_receptor_residue");
  if (new Set(receptor.atoms.map((i) => ctx.residueOf(i).id)).size !== 1)
    return reject("multi_residue_receptor_group");
  const positions = ctx.snapshot.atomBuffer.positions;
  let distance = Infinity,
    closest: [number, number] = [ligand.atoms[0], receptor.atoms[0]];
  for (const x of ligand.atoms)
    for (const y of receptor.atoms) {
      if (!metal && ctx.connectivity.ligandReceptorBonded(x, y))
        return reject("bonded_endpoints");
      const d = atomDistance(positions, x, y);
      if (d < distance) {
        distance = d;
        closest = [x, y];
      }
    }
  return {
    ligand,
    receptor,
    base: {
      ligand: {
        residueId: ctx.residueOf(ligand.atoms[0]).id,
        atomIndices: ligand.atoms,
        role: participantRole(ligand.type, "ligand"),
      },
      receptor: {
        residueId: receptorResidue.id,
        atomIndices: receptor.atoms,
        role: participantRole(receptor.type, "receptor"),
      },
      distanceAngstrom: distance,
      closestAtomPair: closest,
    },
    disordered: [...ligand.atoms, ...receptor.atoms].some(
      (i) => ctx.residueOf(i).preferredAltId !== null,
    ),
  };
}

const RING_NOTE =
  "Aromatic ring / charged-group centroids and ring planes pass the Mol* distance, offset and orientation rules. Endpoint distance is the minimum atom-pair distance; centroid distance is reported separately.";
const METAL_NOTE =
  "Metal identity and partner typing pass the Mol* distance rule. Reported partners/angles cover selected polymer chains; solvent and other ligand coordination are not a complete sphere or an oxidation-state assignment.";
const IONIC_NOTE =
  "Charge and protonation are assigned by the Mol* rules; solution pH is not modeled.";
const HYDROPHOBIC_NOTE =
  "Nonpolar atom proximity; no interaction energy is calculated.";
const IMPLICIT_H_NOTE =
  "Hydrogen position is absent; donor/acceptor and heavy-atom orientation rules were applied.";
const EXPLICIT_H_NOTE =
  "Explicit hydrogen and donor/acceptor orientation rules were applied.";
export const WATER_BRIDGE_NOTE =
  "Deposited water oxygen mediates donor/acceptor contacts passing both leg and bridge-angle rules. Water hydrogen orientation/protonation remains uncertain. Mol* retains the shortest bridge per donor/acceptor feature pair. Distance in the table is ligand–receptor endpoint distance.";

/** π-stacking (two rings) or cation–π (ring and charged group); only undisordered stacking is geometry-supported. */
export function classifyRing(
  ctx: ClassificationContext,
  e: Endpoints,
  type: number,
): InteractionDraft {
  const stacking = type === MolType.PiStacking;
  return {
    ...e.base,
    type: stacking ? "pi_stacking" : "cation_pi",
    geometry: ringGeometry(
      ctx.snapshot.atomBuffer.positions,
      e.ligand.atoms,
      e.receptor.atoms,
      Number(e.ligand.type) === FeatureTypes.AromaticRing,
      Number(e.receptor.type) === FeatureTypes.AromaticRing,
    ),
    classification:
      stacking && !e.disordered ? "geometry_supported" : "candidate",
    notes: [RING_NOTE],
  };
}

export function classifyMetal(
  ctx: ClassificationContext,
  e: Endpoints,
): InteractionDraft | Rejection {
  const [l, r] = e.base.closestAtomPair;
  const metal = e.base.ligand.role === "metal" ? l : r,
    donor = metal === l ? r : l;
  const metalElement = ctx.snapshot.atoms[metal].element,
    donorElement = ctx.snapshot.atoms[donor].element;
  const limit = metalDistanceLimit(
    metalElement,
    donorElement,
    ctx.parameters ?? DEFAULT_PARAMETERS,
  );
  if (e.base.distanceAngstrom > limit.limit) return reject("metal_distance");
  return {
    ...e.base,
    type: "metal_coordination",
    geometry: {
      metalElement,
      metalLimitAngstrom: limit.limit,
      ...(limit.target !== undefined
        ? { metalTargetAngstrom: limit.target }
        : {}),
      metalLimitSource: limit.source,
    },
    classification: "candidate",
    notes: [
      METAL_NOTE,
      limit.source === "element_specific"
        ? `Accepted within ${limit.limit.toFixed(2)} Å: target ${limit.target!.toFixed(2)} Å for ${metalElement}–${donorElement} (Bazayeva et al. 2024) plus tolerance.`
        : limit.source === "uniform_fallback"
          ? `No element-specific target for ${metalElement}–${donorElement}; the uniform ${limit.limit.toFixed(2)} Å cutoff was applied.`
          : `Uniform metal cutoff ${limit.limit.toFixed(2)} Å.`,
    ],
  };
}

/**
 * Opposing charged groups. Mol* types an uncharged nonpolymer nitrogen as a negative
 * feature in some cases; this ruleset requires an explicit negative formal charge.
 */
export function classifyIonic(
  ctx: ClassificationContext,
  e: Endpoints,
): InteractionDraft | Rejection {
  const negative =
    Number(e.ligand.type) === FeatureTypes.NegativeCharge
      ? e.ligand
      : e.receptor;
  const unsupportedNitrogen = negative.atoms.every((i) => {
    const atom = ctx.snapshot.atoms[i];
    return (
      atom.element === "N" &&
      !(atom.formalCharge !== null && atom.formalCharge < 0)
    );
  });
  if (unsupportedNitrogen) return reject("uncharged_nitrogen_negative");
  const receptorResidue = ctx.residueOf(e.receptor.atoms[0]);
  // A His or Cys side chain coordinating a metal is not available as an ionic partner.
  if (
    ["HIS", "CYS"].includes(receptorResidue.componentId) &&
    ctx.metalSites?.residues.has(receptorResidue.id)
  )
    return reject("metal_bound_residue");
  const his = receptorResidue.componentId === "HIS";
  return {
    ...e.base,
    type: "salt_bridge",
    classification: "candidate",
    ...(his ? { ambiguities: ["his_protonation"] as Ambiguity[] } : {}),
    notes: his ? [IONIC_NOTE, HIS_NOTE] : [IONIC_NOTE],
  };
}
const HIS_NOTE =
  "pH-dependent: the His side chain (pKa about 6) is mostly neutral near pH 7.4; Mol* treats it as positive.";
const AMBIGUOUS_HBOND_NOTE =
  "The receptor atom's identity or protonation is ambiguous in X-ray data (Asn/Gln amide flip or His tautomer); donor/acceptor roles may be reversed.";

export function classifyHydrophobic(
  _ctx: ClassificationContext,
  e: Endpoints,
): InteractionDraft {
  return {
    ...e.base,
    type: "hydrophobic_contact",
    classification: e.disordered ? "candidate" : "geometry_supported",
    notes: [HYDROPHOBIC_NOTE],
  };
}

/** Geometry-supported only with an explicit donor hydrogen and no disorder; otherwise a candidate. */
export function classifyHydrogenBond(
  ctx: ClassificationContext,
  e: Endpoints,
): InteractionDraft | Rejection {
  const [l, r] = e.base.closestAtomPair;
  const donor = Number(e.ligand.type) === FeatureTypes.HydrogenDonor ? l : r,
    acceptor = donor === l ? r : l;
  const positions = ctx.snapshot.atomBuffer.positions;
  // A His/Cys atom donating its lone pair to a metal cannot also hydrogen-bond; short
  // distances to it reflect coordination geometry around the metal.
  if (ctx.metalSites?.atoms.has(r)) return reject("metal_bound_residue");
  const ambiguities = polarAtomAmbiguities(ctx, r);
  const hydrogen = [...ctx.connectivity.neighbors(donor)]
    .filter((i) => isHydrogenElement(ctx.snapshot.atoms[i].element))
    .sort(
      (x, y) =>
        atomDistance(positions, x, acceptor) -
        atomDistance(positions, y, acceptor),
    )[0];
  return {
    ...e.base,
    type: "hydrogen_bond",
    classification:
      hydrogen !== undefined && !e.disordered
        ? "geometry_supported"
        : "candidate",
    hydrogenMode: hydrogen === undefined ? "implicit" : "explicit",
    donorHydrogenAcceptorAngle:
      hydrogen === undefined
        ? undefined
        : angleDegrees(positions, donor, hydrogen, acceptor),
    ...(ambiguities.length ? { ambiguities } : {}),
    notes: [
      hydrogen === undefined ? IMPLICIT_H_NOTE : EXPLICIT_H_NOTE,
      ...(ambiguities.length ? [AMBIGUOUS_HBOND_NOTE] : []),
    ],
  };
}

const HALOGEN_NOTE =
  "Halogen and acceptor pass the Mol* distance, C–X···A linearity and X···A–Y angle rules. σ-hole strength and energy are not estimated.";

/** C–X···A halogen bond; the angle is measured from the halogen's covalently bonded heavy atom. */
export function classifyHalogenBond(
  ctx: ClassificationContext,
  e: Endpoints,
): InteractionDraft {
  const [l, r] = e.base.closestAtomPair;
  const halogen = e.base.ligand.role === "halogen_donor" ? l : r,
    acceptor = halogen === l ? r : l;
  const anchor = [...ctx.connectivity.neighbors(halogen)].find(
    (n) => !isHydrogenElement(ctx.snapshot.atoms[n].element),
  );
  const positions = ctx.snapshot.atomBuffer.positions;
  return {
    ...e.base,
    type: "halogen_bond",
    geometry:
      anchor === undefined
        ? undefined
        : {
            halogenAngleDegrees: angleDegrees(
              positions,
              anchor,
              halogen,
              acceptor,
            ),
          },
    classification: e.disordered ? "candidate" : "geometry_supported",
    notes: [HALOGEN_NOTE],
  };
}

/** Dispatches an oriented Mol* contact to its type rule after the shared endpoint checks. */
export function classifyContact(
  ctx: ClassificationContext,
  ligand: FeatureGroup,
  receptor: FeatureGroup,
  type: number,
): InteractionDraft | Rejection {
  const e = validateEndpoints(ctx, ligand, receptor, type);
  if ("rejected" in e) return e;
  switch (type) {
    case MolType.PiStacking:
    case MolType.CationPi:
      return classifyRing(ctx, e, type);
    case MolType.MetalCoordination:
      return classifyMetal(ctx, e);
    case MolType.Ionic:
      return classifyIonic(ctx, e);
    case MolType.Hydrophobic:
      return classifyHydrophobic(ctx, e);
    case MolType.HydrogenBond:
      return classifyHydrogenBond(ctx, e);
    case MolType.HalogenBond:
      return classifyHalogenBond(ctx, e);
    default:
      return reject("unsupported_type");
  }
}

/** A deposited-water bridge between oriented ligand and receptor donor/acceptor features. */
export function classifyWaterBridge(
  ctx: ClassificationContext,
  ligand: FeatureGroup,
  receptor: FeatureGroup,
  water: FeatureGroup,
): InteractionDraft | Rejection {
  if (!ligand.atoms.length || !receptor.atoms.length || !water.atoms.length)
    return reject("not_ligand_receptor");
  const receptorResidue = ctx.residueOf(receptor.atoms[0]);
  if (!ctx.knownComponents.has(receptorResidue.componentId))
    return reject("unknown_receptor_chemistry");
  if (ctx.incomplete.has(receptorResidue.id))
    return reject("incomplete_receptor_residue");
  const x = ligand.atoms[0],
    y = receptor.atoms[0],
    w = water.atoms[0];
  const c = ctx.connectivity;
  if (ctx.metalSites?.atoms.has(y)) return reject("metal_bound_residue");
  if (
    c.withinTwoBonds(x, w) ||
    c.withinTwoBonds(y, w) ||
    c.ligandReceptorBonded(x, y)
  )
    return reject("bonded_endpoints");
  const positions = ctx.snapshot.atomBuffer.positions;
  const role = (g: FeatureGroup) =>
    Number(g.type) === FeatureTypes.HydrogenDonor ? "donor" : "acceptor";
  return {
    type: "water_bridge",
    ligand: {
      residueId: ctx.residueOf(x).id,
      atomIndices: ligand.atoms,
      role: role(ligand),
    },
    receptor: {
      residueId: ctx.residueOf(y).id,
      atomIndices: receptor.atoms,
      role: role(receptor),
    },
    mediator: {
      residueId: ctx.residueOf(w).id,
      atomIndices: water.atoms,
      role: "water",
    },
    distanceAngstrom: atomDistance(positions, x, y),
    closestAtomPair: [x, y],
    geometry: {
      waterLegDistancesAngstrom: [
        atomDistance(positions, x, w),
        atomDistance(positions, y, w),
      ],
      waterAngleDegrees: angleDegrees(positions, x, w, y),
    },
    classification: "candidate",
    ...(polarAtomAmbiguities(ctx, y).length
      ? { ambiguities: polarAtomAmbiguities(ctx, y) }
      : {}),
    notes: [WATER_BRIDGE_NOTE],
  };
}
