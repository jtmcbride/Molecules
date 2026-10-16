import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  preparePoseInput,
  preparePoseLigand,
} from "../src/comparison/ligandPoseInput";
import {
  chemicalGraph,
  chemicalGraphConflict,
  poseAttachment,
  poseCifFrame,
  poseGraphIdentity,
} from "../src/structure/chemicalGraph";
import { isHydrogenElement } from "../src/domain/elements";
import type {
  PoseChemistry,
  PoseLigandPreparation,
  PreparedPoseLigand,
} from "../src/domain/ligandPose";
import type { SuperpositionResult } from "../src/domain/comparison";
import { benChemistry, poseFixture, sha } from "./helpers/ligandPose";
let p: Awaited<ReturnType<typeof poseFixture>>, chemistry: PoseChemistry;
beforeAll(async () => {
  [p, chemistry] = await Promise.all([poseFixture(), benChemistry()]);
});
function prepared(r: PoseLigandPreparation): PreparedPoseLigand {
  if (r.status !== "prepared") throw Error(JSON.stringify(r));
  return r.ligand;
}
function copy() {
  return {
    snapshot: structuredClone(p.snapshot),
    chemistry: structuredClone(chemistry),
    attachment: structuredClone(p.attachment),
  };
}
function prepare(c = copy(), options = {}) {
  return preparePoseLigand(
    c.snapshot,
    [p.residue.id],
    c.chemistry,
    c.attachment,
    options,
  );
}
const first = () => p.residue.atomIndices[0];
const fit: SuperpositionResult = {
  scope: "global",
  method: "synthetic fixed transform",
  atoms: "CA",
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
  rmsdCore: 0,
  rmsdAll: 0,
  fitted: 3,
  total: 3,
  cycles: 0,
  rejected: [],
};

describe("pinned pose chemistry", () => {
  it("pins existing coordinate/CCD bytes and independently stated BEN graph facts", async () => {
    const manifest = JSON.parse(
      await readFile("tests/fixtures/ligand-pose/manifest.json", "utf8"),
    );
    for (const f of manifest.sources)
      expect(sha(await readFile(f.path))).toBe(f.sha256);
    expect(chemistry.graph.atoms).toHaveLength(17);
    expect(chemistry.graph.bonds).toHaveLength(17);
    expect(
      chemistry.graph.atoms.filter((a) => !isHydrogenElement(a.element)),
    ).toHaveLength(9);
    expect(
      chemistry.graph.bonds.filter((b) => b.order === "AROM"),
    ).toHaveLength(6);
    expect(
      chemistry.graph.bonds.find((b) => b.a === "C" && b.b === "N1"),
    ).toMatchObject({ order: "DOUB", stereo: "E" });
    expect(
      chemistry.graph.bonds.find((b) => b.a === "C" && b.b === "N2"),
    ).toMatchObject({ order: "SING", stereo: "N" });
    expect(chemistry.graph.atoms.every((a) => a.charge === 0)).toBe(true);
    const embedded = chemicalGraph(p.frame, "BEN");
    expect(embedded.status).toBe("incomplete");
    if (embedded.status === "not_evaluated") throw Error(embedded.reason);
    expect(embedded.graph.atoms.every((a) => a.charge === null)).toBe(true);
    expect(chemicalGraphConflict(embedded.graph, chemistry.graph)).toBeNull();
  });
  it.each([
    [
      "unknown stereo",
      "BEN C1   C1   C 0 1 Y N N",
      "BEN C1   C1   C 0 1 Y N X",
      "unsupported_stereo",
    ],
    [
      "invalid charge",
      "BEN C1   C1   C 0",
      "BEN C1   C1   C banana",
      "invalid_chemistry",
    ],
    [
      "unknown element",
      "BEN C1   C1   C 0",
      "BEN C1   C1   Xx 0",
      "invalid_chemistry",
    ],
    [
      "unsafe numeric charge",
      "BEN C1   C1   C 0",
      "BEN C1   C1   C 9007199254740992",
      "invalid_chemistry",
    ],
    [
      "unsupported order",
      "BEN C1 C2   DOUB",
      "BEN C1 C2   QUAD",
      "invalid_chemistry",
    ],
    [
      "aromatic contradiction",
      "BEN C1 C2   DOUB Y",
      "BEN C1 C2   TRIP Y",
      "invalid_chemistry",
    ],
    [
      "stereo on single bond",
      "BEN C  N2   SING N N",
      "BEN C  N2   SING N E",
      "unsupported_stereo",
    ],
  ])(
    "rejects %s without dropping its constraints",
    async (_label, from, to, code) => {
      const text = new TextDecoder().decode(chemistry.bytes);
      expect(text).toContain(from);
      expect(
        chemicalGraph(
          await poseCifFrame(new TextEncoder().encode(text.replace(from, to))),
          "BEN",
        ),
      ).toMatchObject({ status: "not_evaluated", code });
    },
  );
  it("keeps unknown stereo distinct from none and detects atom, bond and stereo conflicts", async () => {
    const text = new TextDecoder()
      .decode(chemistry.bytes)
      .replace("BEN C1   C1   C 0 1 Y N N", "BEN C1   C1   C 0 1 Y N ?");
    expect(
      chemicalGraph(await poseCifFrame(new TextEncoder().encode(text)), "BEN")
        .status,
    ).toBe("incomplete");
    for (const edit of [
      (g: PoseChemistry["graph"]) => {
        g.atoms[0].charge = 1;
      },
      (g: PoseChemistry["graph"]) => {
        g.atoms[0].stereo = "R";
      },
      (g: PoseChemistry["graph"]) => {
        g.bonds[0].order = "TRIP";
      },
    ]) {
      const g = structuredClone(chemistry.graph);
      edit(g);
      expect(chemicalGraphConflict(g, chemistry.graph)).toMatch(/Conflicting/);
    }
    const g = structuredClone(chemistry.graph);
    for (const b of g.bonds)
      if (b.order === "AROM")
        b.sourceOrder = b.sourceOrder === "DOUB" ? "SING" : "DOUB";
    expect(poseGraphIdentity(g)).toBe(poseGraphIdentity(chemistry.graph));
  });
  it("leaves a missing bond order incomplete instead of inferring it", async () => {
    const text = new TextDecoder()
      .decode(chemistry.bytes)
      .replace("BEN C  N1   DOUB", "BEN C  N1   ?");
    const graph = chemicalGraph(
      await poseCifFrame(new TextEncoder().encode(text)),
      "BEN",
    );
    expect(graph.status).toBe("incomplete");
    if (graph.status === "not_evaluated") throw Error(graph.reason);
    expect(
      graph.graph.bonds.find((b) => b.a === "C" && b.b === "N1"),
    ).toMatchObject({ sourceOrder: null, order: null, stereo: "E" });
    expect(chemicalGraphConflict(graph.graph, chemistry.graph)).toBeNull();
  });
});

describe("pose eligibility, independent of interaction analysis", () => {
  it("prepares nine BEN heavy atoms from 3PTB/1S0R and BinaryCIF without mutating input", async () => {
    for (const f of [
      p,
      await poseFixture("tests/fixtures/biology/1S0R.cif.gz"),
      await poseFixture("tests/fixtures/3PTB.bcif"),
    ]) {
      const before = f.snapshot.atomBuffer.positions.slice();
      const ligand = prepared(
        preparePoseLigand(f.snapshot, [f.residue.id], chemistry, f.attachment),
      );
      expect(ligand.atomNames).toEqual([
        "C",
        "C1",
        "C2",
        "C3",
        "C4",
        "C5",
        "C6",
        "N1",
        "N2",
      ]);
      expect(ligand.positions).toHaveLength(27);
      expect(ligand.conformerId).toBeNull();
      expect(ligand.minimumOccupancy).toBe(0);
      ligand.positions[0] = 123456;
      ligand.graph.atoms[0].charge = 9;
      expect(f.snapshot.atomBuffer.positions).toEqual(before);
      expect(chemistry.graph.atoms[0].charge).toBe(0);
    }
  });
  it.each([0, -1, NaN, Infinity])(
    "reports incomplete at excluded occupancy %s",
    (occupancy) => {
      const c = copy();
      c.snapshot.atomBuffer.occupancies[first()] = occupancy;
      expect(prepare(c)).toMatchObject({
        status: "not_evaluated",
        code: "incomplete_ligand",
      });
    },
  );
  it("uses a strict minimum occupancy cutoff and validates its range", () => {
    const c = copy();
    c.snapshot.atomBuffer.occupancies[first()] = 0.5;
    expect(prepare(c, { minimumOccupancy: 0.49 }).status).toBe("prepared");
    expect(prepare(c, { minimumOccupancy: 0.5 })).toMatchObject({
      code: "incomplete_ligand",
    });
    for (const minimumOccupancy of [-1, 2, NaN])
      expect(prepare(c, { minimumOccupancy })).toMatchObject({
        code: "invalid_occupancy_policy",
      });
  });
  it("requires an explicit coherent conformer and refuses a mixed incomplete choice", () => {
    const c = copy(),
      ids = p.residue.atomIndices;
    c.snapshot.atoms[ids[0]].altId = "A";
    c.snapshot.atoms[ids[1]].altId = "B";
    expect(prepare(c)).toMatchObject({ code: "conformer_required" });
    expect(prepare(c, { conformerId: "C" })).toMatchObject({
      code: "invalid_conformer",
    });
    expect(prepare(c, { conformerId: "A" })).toMatchObject({
      code: "incomplete_ligand",
    });
    c.snapshot.atoms[ids[1]].altId = "A";
    expect(prepare(c, { conformerId: "A" }).status).toBe("prepared");
    expect(prepare(copy(), { conformerId: "A" })).toMatchObject({
      code: "invalid_conformer",
    });
  });
  it("refuses missing/duplicate/mismatched atoms and non-finite coordinates", () => {
    let c = copy();
    c.snapshot.residues.find((r) => r.id === p.residue.id)!.atomIndices.pop();
    expect(prepare(c)).toMatchObject({ code: "incomplete_ligand" });
    c = copy();
    c.snapshot.residues
      .find((r) => r.id === p.residue.id)!
      .atomIndices.push(first());
    expect(prepare(c)).toMatchObject({ code: "duplicate_atom" });
    for (const patch of [
      { name: "UNKNOWN" },
      { element: "O" },
      { formalCharge: 1 },
    ]) {
      c = copy();
      Object.assign(c.snapshot.atoms[first()], patch);
      expect(prepare(c)).toMatchObject({ code: "atom_mismatch" });
    }
    c = copy();
    c.snapshot.atomBuffer.positions[first() * 3] = NaN;
    expect(prepare(c)).toMatchObject({ code: "nonfinite_coordinates" });
  });
  it("excludes H/D/T by element and refuses groups, ions, stale context and uncertain chemistry", () => {
    for (const element of ["H", "D", "T"]) {
      const c = copy();
      const i = c.snapshot.atoms.findIndex(
        (a) => !p.residue.atomIndices.includes(c.snapshot.atoms.indexOf(a)),
      );
      c.snapshot.residues
        .find((r) => r.id === p.residue.id)!
        .atomIndices.push(i);
      c.snapshot.atoms[i].element = element;
      c.snapshot.atoms[i].name = "SYNTHETIC-ISOTOPE";
      expect(prepare(c).status).toBe("prepared");
      c.snapshot.atoms[i].altId = "A";
      expect(prepare(c)).toMatchObject({ code: "conformer_required" });
      expect(prepare(c, { conformerId: "A" }).status).toBe("prepared");
    }
    expect(
      preparePoseLigand(
        p.snapshot,
        [p.residue.id, p.residue.id],
        chemistry,
        p.attachment,
      ),
    ).toMatchObject({ code: "ligand_group" });
    const c = copy();
    c.snapshot.residues.find((r) => r.id === p.residue.id)!.kind = "ion";
    expect(prepare(c)).toMatchObject({ code: "unsupported_ligand" });
    expect(
      prepare({
        ...copy(),
        attachment: { ...p.attachment, snapshotId: "old" },
      }),
    ).toMatchObject({ code: "source_mismatch" });
    const unknown = copy();
    unknown.chemistry.graph.atoms[0].stereo = null;
    expect(prepare(unknown)).toMatchObject({ code: "missing_chemistry" });
  });
  it("refuses chemistry above the heavy-atom policy bound before calculation", () => {
    const c = copy();
    c.chemistry.graph.atoms = Array.from({ length: 257 }, (_, i) => ({
      ...chemistry.graph.atoms[0],
      name: `C${i}`,
    }));
    expect(prepare(c)).toMatchObject({ code: "atom_limit" });
  });
  it("detects the actual 5P9J covalent attachment and HEM metal content", async () => {
    const covalent = await poseFixture(
      "tests/fixtures/reference-set/5P9J.cif.gz",
      "8E8",
    );
    expect(covalent.attachment.status).toBe("covalent");
    const heme = await poseFixture("public/structures/4HHB.cif", "HEM");
    const g = chemicalGraph(heme.frame, "HEM");
    expect(g.status).not.toBe("not_evaluated");
    if (g.status === "not_evaluated") throw Error(g.reason);
    expect(g.graph.containsMetal).toBe(true);
    expect(
      preparePoseLigand(
        heme.snapshot,
        [heme.residue.id],
        { ...chemistry, componentId: "HEM", graph: g.graph },
        heme.attachment,
      ),
    ).toMatchObject({ code: "metal_containing" });
  });
  it("treats incomplete attachment identifiers conservatively and honors insertion codes", async () => {
    // Synthetic struct_conn rows attached to the frozen source; no coordinate geometry is used.
    const chain = p.snapshot.chains.find((c) => c.id === p.residue.chainId)!;
    const text = new TextDecoder()
      .decode(p.source.bytes)
      .replace(/loop_\s+_struct_conn\.[\s\S]*?(?=#)/, "");
    const conn = `\nloop_\n_struct_conn.id\n_struct_conn.conn_type_id\n_struct_conn.ptnr1_label_asym_id\n_struct_conn.ptnr1_auth_seq_id\n_struct_conn.pdbx_ptnr1_PDB_ins_code\n_struct_conn.ptnr2_label_asym_id\n_struct_conn.ptnr2_auth_seq_id\nX covale ${chain.labelAsymId} ${p.residue.authSeqId} ? OTHER 99\n#\n`;
    expect(
      poseAttachment(
        await poseCifFrame(new TextEncoder().encode(text + conn)),
        p.snapshot,
        p.residue.id,
      ).status,
    ).toBe("covalent");
    const incomplete = conn.replace(
      `${chain.labelAsymId} ${p.residue.authSeqId}`,
      `${chain.labelAsymId} ?`,
    );
    expect(
      poseAttachment(
        await poseCifFrame(new TextEncoder().encode(text + incomplete)),
        p.snapshot,
        p.residue.id,
      ).status,
    ).toBe("unknown");
    const otherInsertion = conn.replace(
      `${p.residue.authSeqId} ? OTHER`,
      `${p.residue.authSeqId} A OTHER`,
    );
    expect(
      poseAttachment(
        await poseCifFrame(new TextEncoder().encode(text + otherInsertion)),
        p.snapshot,
        p.residue.id,
      ).status,
    ).toBe("no_recorded_link");
    const internal = conn.replace(
      "OTHER 99",
      `${chain.labelAsymId} ${p.residue.authSeqId}`,
    );
    expect(
      poseAttachment(
        await poseCifFrame(new TextEncoder().encode(text + internal)),
        p.snapshot,
        p.residue.id,
      ).status,
    ).toBe("unknown");
    const knownSymmetry = internal
      .replace(
        "X covale",
        "_struct_conn.ptnr1_symmetry\n_struct_conn.ptnr2_symmetry\nX covale",
      )
      .replace(/\n#\n$/, " 1_555 1_555\n#\n");
    expect(
      poseAttachment(
        await poseCifFrame(new TextEncoder().encode(text + knownSymmetry)),
        p.snapshot,
        p.residue.id,
      ).status,
    ).toBe("no_recorded_link");
  });
});

describe("pose input identity and fixed protein frame", () => {
  it("keys every pose/fit input and leaves coordinates in their deposited assembly frame", async () => {
    const a = prepared(prepare());
    const make = (b = a, f = fit, key = "protein-fit-inputs") =>
      preparePoseInput(a, b, f, key);
    const result = await make();
    if (result.status !== "prepared") throw Error(result.reason);
    expect(result.input.reference.positions).toEqual(a.positions);
    const keys = new Set([result.input.inputKey]);
    for (const patch of [
      { minimumOccupancy: 0.1 },
      { conformerId: "A" },
      { sourceHash: "changed" },
      { snapshotId: "model2" },
      { chemistryHash: "revision2" },
    ]) {
      const next = await make({ ...a, ...patch });
      if (next.status !== "prepared") throw Error(next.reason);
      keys.add(next.input.inputKey);
    }
    for (const [f, key] of [
      [{ ...fit, scope: "binding_site" as const }, "protein-fit-inputs"],
      [fit, "different-fit-inputs"],
      [
        { ...fit, transform: fit.transform.map((v, i) => (i === 12 ? 10 : v)) },
        "protein-fit-inputs",
      ],
    ] as const) {
      const next = await make(a, f, key);
      if (next.status !== "prepared") throw Error(next.reason);
      keys.add(next.input.inputKey);
    }
    expect(keys.size).toBe(9);
    expect(await preparePoseInput(a, a, null, "none")).toMatchObject({
      code: "missing_fit",
    });
    for (const t of [
      fit.transform.map((v, i) => (i === 0 ? -1 : v)),
      fit.transform.map((v, i) => (i === 0 ? 2 : v)),
      [NaN],
    ])
      expect(await make(a, { ...fit, transform: t })).toMatchObject({
        code: "invalid_transform",
      });
    expect(await make({ ...a, componentId: "OTHER" })).toMatchObject({
      code: "different_component",
    });
    expect(await make({ ...a, graphHash: "other" })).toMatchObject({
      code: "chemistry_conflict",
    });
  });
});
