import { slotCorrespondence } from "../comparison/derived";
import type { StructureSnapshot } from "../domain/types";
import { useExplorer } from "../state/explorer";
import type { ComparisonSlot } from "../state/comparison";
import type { ExplorerController } from "../structure/controller";

const BASIS: Record<string, string> = {
  user: "your choice",
  same_author_chain: "same author chain",
  chain_order: "chain order",
};

/** Author chain ID, with the assembly operator when another chain instance shares the ID. */
export function chainName(snapshot: StructureSnapshot, id: string) {
  const chain = snapshot.chains.find((c) => c.id === id);
  if (!chain) return "?";
  const shared = snapshot.chains.some(
    (c) =>
      c.id !== id && c.type === chain.type && c.authAsymId === chain.authAsymId,
  );
  return shared
    ? `${chain.authAsymId} (${chain.operatorId})`
    : chain.authAsymId;
}

/** Chain pairings and residue correspondence of one comparison structure. */
export function CorrespondenceSummary({
  slot,
  controller,
}: {
  slot: ComparisonSlot;
  controller: ExplorerController | null;
}) {
  const reference = {
    snapshot: useExplorer((s) => s.snapshot),
    interpretation: useExplorer((s) => s.interpretation),
  };
  const biologyPhase = useExplorer((s) => s.biologyPhase);
  if (!reference.snapshot || !slot.snapshot) return null;
  if (!reference.interpretation)
    return (
      <p className="small muted" data-testid="comparison-correspondence">
        {biologyPhase === "loading"
          ? "Waiting for the reference residue mapping."
          : "Load the reference's protein annotations to pair residues by UniProt position."}
      </p>
    );
  const result = slotCorrespondence(reference, slot);
  if (!result) return null;
  const refSnapshot = reference.snapshot,
    cmpSnapshot = slot.snapshot;
  if (!result.sharedAccessions.length)
    return (
      <p className="comparison-warning" data-testid="comparison-correspondence">
        No UniProt accession is shared with the reference, so no residues can be
        paired.
      </p>
    );
  const changes = result.pairs.filter((p) => p.residueChange);
  // Comparison chains that can partner each reference chain, per accession.
  const options = (accession: string) =>
    cmpSnapshot.chains.filter(
      (c) =>
        c.type === "polymer" &&
        slot.interpretation?.coverage.some(
          (cov) =>
            cov.chainInstanceId === c.id && cov.accessions.includes(accession),
        ),
    );
  const referenceChains = (accession: string) =>
    refSnapshot.chains.filter(
      (c) =>
        c.type === "polymer" &&
        reference.interpretation?.coverage.some(
          (cov) =>
            cov.chainInstanceId === c.id && cov.accessions.includes(accession),
        ),
    );
  return (
    <div
      className="comparison-correspondence"
      data-testid="comparison-correspondence"
    >
      <table className="comparison-pairings">
        <thead>
          <tr>
            <th>UniProt</th>
            <th>Reference</th>
            <th>Comparison</th>
            <th>Basis</th>
          </tr>
        </thead>
        <tbody>
          {result.sharedAccessions.flatMap((accession) =>
            referenceChains(accession).map((chain) => {
              const pairing = result.pairings.find(
                (p) =>
                  p.accession === accession && p.referenceChainId === chain.id,
              );
              const refName = chainName(refSnapshot, chain.id);
              return (
                <tr key={`${accession}:${chain.id}`}>
                  <td>{accession}</td>
                  <td>{refName}</td>
                  <td>
                    <select
                      aria-label={`Partner of reference chain ${refName} (${accession}) in ${slot.label}`}
                      value={pairing?.comparisonChainId ?? ""}
                      onChange={(e) =>
                        controller?.comparison.setPairing(slot.id, {
                          accession,
                          referenceChainId: chain.id,
                          comparisonChainId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Unpaired</option>
                      {options(accession).map((c) => (
                        <option key={c.id} value={c.id}>
                          {chainName(cmpSnapshot, c.id)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{pairing ? BASIS[pairing.basis] : "—"}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      <p className="comparison-counts" data-testid="comparison-counts">
        {result.counts.paired} paired · {result.counts.reference_only} reference
        only · {result.counts.comparison_only} comparison only ·{" "}
        {result.counts.not_comparable} not comparable
        {slot.pairingOverrides.length > 0 && (
          <button
            className="link-button"
            onClick={() => controller?.comparison.resetPairings(slot.id)}
          >
            Reset pairings
          </button>
        )}
      </p>
      {changes.length > 0 && (
        <p className="small muted">
          Paired residues that differ:{" "}
          {changes
            .slice(0, 8)
            .map(
              (p) =>
                `${p.residueChange!.reference}${p.uniprotPosition}${p.residueChange!.comparison}`,
            )
            .join(", ")}
          {changes.length > 8 ? ` and ${changes.length - 8} more` : ""} (UniProt
          numbering, reference → comparison).
        </p>
      )}
      {result.unpairedComparisonChains.length > 0 && (
        <p className="small muted">
          Comparison chains without a partner:{" "}
          {result.unpairedComparisonChains
            .map((c) => chainName(cmpSnapshot, c.chainId))
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}
