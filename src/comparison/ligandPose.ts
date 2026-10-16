import {
  LIGAND_POSE_VERSION,
  POSE_ALGORITHM_VERSION,
  POSE_TIE_TOLERANCE_ANGSTROM,
  poseUnavailable,
  type LigandPoseInput,
  type LigandPoseResult,
  type PreparedPoseLigand,
  type PoseResultContext,
} from "../domain/ligandPose";
import { enumeratePoseMappings } from "./poseMappings";
import { isProperPoseTransform } from "./poseTransform";

function context(p: PreparedPoseLigand): PoseResultContext {
  const {
    sourceHash,
    snapshotId,
    residueId,
    componentId,
    conformerId,
    minimumOccupancy,
    chemistryId,
    chemistryHash,
    graphHash,
  } = p;
  return {
    sourceHash,
    snapshotId,
    residueId,
    componentId,
    conformerId,
    minimumOccupancy,
    chemistryId,
    chemistryHash,
    graphHash,
  };
}
/** Equal-weight heavy-atom RMSD in the selected protein frame. Never fits the ligand.
 * All admissible heavy-atom maps must be enumerated before an exact score is returned.
 */
export function calculateLigandPose(input: LigandPoseInput): LigandPoseResult {
  if (
    input.version !== LIGAND_POSE_VERSION ||
    input.algorithmVersion !== POSE_ALGORITHM_VERSION ||
    !input.inputKey
  )
    return poseUnavailable(
      "invalid_input",
      "Unsupported or unidentified pose input version.",
    );
  const { reference: a, comparison: b, fit } = input;
  if (
    !fit ||
    !input.fitInputKey ||
    !["global", "binding_site"].includes(fit.scope)
  )
    return poseUnavailable(
      "missing_fit",
      "A selected protein fit and its input identity are required.",
    );
  if (!isProperPoseTransform(fit.transform))
    return poseUnavailable(
      "invalid_transform",
      "The protein transform must be finite, rigid and proper.",
    );
  if (
    a.graphHash !== b.graphHash ||
    a.componentId !== a.graph.componentId ||
    b.componentId !== b.graph.componentId
  )
    return poseUnavailable(
      "chemistry_conflict",
      "Pose chemistry identity does not match its graph.",
    );
  for (const p of [a, b]) {
    if (p.attachment.status !== "no_recorded_link")
      return poseUnavailable(
        p.attachment.status === "covalent"
          ? "covalent_attachment"
          : "attachment_unknown",
        "An eligible source-recorded attachment context is required.",
      );
    if (
      p.attachment.sourceHash !== p.sourceHash ||
      p.attachment.snapshotId !== p.snapshotId ||
      p.attachment.residueId !== p.residueId
    )
      return poseUnavailable(
        "source_mismatch",
        "Attachment context does not identify the selected coordinates.",
      );
    if (
      !Number.isFinite(p.minimumOccupancy) ||
      p.minimumOccupancy < 0 ||
      p.minimumOccupancy > 1 ||
      p.atomNames.length !== p.atomIds.length ||
      p.atomNames.length !== p.sourceRows.length ||
      p.positions.length !== p.atomNames.length * 3 ||
      new Set(p.atomIds).size !== p.atomIds.length ||
      new Set(p.atomNames).size !== p.atomNames.length
    )
      return poseUnavailable(
        "invalid_input",
        "Invalid coordinate arrays, atom identities or occupancy policy.",
      );
    if (!p.positions.every(Number.isFinite))
      return poseUnavailable(
        "nonfinite_coordinates",
        "Pose coordinates must be finite.",
      );
  }
  const mappings = enumeratePoseMappings(a.graph, b.graph);
  if (mappings.status !== "mapped") return mappings;
  const indices = (names: string[], p: PreparedPoseLigand) =>
    names.map((n) => p.atomNames.indexOf(n));
  const ai = indices(mappings.referenceNames, a),
    bi = indices(mappings.comparisonNames, b),
    n = ai.length;
  if (
    ai.some((i) => i < 0) ||
    bi.some((i) => i < 0) ||
    a.atomNames.length !== n ||
    b.atomNames.length !== n
  )
    return poseUnavailable(
      "incomplete_ligand",
      "Coordinates must cover the complete dictionary heavy-atom set exactly once.",
    );
  const t = fit.transform,
    moved = new Float64Array(n * 3);
  for (let j = 0; j < n; j++)
    for (let k = 0; k < 3; k++)
      moved[j * 3 + k] =
        t[k] * b.positions[bi[j] * 3] +
        t[4 + k] * b.positions[bi[j] * 3 + 1] +
        t[8 + k] * b.positions[bi[j] * 3 + 2] +
        t[12 + k];
  if (!moved.every(Number.isFinite))
    return poseUnavailable(
      "nonfinite_coordinates",
      "Transformed coordinates overflowed.",
    );
  const distances = (map: number[]) =>
    map.map((j, i) =>
      Math.hypot(
        ...[0, 1, 2].map((k) => a.positions[ai[i] * 3 + k] - moved[j * 3 + k]),
      ),
    );
  // Scaled norm avoids overflowing the sum of squares for otherwise finite coordinates.
  const rms = (d: number[]) => {
    const scale = Math.max(...d);
    return scale === 0
      ? 0
      : scale * Math.sqrt(d.reduce((s, x) => s + (x / scale) ** 2, 0) / n);
  };
  const stableOrder = ai
    .map((_, i) => i)
    .sort((i, j) => (a.atomIds[ai[i]] < a.atomIds[ai[j]] ? -1 : 1));
  const earlier = (x: number[], y: number[]) => {
    for (const i of stableOrder) {
      const u = b.atomIds[bi[x[i]]],
        v = b.atomIds[bi[y[i]]];
      if (u !== v) return u < v;
    }
    return false;
  };
  const scores = mappings.maps.map((map) => rms(distances(map)));
  if (!scores.every(Number.isFinite))
    return poseUnavailable(
      "nonfinite_coordinates",
      "Pose distances overflowed.",
    );
  const minimum = Math.min(...scores);
  let best = -1;
  for (let i = 0; i < scores.length; i++)
    if (
      scores[i] <= minimum + POSE_TIE_TOLERANCE_ANGSTROM &&
      (best === -1 || earlier(mappings.maps[i], mappings.maps[best]))
    )
      best = i;
  const map = mappings.maps[best],
    d = distances(map);
  const named = mappings.maps.find((m) =>
    m.every(
      (j, i) => mappings.referenceNames[i] === mappings.comparisonNames[j],
    ),
  );
  return {
    status: "evaluated",
    version: input.version,
    algorithmVersion: input.algorithmVersion,
    inputKey: input.inputKey,
    rmsdAngstrom: scores[best],
    ...(named ? { nameMatchedRmsdAngstrom: rms(distances(named)) } : {}),
    matchedAtoms: n,
    admissibleMaps: mappings.maps.length,
    searchStates: mappings.searchStates,
    fit: structuredClone(fit),
    fitInputKey: input.fitInputKey,
    reference: context(a),
    comparison: context(b),
    pairs: stableOrder.map((i) => ({
      referenceAtomId: a.atomIds[ai[i]],
      comparisonAtomId: b.atomIds[bi[map[i]]],
      referenceAtomName: mappings.referenceNames[i],
      comparisonAtomName: mappings.comparisonNames[map[i]],
      distanceAngstrom: d[i],
    })),
  };
}
