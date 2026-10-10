import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
/*
 * Phase 4 comparison workflows. Coordinates and biology responses come from the frozen
 * fixtures in tests/fixtures/biology; every other remote service is blocked.
 */
const json = (body: Buffer) => ({
  body,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
});
const missing = {
  status: 404,
  headers: { "access-control-allow-origin": "*" },
};
async function fixtureRoutes(page: Page) {
  await page.route("https://files.rcsb.org/download/*.cif", async (route) => {
    const id = route.request().url().split("/").at(-1)!.replace(".cif", "");
    try {
      await route.fulfill({
        body: gunzipSync(await readFile(`tests/fixtures/biology/${id}.cif.gz`)),
        contentType: "chemical/x-mmcif",
        headers: { "access-control-allow-origin": "*" },
      });
    } catch {
      await route.fulfill(missing);
    }
  });
  const file =
    (path: string) =>
    async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      try {
        await route.fulfill(json(await readFile(path)));
      } catch {
        await route.fulfill(missing);
      }
    };
  await page.route(
    "https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/*",
    async (route) =>
      file(
        `tests/fixtures/biology/${route.request().url().split("/").at(-1)}-discovery.json`,
      )(route),
  );
  await page.route(
    "https://ftp.ebi.ac.uk/pub/databases/msd/sifts/xml/*",
    async (route) => {
      const id = route.request().url().split("/").at(-1)!.split(".")[0];
      await route.fulfill({
        body: await readFile(`tests/fixtures/biology/${id}-sifts.xml.gz`),
        contentType: "application/gzip",
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.route("https://data.rcsb.org/rest/v1/core/chemcomp/*", (route) =>
    file(
      `tests/fixtures/biology/chemcomp-${route.request().url().split("/").at(-1)}.json`,
    )(route),
  );
  await page.route(
    "https://data.rcsb.org/rest/v1/core/nonpolymer_entity_instance/**",
    (route) => {
      const [entry, asym] = route.request().url().split("/").slice(-2);
      return file(`tests/fixtures/biology/ligand-${entry}-${asym}.json`)(route);
    },
  );
  // Chemical Component Dictionary definitions: the frozen BEN record; others unavailable.
  await page.route(
    "https://files.rcsb.org/ligands/download/*.cif",
    async (route) => {
      const id = route.request().url().split("/").at(-1)!.replace(".cif", "");
      try {
        await route.fulfill({
          body: await readFile(`tests/fixtures/${id}-ccd.cif`),
          contentType: "text/plain",
          headers: { "access-control-allow-origin": "*" },
        });
      } catch {
        await route.fulfill(missing);
      }
    },
  );
  await page.route("https://data.rcsb.org/rest/v1/core/entry/*", (route) =>
    route.fulfill(missing),
  );
  await page.route("https://rest.uniprot.org/uniprotkb/*", (route) =>
    file(`tests/fixtures/biology/${route.request().url().split("/").at(-1)}`)(
      route,
    ),
  );
}
test.beforeEach(async ({ page }) => {
  await fixtureRoutes(page);
});
async function addComparison(page: Page, id: string) {
  await page.getByLabel("Comparison PDB ID").fill(id);
  await page.getByRole("button", { name: "Add structure" }).click();
}

test("a comparison structure has its own mapping and analysis, and restores with the session", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await addComparison(page, "1S0R");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot).toHaveAttribute("data-phase", "ready");
  await expect(slot.getByTestId("comparison-mapping")).toContainText(
    "P00760 · 223/223 residues exactly mapped",
  );
  // Superposed automatically once both residue mappings exist (values match numpy; see
  // validation/comparison.json).
  await expect(slot.getByTestId("comparison-fit")).toHaveText(
    /^Core RMSD 0\.17 Å over 213 of 223 Cα \(2 rejection cycles\) · all pairs 0\.29 Å/,
  );
  await slot.getByLabel("Superposition of 1S0R").selectOption("binding_site");
  await expect(slot.getByTestId("comparison-fit")).toContainText(
    "over 31 of 32 Cα",
  );
  // The reference target is benzamidine, so the same component is the default.
  await expect(
    page.getByLabel("Comparison ligand for 1S0R").locator("option:checked"),
  ).toHaveText(/^BEN A:/);
  await slot.getByRole("button", { name: "Analyze" }).click();
  await expect(slot.getByRole("status")).toContainText(
    /\d+ chemical interactions with \d+ residues · fresh/,
  );
  // The reference analysis is untouched by the comparison analysis.
  await expect(page.locator(".analysis-summary")).toHaveCount(0);
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByText(/Session saved in this browser/)).toBeVisible();
  // Restoring must not refetch biology: block it.
  await page.route("https://www.ebi.ac.uk/**", (route) => route.abort());
  await page.route("https://ftp.ebi.ac.uk/**", (route) => route.abort());
  await page.route("https://rest.uniprot.org/**", (route) => route.abort());
  await page.reload();
  await expect(slot).toHaveAttribute("data-phase", "ready");
  await expect(slot.getByTestId("comparison-mapping")).toContainText("pinned");
  await expect(slot.getByRole("status")).toContainText("cached");
  await expect(slot.getByLabel("Superposition of 1S0R")).toHaveValue(
    "binding_site",
  );
  await expect(slot.getByTestId("comparison-fit")).toContainText(
    "over 31 of 32 Cα",
  );
  await page.getByRole("button", { name: "Source" }).click();
  await expect(page.getByTestId("cache-usage")).toContainText("2 structures");
  expect(errors).toEqual([]);
});

test("a failed comparison load leaves the reference analysis intact, and a new reference closes the comparison", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toContainText("Fresh result");
  await addComparison(page, "9ZZZ");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot).toHaveAttribute("data-phase", "error");
  await expect(slot.getByRole("alert")).toContainText("No coordinates found");
  await expect(page.locator(".analysis-summary")).toContainText("Fresh result");
  await slot.getByRole("button", { name: "Remove 9ZZZ" }).click();
  await expect(slot).toHaveCount(0);
  await addComparison(page, "1S0Q");
  await expect(slot).toHaveAttribute("data-phase", "ready");
  // An apo structure: nothing to analyze, the comparison still loads.
  await expect(slot.getByRole("status")).toContainText("Choose a ligand");
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await expect(slot).toHaveCount(0);
  await expect(page.locator(".comparison-panel")).toContainText(
    "Comparison structures were closed because the reference structure changed.",
  );
  expect(errors).toEqual([]);
});

test("hemoglobin chains pair by author chain, can be re-paired, and the pairing restores", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await addComparison(page, "1HHO");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot).toHaveAttribute("data-phase", "ready");
  await expect(slot.getByTestId("comparison-counts")).toHaveText(
    /^287 paired · 0 reference only · 0 comparison only · 0 not comparable/,
  );
  const partnerOfC = slot.getByLabel(
    "Partner of reference chain C (P69905) in 1HHO",
  );
  await expect(partnerOfC).toHaveValue("");
  // Pair 1HHO A with 4HHB C instead of 4HHB A.
  await partnerOfC.selectOption({ label: "A" });
  await expect(
    slot.getByLabel("Partner of reference chain A (P69905) in 1HHO"),
  ).toHaveValue("");
  await expect(slot.getByTestId("comparison-counts")).toContainText(
    "287 paired",
  );
  await expect(slot.locator("tr", { hasText: /^P69905C/ })).toContainText(
    "your choice",
  );
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByText(/Session saved in this browser/)).toBeVisible();
  await page.reload();
  await expect(slot).toHaveAttribute("data-phase", "ready");
  await expect(
    slot.getByLabel("Partner of reference chain C (P69905) in 1HHO"),
  ).not.toHaveValue("");
  await slot.getByRole("button", { name: "Reset pairings" }).click();
  await expect(
    slot.getByLabel("Partner of reference chain C (P69905) in 1HHO"),
  ).toHaveValue("");
  expect(errors).toEqual([]);
});

test("fingerprints compare like-for-like analyses by UniProt position and export with the comparison", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await addComparison(page, "1S0R");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  const fingerprint = page.getByTestId("fingerprint");
  await expect(fingerprint).toContainText("Run the reference analysis");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toContainText("Fresh result");
  await expect(
    fingerprint.getByTestId("fingerprint-column").nth(1),
  ).toContainText("Not analyzed");
  await slot.getByRole("button", { name: "Analyze" }).click();
  await expect(
    fingerprint.getByTestId("fingerprint-column").nth(1),
  ).toContainText("Tanimoto 1.00 · +0 −0");
  // Asp189 in 3PTB numbering is UniProt 194; both structures form the salt bridge.
  const saltBridge = fingerprint.locator("tr", {
    hasText: /A · 194 · ASP 189\s*Salt-bridge/,
  });
  await expect(saltBridge.locator("td")).toHaveText(["●", "●"]);
  const downloaded = page.waitForEvent("download");
  await fingerprint.getByRole("button", { name: "Comparison JSON" }).click();
  const json = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(json.schemaVersion).toBe(1);
  expect(json.comparisonVersion).toBe("comparison-1.0.0");
  expect(json.structures[0].correspondence.counts.paired).toBe(223);
  expect(json.structures[0].superposition.fitted).toBe(213);
  expect(json.fingerprint.columns[1].similarity.tanimoto).toBe(1);
  expect(json.structures[0].bindingSiteDifferences.residues).toHaveLength(17);
  // Gln192 (UniProt 197) changes rotamer between 3PTB and 1S0R; 3PTB has no DPI inputs.
  await expect(slot.getByTestId("comparison-site")).toContainText(
    "Binding site: 17 paired residues · significance not assessable",
  );
  await expect(slot.getByTestId("comparison-site")).toContainText(
    "1 rotamer changes",
  );
  // A different reference setting invalidates the reference run; after re-running it the
  // comparison analysis no longer matches and its column is refused.
  await page
    .getByRole("spinbutton", { name: "Proximity cutoff", exact: true })
    .fill("4.5");
  await expect(fingerprint).toContainText("Run the reference analysis");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(
    fingerprint.getByTestId("fingerprint-column").nth(1),
  ).toContainText("Different parameters proximityCutoff");
  expect(errors).toEqual([]);
});
