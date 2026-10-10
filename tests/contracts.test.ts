import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_KINDS,
  MAPPING_STATUSES,
  RESIDUE_IDENTITIES,
} from "../src/domain/biology";
// The Phase 3 plan documents the domain contracts; src/domain/biology.ts is authoritative.
// These checks fail when either side changes without the other.
const plan = readFileSync("docs/PHASE_3_PLAN.md", "utf8");
const source = readFileSync("src/domain/biology.ts", "utf8");
const excerpt = plan
  .slice(plan.indexOf("## Domain contracts"))
  .match(/```ts\n([\s\S]*?)```/)![1];
/** Top-level field names per interface, ignoring nested object members and comments. */
function interfaces(text: string) {
  const output = new Map<string, string[]>();
  for (const match of text.matchAll(/interface (\w+) \{\n([\s\S]*?)\n\}/g)) {
    const fields: string[] = [];
    let depth = 0;
    for (const line of match[2].replace(/\/\/.*$/gm, "").split("\n")) {
      const field = depth === 0 ? line.match(/^\s*(\w+)\??:/) : null;
      if (field) fields.push(field[1]);
      depth +=
        (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    }
    output.set(match[1], fields.sort());
  }
  return output;
}
function union(field: string) {
  const line = excerpt.match(new RegExp(`\\b${field}\\??: ([^;]+);`))![1];
  return [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}
describe("documented domain contracts", () => {
  it("lists every mapping status and evidence kind exported by the domain model", () => {
    expect(union("status")).toEqual([...MAPPING_STATUSES].sort());
    expect(union("kind")).toEqual([...EVIDENCE_KINDS].sort());
    expect(union("identity")).toEqual([...RESIDUE_IDENTITIES].sort());
  });
  it("documents the same fields as the implemented interfaces", () => {
    const documented = interfaces(excerpt),
      implemented = interfaces(source);
    expect(documented.size).toBeGreaterThanOrEqual(6);
    for (const [name, fields] of documented)
      expect({ name, fields }).toEqual({ name, fields: implemented.get(name) });
  });
});
