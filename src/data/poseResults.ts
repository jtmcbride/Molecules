import {
  LIGAND_POSE_VERSION,
  POSE_ALGORITHM_VERSION,
  type LigandPoseInput,
  type LigandPoseResult,
  type StoredLigandPose,
} from "../domain/ligandPose";
import { hashBytes } from "./provider";
import { database } from "./repository";
const encoded = (input: LigandPoseInput, result: LigandPoseResult) =>
  JSON.stringify({ input, result }, (_key, value) =>
    value instanceof Float64Array ? Array.from(value) : value,
  );
const digest = (input: LigandPoseInput, result: LigandPoseResult) =>
  hashBytes(new TextEncoder().encode(encoded(input, result)));
/** Immutable result revisions; a damaged record is never accepted as a cached score. */
export async function storedPose(
  key: string,
): Promise<StoredLigandPose | null> {
  try {
    const row = await database.ligandPoses.get(key);
    if (
      !row ||
      row.inputKey !== key ||
      row.input.inputKey !== key ||
      row.input.version !== LIGAND_POSE_VERSION ||
      row.input.algorithmVersion !== POSE_ALGORITHM_VERSION ||
      !row.contentHash ||
      row.contentHash !== (await digest(row.input, row.result)) ||
      row.result.status !== "evaluated" ||
      row.result.inputKey !== key ||
      row.result.version !== LIGAND_POSE_VERSION ||
      row.result.algorithmVersion !== POSE_ALGORITHM_VERSION
    )
      return null;
    return row;
  } catch {
    return null;
  }
}
export async function savePose(
  input: LigandPoseInput,
  result: LigandPoseResult,
): Promise<StoredLigandPose> {
  const row: StoredLigandPose = {
    inputKey: input.inputKey,
    input,
    result,
    createdAt: new Date().toISOString(),
    contentHash: await digest(input, result),
  };
  const valid = await storedPose(input.inputKey);
  if (valid) {
    if (valid.contentHash !== row.contentHash)
      throw Error(
        "Conflicting result for identical pose inputs; the original saved revision was retained.",
      );
    return valid;
  }
  return database.transaction("rw", database.ligandPoses, async () => {
    const previous = await database.ligandPoses.get(row.inputKey);
    if (previous) {
      // Repair requires explicit recalculation, which creates this exact valid result again.
      if (
        previous.contentHash === row.contentHash &&
        encoded(previous.input, previous.result) === encoded(input, result)
      )
        return previous;
      await database.ligandPoses.put(row);
    } else await database.ligandPoses.add(row);
    return row;
  });
}
