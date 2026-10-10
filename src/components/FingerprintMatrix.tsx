import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { INTERACTION_LABELS } from "../domain/analysis";
import type { FingerprintCell, FingerprintRow } from "../domain/comparison";
import {
  comparisonFingerprint,
  slotCorrespondence,
} from "../comparison/derived";
import { comparisonJson, download, fingerprintCsv } from "../comparison/export";
import { useComparison } from "../state/comparison";
import { useExplorer } from "../state/explorer";

const CELL: Record<FingerprintCell, { symbol: string; label: string }> = {
  present: { symbol: "●", label: "present" },
  absent: { symbol: "○", label: "absent" },
  not_evaluated: { symbol: "–", label: "not evaluated" },
  not_observed: { symbol: "·", label: "not observed" },
  not_comparable: { symbol: "?", label: "not comparable" },
};

/** Interaction fingerprints of the reference and comparison structures by UniProt position. */
export function FingerprintMatrix() {
  const snapshot = useExplorer((s) => s.snapshot),
    source = useExplorer((s) => s.source),
    analysis = useExplorer((s) => s.analysis),
    interpretation = useExplorer((s) => s.interpretation),
    slots = useComparison((s) => s.slots);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const reference = useMemo(
    () => ({ snapshot, source, analysis, interpretation }),
    [snapshot, source, analysis, interpretation],
  );
  const result = useMemo(
    () => comparisonFingerprint(reference, slots),
    [reference, slots],
  );
  // Reference residue at each (chain, accession, UniProt position), for row labels.
  const residueAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of interpretation?.mappings ?? [])
      if (m.status === "exact" && m.residueId) {
        const r = snapshot?.residues.find((x) => x.id === m.residueId);
        if (r)
          map.set(
            JSON.stringify([m.chainInstanceId, m.accession, m.uniprotPosition]),
            `${r.componentId} ${r.authSeqId ?? "?"}${r.insertionCode ?? ""}`,
          );
      }
    return map;
  }, [interpretation, snapshot]);
  if (!slots.length) return null;
  if ("reason" in result)
    return (
      <div className="fingerprint" data-testid="fingerprint">
        <h3>Interaction fingerprints</h3>
        <p className="small muted">{result.reason}</p>
      </div>
    );
  const { matrix } = result;
  const chain = (id?: string) =>
    snapshot?.chains.find((c) => c.id === id)?.authAsymId ?? "?";
  const rowLabel = (row: FingerprintRow) =>
    row.kind === "component"
      ? `${row.componentId} (receptor component)`
      : `${chain(row.referenceChainId)} · ${row.uniprotPosition} · ${
          residueAt.get(
            JSON.stringify([
              row.referenceChainId,
              row.accession,
              row.uniprotPosition,
            ]),
          ) ?? "unobserved"
        }`;
  const rows = onlyChanges ? matrix.rows.filter((r) => r.changes) : matrix.rows;
  const exportJson = () => {
    if (!snapshot || !source) return;
    const correspondences = new Map(
      slots.map((s) => [s.id, slotCorrespondence(reference, s)]),
    );
    download(
      `${source.id.replace(/[^a-z0-9_-]/gi, "_")}-comparison.json`,
      comparisonJson(
        {
          source,
          snapshot,
          analysisCacheKey: analysis?.cacheKey,
          interpretationId: interpretation?.id,
        },
        slots,
        correspondences,
        matrix,
      ),
      "application/json",
    );
  };
  return (
    <div className="fingerprint" data-testid="fingerprint">
      <div className="fingerprint-heading">
        <h3>Interaction fingerprints</h3>
        <label className="fingerprint-toggle">
          <input
            type="checkbox"
            checked={onlyChanges}
            onChange={(e) => setOnlyChanges(e.target.checked)}
          />
          Only gained or lost
        </label>
      </div>
      <p className="small muted">
        Rows are UniProt positions of the reference chains (reference author
        numbering in the label) and interaction types. Only ● and ○ are
        measurements; ≈ marks a change within 0.5 Å of the cutoff.
      </p>
      <div className="fingerprint-scroll">
        <table className="fingerprint-table">
          <thead>
            <tr>
              <th scope="col">Position · type</th>
              {matrix.columns.map((c, i) => (
                <th
                  key={c.id}
                  scope="col"
                  title={c.refusal}
                  data-testid="fingerprint-column"
                >
                  <span className="fingerprint-structure">
                    {i === 0 ? `${c.label} (reference)` : c.label}
                  </span>
                  <small>{c.ligandLabel ?? ""}</small>
                  <small>
                    {c.refusal
                      ? c.refusal
                      : c.similarity
                        ? c.similarity.tanimoto === null
                          ? "no measured contacts"
                          : `Tanimoto ${c.similarity.tanimoto.toFixed(2)} · +${c.similarity.gained} −${c.similarity.lost}`
                        : ""}
                  </small>
                  {c.unplacedInteractions > 0 && (
                    <small>{c.unplacedInteractions} unplaced</small>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {rowLabel(row)}
                  <span className="fingerprint-type">
                    {INTERACTION_LABELS[row.type]}
                  </span>
                </th>
                {row.cells.map((cell, c) => {
                  const change = row.changes?.find((x) => x.column === c);
                  return (
                    <td
                      key={matrix.columns[c].id}
                      className={`fingerprint-cell ${cell}`}
                      aria-label={`${CELL[cell].label}${change?.marginal ? ", near cutoff" : ""}`}
                      title={`${CELL[cell].label}${
                        change
                          ? `${change.presentMarginAngstrom !== undefined ? ` · present ${change.presentMarginAngstrom.toFixed(2)} Å inside cutoff` : ""}${change.absentExcessAngstrom !== undefined ? ` · closest candidate atoms ${change.absentExcessAngstrom.toFixed(2)} Å beyond cutoff` : ""}`
                          : ""
                      }`}
                    >
                      {CELL[cell].symbol}
                      {change?.marginal ? "≈" : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fingerprint-legend small muted">
        ● present · ○ absent · – not evaluated · · not observed · ? not
        comparable
      </p>
      <div className="fingerprint-exports">
        <button className="button secondary" onClick={exportJson}>
          <Download size={13} /> Comparison JSON
        </button>
        <button
          className="button secondary"
          onClick={() =>
            snapshot &&
            source &&
            download(
              `${source.id.replace(/[^a-z0-9_-]/gi, "_")}-fingerprints.csv`,
              fingerprintCsv(matrix, snapshot),
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={13} /> Fingerprint CSV
        </button>
      </div>
    </div>
  );
}
