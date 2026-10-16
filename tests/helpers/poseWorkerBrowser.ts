import { LigandPoseClient } from "../../src/comparison/ligandPoseClient";
import { input } from "./poseCalculation";
import reference from "../fixtures/ligand-pose/reference.json";
async function check() {
  const client = new LigandPoseClient(),
    results = [];
  for (const c of reference.cases) {
    const request = input(c),
      bytes = request.reference.positions.byteLength;
    const result = await client.run(request);
    if (
      result.status !== "evaluated" ||
      Math.abs(result.rmsdAngstrom - c.rmsdAngstrom) > 1e-10 ||
      result.admissibleMaps !== c.maps.length
    )
      throw Error(
        `${c.name}: worker/reference mismatch ${JSON.stringify(result)}`,
      );
    if (request.reference.positions.byteLength !== bytes)
      throw Error("Detached caller coordinates");
    results.push({
      name: c.name,
      rmsd: result.rmsdAngstrom,
      maps: result.admissibleMaps,
    });
  }
  // Immediate supersession reliably aborts the first worker before its queued response.
  const old = client.run(input()).then(
    () => "resolved",
    (e) => e.name,
  );
  const next = client.run(input(reference.cases[1]));
  if ((await old) !== "AbortError" || (await next).status !== "evaluated")
    throw Error("Supersession failed");
  const abort = new AbortController();
  const pending = client.run(input(), abort.signal).then(
    () => "resolved",
    (e) => e.name,
  );
  abort.abort();
  if ((await pending) !== "AbortError") throw Error("Signal abort failed");
  return {
    results,
    supersession: "passed",
    abort: "passed",
    buffers: "retained",
  };
}
Object.assign(window, { poseWorkerCheck: check() });
