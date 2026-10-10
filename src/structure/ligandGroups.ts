import type { Model } from "molstar/lib/mol-model/structure";
import { MmcifFormat } from "molstar/lib/mol-model-formats/structure/mmcif";
import type { LigandGroup, StructureSnapshot } from "../domain/types";
import { identity } from "../domain/identity";

/**
 * Multi-residue ligands that should be analyzed as one unit, per assembly chain instance:
 * - branched: all residues of a branched-entity chain instance (glycans);
 * - bird: residues of an asym listed in pdbx_molecule (BIRD/PRD molecules);
 * - covalent: non-polymer residues joined by covale struct_conn records (union-find).
 * Single residues remain selectable on their own.
 */
export function ligandGroups(
  snapshot: Pick<StructureSnapshot, "chains" | "residues" | "ligands">,
  model: Model,
): LigandGroup[] {
  const residues = new Map(snapshot.residues.map((r) => [r.id, r]));
  const ligandIds = new Set(snapshot.ligands.map((l) => l.residueId));
  const groups: LigandGroup[] = [];
  const label = (ids: string[]) => {
    const first = residues.get(ids[0])!,
      chain = snapshot.chains.find((c) => c.id === first.chainId)!;
    const names = ids.map((id) => residues.get(id)!.componentId);
    return `${names.slice(0, 4).join("–")}${names.length > 4 ? "…" : ""} ${chain.authAsymId}:${first.authSeqId ?? "?"} (${ids.length} residues)`;
  };
  const add = (kind: LigandGroup["kind"], ids: string[]) => {
    if (ids.length < 2) return;
    const sorted = [...ids].sort(
      (a, b) =>
        residues.get(a)!.sourceResidueIndex -
        residues.get(b)!.sourceResidueIndex,
    );
    groups.push({
      id: identity("ligand-group", kind, ...sorted),
      kind,
      residueIds: sorted,
      label: label(sorted),
    });
  };
  // Branched entities: one group per chain instance.
  for (const chain of snapshot.chains)
    if (chain.type === "branched")
      add(
        "branched",
        chain.residueIds.filter((id) => ligandIds.has(id)),
      );
  if (!MmcifFormat.is(model.sourceData)) return groups;
  const categories = model.sourceData.data.frame.categories;
  // BIRD molecules: all ligand residues in the listed asym IDs.
  const prd = categories.pdbx_molecule;
  const birdAsyms = new Set<string>();
  if (prd) {
    const asym = prd.getField("asym_id");
    for (let i = 0; asym && i < asym.rowCount; i++) birdAsyms.add(asym.str(i));
  }
  for (const chain of snapshot.chains)
    if (chain.type !== "branched" && birdAsyms.has(chain.labelAsymId))
      add(
        "bird",
        chain.residueIds.filter((id) => ligandIds.has(id)),
      );
  // Covalently linked non-polymer residues, per operator instance.
  const conn = categories.struct_conn;
  if (!conn) return groups;
  const field = (name: string) => conn.getField(name);
  const type = field("conn_type_id"),
    a1 = field("ptnr1_label_asym_id"),
    s1 = field("ptnr1_auth_seq_id"),
    c1 = field("ptnr1_label_comp_id"),
    a2 = field("ptnr2_label_asym_id"),
    s2 = field("ptnr2_auth_seq_id"),
    c2 = field("ptnr2_label_comp_id");
  if (!type || !a1 || !s1 || !c1 || !a2 || !s2 || !c2) return groups;
  const grouped = new Set(groups.flatMap((g) => g.residueIds));
  for (const operator of new Set(snapshot.chains.map((c) => c.operatorId))) {
    const find = (asym: string, seq: string, comp: string) =>
      snapshot.residues.find((r) => {
        if (
          !ligandIds.has(r.id) ||
          r.componentId !== comp ||
          r.authSeqId !== seq
        )
          return false;
        const chain = snapshot.chains.find((c) => c.id === r.chainId)!;
        return chain.labelAsymId === asym && chain.operatorId === operator;
      });
    const parent = new Map<string, string>();
    const root = (x: string): string =>
      parent.get(x) === x ? x : root(parent.get(x)!);
    for (let i = 0; i < type.rowCount; i++) {
      if (type.str(i) !== "covale") continue;
      const x = find(a1.str(i), s1.str(i), c1.str(i)),
        y = find(a2.str(i), s2.str(i), c2.str(i));
      if (!x || !y || x.id === y.id || grouped.has(x.id) || grouped.has(y.id))
        continue;
      for (const r of [x, y]) if (!parent.has(r.id)) parent.set(r.id, r.id);
      parent.set(root(x.id), root(y.id));
    }
    const sets = new Map<string, string[]>();
    for (const id of parent.keys())
      sets.set(root(id), [...(sets.get(root(id)) ?? []), id]);
    for (const ids of sets.values()) add("covalent", ids);
  }
  return groups;
}
