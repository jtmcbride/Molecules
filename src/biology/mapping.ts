import type {
  ChainCoverage,
  MappingSegment,
  ProteinRecord,
  ResidueMapping,
  SiftsRow,
} from "../domain/biology";
import type { StructureSnapshot } from "../domain/types";
const CODES: Record<string, string> = {
  ALA: "A",
  ARG: "R",
  ASN: "N",
  ASP: "D",
  CYS: "C",
  GLN: "Q",
  GLU: "E",
  GLY: "G",
  HIS: "H",
  ILE: "I",
  LEU: "L",
  LYS: "K",
  MET: "M",
  PHE: "F",
  PRO: "P",
  SER: "S",
  THR: "T",
  TRP: "W",
  TYR: "Y",
  VAL: "V",
};
export function mapResidues(
  snapshot: StructureSnapshot,
  segments: MappingSegment[],
  rows: SiftsRow[],
  proteins: ProteinRecord[],
  evidenceIds: string[],
) {
  const mappings: ResidueMapping[] = [],
    coverage: ChainCoverage[] = [],
    qualityFlags: string[] = [];
  const residues = new Map(snapshot.residues.map((r) => [r.id, r]));
  const rowsByPosition = new Map<string, SiftsRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.authChain, row.pdbePosition]);
    if (!rowsByPosition.has(key)) rowsByPosition.set(key, []);
    rowsByPosition.get(key)!.push(row);
  }
  for (const chain of snapshot.chains.filter((c) => c.type === "polymer")) {
    const discoveries = segments.filter(
      (s) =>
        s.labelAsymId === chain.labelAsymId &&
        s.entityId === chain.entityId &&
        s.authChain === chain.authAsymId,
    );
    const report: ChainCoverage = {
      chainInstanceId: chain.id,
      total: chain.sequence.length,
      exact: 0,
      ambiguous: 0,
      unmapped: 0,
      accessions: [...new Set(discoveries.map((s) => s.accession))],
    };
    for (const position of chain.sequence) {
      const observed = position.residueIds
        .map((id) => residues.get(id)!)
        .filter(Boolean);
      const candidates = (
        rowsByPosition.get(
          JSON.stringify([chain.authAsymId, position.labelSeqId]),
        ) ?? []
      ).filter((row) => discoveries.some((s) => s.accession === row.accession));
      const unique = [
        ...new Map(
          candidates.map((row) => [
            JSON.stringify([
              row.accession,
              row.uniprotPosition,
              row.authNumber,
              row.componentId,
            ]),
            row,
          ]),
        ).values(),
      ];
      const results: ResidueMapping[] = [];
      for (const row of unique) {
        const protein = proteins.find((p) => p.accession === row.accession);
        if (!protein) continue;
        const validSegment = discoveries.some(
          (s) =>
            s.accession === row.accession &&
            position.labelSeqId >= s.start &&
            position.labelSeqId <= s.end &&
            row.uniprotPosition >= s.uniprotStart &&
            row.uniprotPosition <= s.uniprotEnd,
        );
        const component =
            snapshot.componentParentIds?.[position.componentId] ??
            position.componentId,
          code = CODES[component];
        const uniprotResidue = protein.sequence[row.uniprotPosition - 1];
        // The SIFTS row describes this deposited residue and this UniProt residue.
        const depositedAgrees =
          code !== undefined &&
          (row.componentId === position.componentId ||
            CODES[
              snapshot.componentParentIds?.[row.componentId] ?? row.componentId
            ] === code);
        const uniprotAgrees = uniprotResidue === row.uniprotResidue;
        // Residue identity is recorded separately from position correspondence. A
        // curated SIFTS annotation explains a difference; anything else stays unprojected.
        const identity: ResidueMapping["identity"] =
          depositedAgrees && uniprotAgrees && uniprotResidue === code
            ? "match"
            : depositedAgrees && uniprotAgrees
              ? row.annotations.includes("Engineered mutation")
                ? "engineered_mutation"
                : row.annotations.includes("Conflict")
                  ? "conflict"
                  : "unexplained_mismatch"
              : "unexplained_mismatch";
        const targets = observed.length ? observed : [undefined];
        for (const residue of targets) {
          const identityAgrees =
            !residue ||
            row.authNumber ===
              `${residue.authSeqId ?? ""}${residue.insertionCode ?? ""}`;
          const status: ResidueMapping["status"] =
            !validSegment || !identityAgrees || (residue && row.notObserved)
              ? "source_conflict"
              : identity === "unexplained_mismatch"
                ? "sequence_mismatch"
                : unique.length > 1 || observed.length > 1
                  ? "ambiguous"
                  : "exact";
          results.push({
            id: JSON.stringify([
              snapshot.id,
              chain.id,
              position.labelSeqId,
              residue?.id,
              protein.id,
              row.uniprotPosition,
            ]),
            snapshotId: snapshot.id,
            chainInstanceId: chain.id,
            residueId: residue?.id,
            labelSeqId: position.labelSeqId,
            authSeqId: residue?.authSeqId ?? row.authNumber,
            insertionCode: residue?.insertionCode ?? null,
            proteinId: protein.id,
            accession: protein.accession,
            uniprotPosition: row.uniprotPosition,
            status,
            identity,
            ...(identity === "match" || code === undefined
              ? {}
              : {
                  residueChange: {
                    uniprot: uniprotResidue ?? "?",
                    deposited: code,
                  },
                }),
            evidenceIds,
          });
        }
      }
      if (!results.length) report.unmapped++;
      else if (results.length === 1 && results[0].status === "exact")
        report.exact++;
      else report.ambiguous++;
      mappings.push(...results);
    }
    coverage.push(report);
    if (report.ambiguous)
      qualityFlags.push(
        `Chain ${chain.authAsymId} (${chain.operatorId}): ${report.ambiguous} positions have ambiguous, conflicting or mismatched correspondence.`,
      );
  }
  return { mappings, coverage, qualityFlags };
}
