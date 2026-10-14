import { ENGINE_VERSION, RULESET_VERSION } from "./analysis";
import { BIOLOGY_VERSION } from "./biology";
import { COMPARISON_VERSION } from "./comparison";

/** Application version comes from package.json at build time. */
export const RELEASE = {
  application: __APP_VERSION__,
  engine: ENGINE_VERSION,
  ruleset: RULESET_VERSION,
  biology: BIOLOGY_VERSION,
  comparison: COMPARISON_VERSION,
} as const;
