import { describe, expect, it } from "vitest";
import {
  FeatureTypes,
  InteractionType as MolType,
} from "molstar/lib/mol-model-props/computed/interactions/common";
import {
  classifyContact,
  classifyHydrogenBond,
  classifyHydrophobic,
  classifyIonic,
  classifyMetal,
  classifyRing,
  classifyWaterBridge,
  validateEndpoints,
  type ClassificationContext,
  type Endpoints,
} from "../src/analysis/classify";
import { InteractionCollector, isRejection } from "../src/analysis/collector";
import { Connectivity } from "../src/analysis/connectivity";
import { proximityContacts, stericClashes } from "../src/analysis/contacts";
import {
  evaluationStatus,
  type EvaluationInputs,
} from "../src/analysis/evaluation";
import { annotateMetalGroups, MAX_ANGLE_PARTNERS } from "../src/analysis/metal";
import {
  DEFAULT_PARAMETERS,
  type MolecularInteraction,
} from "../src/domain/analysis";
import type { ResidueRecord, StructureSnapshot } from "../src/domain/types";

// Synthetic, minimal stand-ins for a parsed snapshot. Only fields read by the classifiers exist.
interface AtomSpec {
  residue: string;
  element: string;
  at: [number, number, number];
  formalCharge?: number;
}
function world(
  atoms: AtomSpec[],
  residues: Partial<Record<string, Partial<ResidueRecord>>> = {},
) {
  const ids = [...new Set(atoms.map((a) => a.residue))];
  const records: ResidueRecord[] = ids.map((id, n) => ({
    id,
    chainId: "A",
    componentId: id.split(":")[0],
    labelSeqId: n + 1,
    authSeqId: String(n + 1),
    insertionCode: null,
    sourceResidueIndex: n,
    kind: id.startsWith("LIG") ? "ligand" : "polymer",
    atomIndices: [],
    preferredAltId: null,
    ...residues[id],
  }));
  const snapshot = {
    atoms: atoms.map((a, i) => ({
      id: String(i),
      name: `X${i}`,
      element: a.element,
      altId: null,
      sourceRow: i,
      formalCharge: a.formalCharge ?? null,
    })),
    residues: records,
    chains: [{ id: "A", authAsymId: "A", operatorId: "1_555" }],
    atomBuffer: {
      positions: new Float32Array(atoms.flatMap((a) => a.at)),
      residueIndices: new Uint32Array(atoms.map((a) => ids.indexOf(a.residue))),
    },
    provenance: { qualityFlags: [] },
  } as unknown as StructureSnapshot;
  const residueOf = (i: number) =>
    records[snapshot.atomBuffer.residueIndices[i]];
  return { snapshot, residueOf, connectivity: new Connectivity() };
}
function context(
  w: ReturnType<typeof world>,
  overrides: Partial<ClassificationContext> = {},
): ClassificationContext {
  return {
    snapshot: w.snapshot,
    target: w.residueOf(0),
    connectivity: w.connectivity,
    residueOf: w.residueOf,
    knownComponents: new Set(["LIG", "ASP", "SER", "LYS", "PHE", "HOH"]),
    incomplete: new Map(),
    chemicalEnabled: true,
    ...overrides,
  };
}
const group = (atoms: number[], type: number) => ({ atoms, type });
function accepted<T extends object>(
  x: T | { rejected: string },
): Exclude<T, { rejected: string }> {
  if ("rejected" in x) throw new Error(`Unexpected rejection ${x.rejected}`);
  return x as Exclude<T, { rejected: string }>;
}
const endpoints = (
  ctx: ClassificationContext,
  l: number[],
  lt: number,
  r: number[],
  rt: number,
  type: number,
) => {
  const e = validateEndpoints(ctx, group(l, lt), group(r, rt), type);
  if (isRejection(e)) throw new Error(`Unexpected rejection ${e.rejected}`);
  return e as Endpoints;
};

describe("connectivity", () => {
  it("treats one- and two-bond neighbors as bonded but not three-bond neighbors", () => {
    const c = new Connectivity();
    c.add(0, 1, 1, 1);
    c.add(1, 2, 1, 1);
    c.add(2, 3, 1, 1);
    c.add(3, 4, 1, 0); // not covalent (flag bit 1 unset)
    expect([
      c.withinTwoBonds(0, 1),
      c.withinTwoBonds(0, 2),
      c.withinTwoBonds(0, 3),
      c.withinTwoBonds(3, 4),
    ]).toEqual([true, true, false, false]);
    c.add(1, 0, 2, 1 | 32);
    expect(c.bonds).toHaveLength(3);
    expect(c.bonds[0].provenance).toBe("dictionary_or_explicit");
  });
});

describe("shared endpoint validation", () => {
  const w = world([
    { residue: "LIG:1", element: "N", at: [0, 0, 0] },
    { residue: "ASP:2", element: "O", at: [2.9, 0, 0] },
    { residue: "ASP:2", element: "O", at: [3.5, 1, 0] },
    { residue: "SER:3", element: "O", at: [3, 2, 0] },
    { residue: "UNK:4", element: "O", at: [3, -2, 0] },
  ]);
  it("returns the closest atom pair and single-residue receptor participant", () => {
    const e = endpoints(
      context(w),
      [0],
      FeatureTypes.PositiveCharge,
      [1, 2],
      FeatureTypes.NegativeCharge,
      MolType.Ionic,
    );
    expect(e.base.closestAtomPair).toEqual([0, 1]);
    expect(e.base.distanceAngstrom).toBeCloseTo(2.9, 5);
    expect(e.base.receptor).toMatchObject({
      residueId: "ASP:2",
      role: "negative_group",
    });
    expect(e.disordered).toBe(false);
  });
  it("rejects with a specific reason for each failed precondition", () => {
    const ctx = context(w);
    const reason = (r: number[], type = MolType.HydrogenBond, c = ctx) => {
      const out = validateEndpoints(
        c,
        group([0], FeatureTypes.HydrogenDonor),
        group(r, FeatureTypes.HydrogenAcceptor),
        type,
      );
      return isRejection(out) ? out.rejected : "accepted";
    };
    expect(reason([])).toBe("not_ligand_receptor");
    expect(reason([4])).toBe("unknown_receptor_chemistry");
    expect(
      reason([1], MolType.HydrogenBond, context(w, { chemicalEnabled: false })),
    ).toBe("chemistry_not_evaluated");
    expect(
      reason(
        [1],
        MolType.HydrogenBond,
        context(w, { incomplete: new Map([["ASP:2", ["CG"]]]) }),
      ),
    ).toBe("incomplete_receptor_residue");
    expect(reason([1, 3])).toBe("multi_residue_receptor_group");
    expect(reason([1])).toBe("accepted");
  });
  it("exempts metal coordination from disabled chemistry, incomplete residues and bonded endpoints", () => {
    const bonded = world([
      { residue: "LIG:1", element: "ZN", at: [0, 0, 0] },
      { residue: "ASP:2", element: "O", at: [2.1, 0, 0] },
    ]);
    bonded.connectivity.add(0, 1, 1, 1);
    const ctx = context(bonded, {
      chemicalEnabled: false,
      incomplete: new Map([["ASP:2", ["CG"]]]),
    });
    expect(
      isRejection(
        validateEndpoints(
          ctx,
          group([0], FeatureTypes.TransitionMetal),
          group([1], FeatureTypes.DativeBondPartner),
          MolType.MetalCoordination,
        ),
      ),
    ).toBe(false);
    const hbond = validateEndpoints(
      context(bonded),
      group([0], FeatureTypes.HydrogenDonor),
      group([1], FeatureTypes.HydrogenAcceptor),
      MolType.HydrogenBond,
    );
    expect(hbond).toEqual({ rejected: "bonded_endpoints" });
  });
  it("flags endpoints from residues with a preferred alternate conformer", () => {
    const d = world(
      [
        { residue: "LIG:1", element: "C", at: [0, 0, 0] },
        { residue: "PHE:2", element: "C", at: [3.8, 0, 0] },
      ],
      { "PHE:2": { preferredAltId: "A" } },
    );
    const e = endpoints(
      context(d),
      [0],
      FeatureTypes.HydrophobicAtom,
      [1],
      FeatureTypes.HydrophobicAtom,
      MolType.Hydrophobic,
    );
    expect(e.disordered).toBe(true);
    expect(classifyHydrophobic(context(d), e).classification).toBe("candidate");
    expect(
      classifyHydrophobic(context(d), { ...e, disordered: false })
        .classification,
    ).toBe("geometry_supported");
  });
});

describe("hydrogen bonds", () => {
  const w = world([
    { residue: "LIG:1", element: "O", at: [0, 0, 0] },
    { residue: "SER:2", element: "O", at: [2.8, 0, 0] },
    { residue: "SER:2", element: "H", at: [1.85, 0, 0] },
  ]);
  it("is a candidate with implicit hydrogens", () => {
    const ctx = context(w);
    const hb = accepted(
      classifyHydrogenBond(
        ctx,
        endpoints(
          ctx,
          [0],
          FeatureTypes.HydrogenAcceptor,
          [1],
          FeatureTypes.HydrogenDonor,
          MolType.HydrogenBond,
        ),
      ),
    );
    expect(hb).toMatchObject({
      type: "hydrogen_bond",
      hydrogenMode: "implicit",
      classification: "candidate",
    });
    expect(hb.donorHydrogenAcceptorAngle).toBeUndefined();
  });
  it("is geometry-supported with an explicit donor hydrogen and reports the D–H···A angle", () => {
    w.connectivity.add(1, 2, 1, 1);
    const ctx = context(w);
    const hb = accepted(
      classifyHydrogenBond(
        ctx,
        endpoints(
          ctx,
          [0],
          FeatureTypes.HydrogenAcceptor,
          [1],
          FeatureTypes.HydrogenDonor,
          MolType.HydrogenBond,
        ),
      ),
    );
    expect(hb).toMatchObject({
      hydrogenMode: "explicit",
      classification: "geometry_supported",
    });
    expect(hb.donorHydrogenAcceptorAngle).toBeCloseTo(180, 4);
  });
});

describe("ionic contacts", () => {
  it("rejects a nitrogen-only negative group unless it carries an explicit negative formal charge", () => {
    const uncharged = world([
      { residue: "LIG:1", element: "N", at: [0, 0, 0] },
      { residue: "LYS:2", element: "N", at: [3, 0, 0] },
    ]);
    const ctx = context(uncharged);
    const e = endpoints(
      ctx,
      [0],
      FeatureTypes.NegativeCharge,
      [1],
      FeatureTypes.PositiveCharge,
      MolType.Ionic,
    );
    expect(classifyIonic(ctx, e)).toEqual({
      rejected: "uncharged_nitrogen_negative",
    });
    const charged = world([
      { residue: "LIG:1", element: "N", at: [0, 0, 0], formalCharge: -1 },
      { residue: "LYS:2", element: "N", at: [3, 0, 0] },
    ]);
    const c2 = context(charged);
    expect(
      classifyIonic(
        c2,
        endpoints(
          c2,
          [0],
          FeatureTypes.NegativeCharge,
          [1],
          FeatureTypes.PositiveCharge,
          MolType.Ionic,
        ),
      ),
    ).toMatchObject({ type: "salt_bridge", classification: "candidate" });
  });
  it("accepts a carboxylate oxygen negative group", () => {
    const w = world([
      { residue: "LIG:1", element: "N", at: [0, 0, 0] },
      { residue: "ASP:2", element: "O", at: [3, 0, 0] },
    ]);
    const ctx = context(w);
    expect(
      classifyIonic(
        ctx,
        endpoints(
          ctx,
          [0],
          FeatureTypes.PositiveCharge,
          [1],
          FeatureTypes.NegativeCharge,
          MolType.Ionic,
        ),
      ),
    ).toMatchObject({ type: "salt_bridge" });
  });
});

describe("ring and metal contacts", () => {
  const hexagon = (z: number, residue: string): AtomSpec[] =>
    Array.from({ length: 6 }, (_, k) => ({
      residue,
      element: "C",
      at: [
        1.4 * Math.cos((k * Math.PI) / 3),
        1.4 * Math.sin((k * Math.PI) / 3),
        z,
      ] as [number, number, number],
    }));
  it("supports undisordered π-stacking geometrically and keeps cation–π a candidate", () => {
    const w = world([...hexagon(0, "LIG:1"), ...hexagon(3.6, "PHE:2")]);
    const ctx = context(w);
    const l = [0, 1, 2, 3, 4, 5],
      r = [6, 7, 8, 9, 10, 11];
    const stack = classifyRing(
      ctx,
      endpoints(
        ctx,
        l,
        FeatureTypes.AromaticRing,
        r,
        FeatureTypes.AromaticRing,
        MolType.PiStacking,
      ),
      MolType.PiStacking,
    );
    expect(stack).toMatchObject({
      type: "pi_stacking",
      classification: "geometry_supported",
    });
    expect(stack.geometry!.centroidDistanceAngstrom).toBeCloseTo(3.6, 4);
    expect(stack.geometry!.planeAngleDegrees).toBeCloseTo(0, 4);
    const cation = classifyRing(
      ctx,
      endpoints(
        ctx,
        l,
        FeatureTypes.AromaticRing,
        r,
        FeatureTypes.PositiveCharge,
        MolType.CationPi,
      ),
      MolType.CationPi,
    );
    expect(cation).toMatchObject({
      type: "cation_pi",
      classification: "candidate",
    });
  });
  it("records the metal element from the metal endpoint", () => {
    const w = world([
      { residue: "LIG:1", element: "ZN", at: [0, 0, 0] },
      { residue: "ASP:2", element: "O", at: [2.1, 0, 0] },
    ]);
    const ctx = context(w);
    const m = classifyMetal(
      ctx,
      endpoints(
        ctx,
        [0],
        FeatureTypes.TransitionMetal,
        [1],
        FeatureTypes.DativeBondPartner,
        MolType.MetalCoordination,
      ),
    );
    expect(m).toMatchObject({
      type: "metal_coordination",
      classification: "candidate",
      geometry: { metalElement: "ZN" },
    });
  });
  it("rejects interaction types outside the ruleset", () => {
    const w = world([
      { residue: "LIG:1", element: "CL", at: [0, 0, 0] },
      { residue: "SER:2", element: "O", at: [3, 0, 0] },
    ]);
    expect(
      classifyContact(
        context(w),
        group([0], FeatureTypes.HalogenDonor),
        group([1], FeatureTypes.HalogenAcceptor),
        MolType.HalogenBond,
      ),
    ).toEqual({ rejected: "unsupported_type" });
  });
  it("omits partner angles above the partner limit but keeps every interaction", () => {
    const n = MAX_ANGLE_PARTNERS + 1;
    const positions = new Float32Array([
      0,
      0,
      0,
      ...Array.from({ length: n }, (_, k) => [
        Math.cos(k),
        Math.sin(k),
        0,
      ]).flat(),
    ]);
    const interactions = Array.from(
      { length: n },
      (_, k) =>
        ({
          type: "metal_coordination",
          ligand: { role: "metal" },
          closestAtomPair: [0, k + 1],
          notes: [],
        }) as unknown as MolecularInteraction,
    );
    annotateMetalGroups(interactions, positions);
    expect(
      interactions.every(
        (i) =>
          i.geometry!.selectedReceptorPartnerCount === n &&
          i.geometry!.selectedReceptorAnglesDegrees === undefined,
      ),
    ).toBe(true);
    expect(interactions[0].notes[0]).toContain(
      `more than ${MAX_ANGLE_PARTNERS}`,
    );
    const three = interactions.slice(0, 3).map((i) => ({
      ...i,
      geometry: undefined as MolecularInteraction["geometry"],
      notes: [],
    }));
    annotateMetalGroups(three, positions);
    expect(three[0].geometry!.selectedReceptorAnglesDegrees).toHaveLength(3);
  });
});

describe("water bridges", () => {
  it("records both legs and the bridge angle, and rejects bonded endpoints", () => {
    const w = world([
      { residue: "LIG:1", element: "O", at: [-2.8, 0, 0] },
      { residue: "SER:2", element: "O", at: [0, 2.8, 0] },
      { residue: "HOH:3", element: "O", at: [0, 0, 0] },
    ]);
    const ctx = context(w);
    const bridge = classifyWaterBridge(
      ctx,
      group([0], FeatureTypes.HydrogenAcceptor),
      group([1], FeatureTypes.HydrogenDonor),
      group([2], FeatureTypes.HydrogenDonor),
    );
    if (isRejection(bridge)) throw new Error(bridge.rejected);
    expect(bridge.ligand.role).toBe("acceptor");
    expect(bridge.receptor.role).toBe("donor");
    expect(bridge.mediator!.role).toBe("water");
    expect(bridge.geometry!.waterLegDistancesAngstrom![0]).toBeCloseTo(2.8, 5);
    expect(bridge.geometry!.waterAngleDegrees).toBeCloseTo(90, 4);
    w.connectivity.add(1, 2, 1, 1);
    expect(
      classifyWaterBridge(
        ctx,
        group([0], FeatureTypes.HydrogenAcceptor),
        group([1], FeatureTypes.HydrogenDonor),
        group([2], FeatureTypes.HydrogenDonor),
      ),
    ).toEqual({ rejected: "bonded_endpoints" });
  });
});

describe("distance boundaries", () => {
  const w = world([
    { residue: "LIG:1", element: "C", at: [0, 0, 0] },
    { residue: "SER:2", element: "C", at: [5, 0, 0] },
    { residue: "SER:2", element: "C", at: [5.001, 0.3, 0] },
  ]);
  const contactContext = (overrides = {}) => ({
    snapshot: w.snapshot,
    ligandResidueId: "LIG:1",
    ligand: [0],
    receptor: [1, 2],
    connectivity: w.connectivity,
    residueOf: w.residueOf,
    parameters: { ...DEFAULT_PARAMETERS, ...overrides },
  });
  it("includes a proximity pair exactly at the cutoff and excludes one just beyond it", () => {
    const collector = new InteractionCollector();
    proximityContacts(contactContext({ proximityCutoff: 5 }), collector);
    expect(collector.interactions.map((i) => i.closestAtomPair[1])).toEqual([
      1,
    ]);
  });
  it("includes a van der Waals overlap exactly at the minimum and excludes one just below it", () => {
    // Carbon radius 1.7 Å: an overlap of 0.6 Å occurs at 2.8 Å.
    const near = world([
      { residue: "LIG:1", element: "C", at: [0, 0, 0] },
      { residue: "SER:2", element: "C", at: [2.8, 0, 0] },
      { residue: "SER:2", element: "C", at: [0, 2.81, 0] },
    ]);
    const collector = new InteractionCollector();
    const support = stericClashes(
      {
        ...contactContext({ clashOverlapMin: 0.6 }),
        snapshot: near.snapshot,
        residueOf: near.residueOf,
        connectivity: near.connectivity,
      },
      collector,
    );
    expect(collector.interactions.map((i) => i.closestAtomPair[1])).toEqual([
      1,
    ]);
    expect(collector.interactions[0].geometry!.overlapAngstrom).toBeCloseTo(
      0.6,
      5,
    );
    expect(support).toEqual({ supportedLigand: 1, supportedReceptor: 2 });
  });
});

describe("evaluation status", () => {
  const base: EvaluationInputs = {
    classifyChemistry: true,
    includeWaters: true,
    chemicalEnabled: true,
    metalEnabled: true,
    targetIncomplete: false,
    targetComponentId: "LIG",
    unknownComponents: [],
    incompleteResidueCount: 0,
    ligandAtoms: 10,
    receptorAtoms: 100,
    supportedLigandAtoms: 10,
    supportedReceptorAtoms: 100,
  };
  it("reports full evaluation, partial evaluation and disabled categories with reasons", () => {
    expect(
      Object.values(evaluationStatus(base)).every(
        (s) => s.status === "evaluated",
      ),
    ).toBe(true);
    const partial = evaluationStatus({
      ...base,
      unknownComponents: ["XYZ"],
      incompleteResidueCount: 2,
    });
    expect(partial.hydrogen_bond).toEqual({
      status: "partially_evaluated",
      reason:
        "Chemical typing was skipped for 1 unknown components and 2 residues with missing/excluded expected heavy atoms.",
    });
    expect(partial.metal_coordination.status).toBe("partially_evaluated");
    const noWater = evaluationStatus({ ...base, includeWaters: false });
    expect(noWater.water_bridge).toEqual({
      status: "not_evaluated",
      reason: "Deposited-water analysis was disabled.",
    });
    const ion = evaluationStatus({
      ...base,
      chemicalEnabled: false,
      ligandAtoms: 1,
      supportedLigandAtoms: 0,
    });
    expect(ion.salt_bridge.status).toBe("not_evaluated");
    expect(ion.steric_clash).toEqual({
      status: "not_evaluated",
      reason: "Metals and atoms without a published radius were excluded.",
    });
  });
});

describe("ambiguity labels and metal-coordinating residues (R2)", () => {
  const w = world([
    { residue: "LIG:1", element: "O", at: [0, 0, 0] },
    { residue: "HIS:2", element: "N", at: [2.9, 0, 0] },
    { residue: "ASN:3", element: "O", at: [0, 2.9, 0] },
    { residue: "SER:4", element: "O", at: [0, 0, 2.9] },
  ]);
  w.snapshot.atoms[1].name = "NE2";
  w.snapshot.atoms[2].name = "OD1";
  w.snapshot.atoms[3].name = "OG";
  const hbond = (ctx: ClassificationContext, receptor: number) =>
    classifyHydrogenBond(
      ctx,
      endpoints(
        ctx,
        [0],
        FeatureTypes.HydrogenAcceptor,
        [receptor],
        FeatureTypes.HydrogenDonor,
        MolType.HydrogenBond,
      ),
    );
  it("labels His ring and Asn/Gln amide hydrogen bonds but not Ser", () => {
    const ctx = context(w, {
      knownComponents: new Set(["LIG", "HIS", "ASN", "SER"]),
    });
    expect(accepted(hbond(ctx, 1)).ambiguities).toEqual(["his_tautomer"]);
    expect(accepted(hbond(ctx, 2)).ambiguities).toEqual(["amide_flip"]);
    expect(accepted(hbond(ctx, 3)).ambiguities).toBeUndefined();
  });
  it("marks His salt bridges pH-dependent and rejects metal-coordinating His as ionic or hydrogen-bond partners", () => {
    const ctx = context(w, {
      knownComponents: new Set(["LIG", "HIS", "ASN", "SER"]),
    });
    const ionic = (c: ClassificationContext) =>
      classifyIonic(
        c,
        endpoints(
          c,
          [0],
          FeatureTypes.NegativeCharge,
          [1],
          FeatureTypes.PositiveCharge,
          MolType.Ionic,
        ),
      );
    expect(accepted(ionic(ctx))).toMatchObject({
      type: "salt_bridge",
      ambiguities: ["his_protonation"],
    });
    const bound = context(w, {
      knownComponents: new Set(["LIG", "HIS", "ASN", "SER"]),
      metalSites: { atoms: new Set([1]), residues: new Set(["HIS:2"]) },
    });
    expect(ionic(bound)).toEqual({ rejected: "metal_bound_residue" });
    expect(hbond(bound, 1)).toEqual({ rejected: "metal_bound_residue" });
    expect(accepted(hbond(bound, 2)).ambiguities).toEqual(["amide_flip"]);
  });
});
