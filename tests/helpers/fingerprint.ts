import { analyze } from "../../src/analysis/engine";
import { correspondence } from "../../src/comparison/correspondence";
import {
  buildFingerprint,
  type FingerprintMember,
} from "../../src/comparison/fingerprint";
import {
  DEFAULT_PARAMETERS,
  type AnalysisRun,
} from "../../src/domain/analysis";
import type { FingerprintType } from "../../src/domain/comparison";
import { comparisonSide } from "./comparison";

type Side = Awaited<ReturnType<typeof comparisonSide>>;

/** Default-parameter analysis of the first `component` instance in author chain `chain`. */
export function analyzeLigand(side: Side, component: string, chain = "A") {
  const chains = new Map(side.snapshot.chains.map((c) => [c.id, c]));
  const ligand = side.snapshot.ligands.find(
    (l) =>
      l.componentId === component &&
      chains.get(
        side.snapshot.residues.find((r) => r.id === l.residueId)!.chainId,
      )?.authAsymId === chain,
  )!;
  return analyze(
    side.structure,
    side.snapshot,
    side.selectionIndex,
    {
      ligandResidueId: ligand.residueId,
      receptorChainIds: side.snapshot.chains
        .filter((c) => c.type === "polymer")
        .map((c) => c.id),
      parameters: { ...DEFAULT_PARAMETERS },
    },
    [],
  );
}

/** Reference and comparison sides, their analyses and the fingerprint matrix. */
export async function fingerprintPair(
  ref: string,
  cmp: string,
  component: string,
) {
  const [a, b] = await Promise.all([comparisonSide(ref), comparisonSide(cmp)]);
  const [runA, runB] = await Promise.all([
    analyzeLigand(a, component),
    analyzeLigand(b, component),
  ]);
  const corr = correspondence(a.side, b.side);
  const build = (runs: { ref?: AnalysisRun; cmp?: AnalysisRun | null } = {}) =>
    buildFingerprint(
      {
        label: ref,
        snapshot: a.snapshot,
        run: runs.ref ?? runA,
        mappings: a.mappings,
      },
      [
        {
          id: cmp,
          label: cmp,
          snapshot: b.snapshot,
          run: runs.cmp === undefined ? runB : runs.cmp,
          correspondence: corr,
        } satisfies FingerprintMember,
      ],
    );
  return { a, b, runA, runB, corr, matrix: build(), build };
}

/** Row key of a fingerprint row restricted to (reference chain, position, type). */
export function rowKey(
  chainId: string,
  position: number,
  type: FingerprintType | string,
) {
  return JSON.stringify([chainId, position, type]);
}
