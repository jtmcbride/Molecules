import { describe, expect, it } from "vitest";
import {
  evaluationOf,
  INTERACTION_LABELS,
  type AnalysisRun,
  type InteractionType,
} from "../src/domain/analysis";

// Artificial evaluation record shaped like a run saved under ruleset ligand-2, before
// halogen bonds existed. Restored sessions show such runs unchanged.
const legacy = {
  ruleSetVersion: "molstar-5.13.1-ligand-2",
  evaluation: Object.fromEntries(
    (Object.keys(INTERACTION_LABELS) as InteractionType[])
      .filter((t) => t !== "halogen_bond")
      .map((t) => [t, { status: "evaluated" }]),
  ) as AnalysisRun["evaluation"],
};

describe("evaluationOf", () => {
  it("returns recorded evaluation statuses unchanged", () => {
    expect(evaluationOf(legacy, "hydrogen_bond")).toEqual({
      status: "evaluated",
    });
  });

  it("reports types missing from an older run as not evaluated by that ruleset", () => {
    const halogen = evaluationOf(legacy, "halogen_bond");
    expect(halogen.status).toBe("not_evaluated");
    expect(halogen.reason).toContain("molstar-5.13.1-ligand-2");
  });

  it("covers every interaction type for a legacy run", () => {
    for (const t of Object.keys(INTERACTION_LABELS) as InteractionType[])
      expect(evaluationOf(legacy, t).status).toBeDefined();
  });
});
