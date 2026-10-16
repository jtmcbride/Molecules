import { calculateLigandPose } from "./ligandPose";
import type { LigandPoseInput } from "../domain/ligandPose";
self.onmessage = (event: MessageEvent<{ input: LigandPoseInput }>) => {
  const { input } = event.data;
  try {
    self.postMessage({
      type: "result",
      inputKey: input.inputKey,
      result: calculateLigandPose(input),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      inputKey: input.inputKey,
      message:
        error instanceof Error ? error.message : "Pose calculation failed.",
    });
  }
};
