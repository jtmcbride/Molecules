import { ENGINE_VERSION, RULESET_VERSION } from "../domain/analysis";
import type { PoseChemistry } from "../domain/ligandPose";
import {
  LIGAND_POSE_VERSION,
  POSE_ALGORITHM_VERSION,
} from "../domain/ligandPose";
import { BIOLOGY_VERSION } from "../domain/biology";
import {
  COMPARISON_VERSION,
  FINGERPRINT_MARGIN_ANGSTROM,
  type Correspondence,
  type FingerprintMatrix,
  type SiteDifferences,
} from "../domain/comparison";
import type { StructureSnapshot, StructureSource } from "../domain/types";
import type { ComparisonSlot } from "../state/comparison";
import { SUPERPOSITION_POLICY } from "./superposition";
import { SITE_POLICY } from "./siteDifferences";

const csv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

interface ReferenceExport {
  source: StructureSource;
  snapshot: StructureSnapshot;
  analysisCacheKey?: string;
  interpretationId?: string;
}

/** Residue label "ASP 189" in the structure's own author numbering. */
function residueLabel(snapshot: StructureSnapshot, id?: string) {
  const r = id ? snapshot.residues.find((x) => x.id === id) : undefined;
  return r
    ? `${r.componentId} ${r.authSeqId ?? "?"}${r.insertionCode ?? ""}`
    : "";
}

/**
 * Comparison JSON (schema 2): every structure's identity and pinned inputs, chain pairings
 * and residue correspondence, superpositions with their policy, and the fingerprint matrix.
 * Whole structures are identified by SHA-256; optional pose records include eligible coordinates.
 */
export function comparisonJson(
  reference: ReferenceExport,
  slots: ComparisonSlot[],
  correspondences: Map<string, Correspondence | null>,
  matrix: FingerprintMatrix | null,
  sites: Map<string, SiteDifferences | null> = new Map(),
  chemistry: Map<string, PoseChemistry> = new Map(),
) {
  const structure = (source: StructureSource, snapshot: StructureSnapshot) => ({
    id: source.id,
    name: source.name,
    kind: source.kind,
    sourceSha256: source.contentHash,
    snapshotId: snapshot.id,
    model: snapshot.modelNumber,
    assembly: snapshot.assemblyId || "asymmetric-unit",
    coordinateErrorAngstrom: snapshot.quality?.coordinateErrorAngstrom,
  });
  return JSON.stringify(
    {
      schemaVersion: 2,
      comparisonVersion: COMPARISON_VERSION,
      ligandPoseVersion: LIGAND_POSE_VERSION,
      poseAlgorithmVersion: POSE_ALGORITHM_VERSION,
      engineVersion: ENGINE_VERSION,
      ruleSetVersion: RULESET_VERSION,
      biologyVersion: BIOLOGY_VERSION,
      generatedAt: new Date().toISOString(),
      policies: {
        correspondence:
          "SIFTS exact mapping only: observed residues at the same UniProt position in paired chains.",
        superposition: SUPERPOSITION_POLICY,
        bindingSite: SITE_POLICY,
        fingerprintMarginAngstrom: FINGERPRINT_MARGIN_ANGSTROM,
      },
      reference: {
        ...structure(reference.source, reference.snapshot),
        analysisCacheKey: reference.analysisCacheKey,
        interpretationId: reference.interpretationId,
      },
      structures: slots
        .filter((s) => s.phase === "ready" && s.source && s.snapshot)
        .map((s) => {
          const corr = correspondences.get(s.id) ?? null;
          return {
            slotId: s.id,
            ...structure(s.source!, s.snapshot!),
            analysisCacheKey: s.analysis?.cacheKey,
            interpretationId: s.interpretation?.id,
            ligand: s.ligandGroupId
              ? `group:${s.ligandGroupId}`
              : s.targetLigandId,
            correspondence: corr && {
              sharedAccessions: corr.sharedAccessions,
              pairings: corr.pairings,
              unpairedReferenceChains: corr.unpairedReferenceChains,
              unpairedComparisonChains: corr.unpairedComparisonChains,
              counts: corr.counts,
              pairs: corr.pairs.map((p) => ({
                ...p,
                referenceResidue: residueLabel(
                  reference.snapshot,
                  p.referenceResidueId,
                ),
                comparisonResidue: residueLabel(
                  s.snapshot!,
                  p.comparisonResidueId,
                ),
              })),
            },
            superposition: s.superposition ?? { scope: s.superpositionScope },
            bindingSiteDifferences: sites.get(s.id) ?? null,
            ...(s.pose
              ? {
                  pose: {
                    options: s.pose.options,
                    ...(s.pose.phase === "ready" && s.pose.record
                      ? {
                          input: s.pose.record.input,
                          result: s.pose.record.result,
                          createdAt: s.pose.record.createdAt,
                          chemistry: [
                            s.pose.record.input.reference.chemistryId,
                            s.pose.record.input.comparison.chemistryId,
                          ].map((id) => {
                            const source = chemistry.get(id);
                            if (!source) return { id, available: false };
                            const {
                              bytes: _,
                              graph: __,
                              ...provenance
                            } = source;
                            return { ...provenance, available: true };
                          }),
                        }
                      : {
                          result: s.pose.result,
                          operation: s.pose.phase,
                          message: s.pose.message,
                        }),
                  },
                }
              : {}),
          };
        }),
      fingerprint: matrix,
    },
    (_key, value) =>
      value instanceof Float64Array ? Array.from(value) : value,
    2,
  );
}

/** One line per fingerprint row and structure. */
export function fingerprintCsv(
  matrix: FingerprintMatrix,
  reference: StructureSnapshot,
) {
  const residues = new Map<string, string>();
  const lines: unknown[][] = [
    [
      "row_kind",
      "reference_chain",
      "uniprot_accession",
      "uniprot_position",
      "component_id",
      "interaction_type",
      "structure",
      "structure_ligand",
      "cell",
      "refusal",
      "present_margin_angstrom",
      "absent_excess_angstrom",
      "marginal_change",
    ],
  ];
  for (const row of matrix.rows)
    row.cells.forEach((cell, c) => {
      const column = matrix.columns[c],
        change = row.changes?.find((x) => x.column === c);
      if (row.referenceChainId && !residues.has(row.referenceChainId))
        residues.set(
          row.referenceChainId,
          reference.chains.find((x) => x.id === row.referenceChainId)
            ?.authAsymId ?? "",
        );
      lines.push([
        row.kind,
        row.referenceChainId ? residues.get(row.referenceChainId) : "",
        row.accession,
        row.uniprotPosition,
        row.componentId,
        row.type,
        column.label,
        column.ligandLabel,
        cell,
        column.refusal,
        change?.presentMarginAngstrom?.toFixed(3),
        change?.absentExcessAngstrom?.toFixed(3),
        change ? change.marginal : "",
      ]);
    });
  return lines.map((l) => l.map(csv).join(",")).join("\n");
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
