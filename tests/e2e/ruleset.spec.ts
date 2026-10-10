import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
/*
 * Ruleset molstar-5.13.1-ligand-3 browser workflows. Structures come from the pinned
 * reference-set fixtures; biological and metadata services are blocked so the checks
 * depend only on local files.
 */
async function offlineStructures(page: Page) {
  await page.route("https://files.rcsb.org/download/*.cif", async (route) => {
    const id = route.request().url().split("/").at(-1)!.replace(".cif", "");
    try {
      const body = gunzipSync(
        await readFile(`tests/fixtures/reference-set/${id}.cif.gz`),
      );
      await route.fulfill({
        body,
        contentType: "chemical/x-mmcif",
        headers: { "access-control-allow-origin": "*" },
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  for (const pattern of [
    "https://data.rcsb.org/**",
    "https://www.ebi.ac.uk/**",
    "https://ftp.ebi.ac.uk/**",
    "https://rest.uniprot.org/**",
  ])
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 404,
        headers: { "access-control-allow-origin": "*" },
      }),
    );
}
async function open(page: Page, accession: string) {
  await page.goto("/");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("LOAD A STRUCTURE").fill(accession);
  await page.getByRole("button", { name: "Load PDB structure" }).click();
  await expect(page.locator(".structure-title, h1").first()).toBeVisible();
  await expect(page.getByText("Structure ready", { exact: true })).toBeVisible({
    timeout: 60000,
  });
}
async function analyzeTarget(page: Page, optionText: RegExp) {
  const select = page.getByLabel("Analysis target ligand");
  const value = await select
    .locator("option", { hasText: optionText })
    .first()
    .getAttribute("value");
  await select.selectOption(value!);
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toBeVisible({
    timeout: 60000,
  });
}
test.beforeEach(async ({ page }) => offlineStructures(page));

test("covalent ligand: 5P9J ibrutinib shows its Cys481 attachment", async ({
  page,
}) => {
  await open(page, "5P9J");
  await analyzeTarget(page, /^8E8 /);
  await run(page);
  await expect(page.getByTestId("covalent-attachment")).toContainText(
    "8E8 A:701 CAA – CYS A:481 SG",
  );
  await expect(page.getByTestId("covalent-attachment")).toContainText(
    "deposited bond",
  );
});

test("halogen bond and ambiguity labels: 1NAV", async ({ page }) => {
  await open(page, "1NAV");
  await analyzeTarget(page, /^IH5 /);
  await run(page);
  await expect(
    page.getByRole("button", { name: /Inspect Halogen bond with PHE A:218/ }),
  ).toBeVisible();
  await expect(
    page
      .locator(".interaction-table .ambiguity", { hasText: "His tautomer?" })
      .first(),
  ).toBeVisible();
});

test("per-conformer ensemble: 1T46 reports analyzed conformers", async ({
  page,
}) => {
  await open(page, "1T46");
  await analyzeTarget(page, /^STI /);
  await run(page);
  await page.getByRole("button", { name: /Show calculation settings/ }).click();
  await expect(page.getByLabel("Alternate conformer policy")).toHaveValue(
    "ensemble",
  );
  const json = await download(page);
  expect(json.analysis.stats.conformerLabels.length).toBeGreaterThanOrEqual(2);
  expect(
    json.analysis.interactions.every(
      (i: { conformers?: unknown[] }) => i.conformers?.length,
    ),
  ).toBe(true);
});

test("glycan group and cofactor receptor components: 4KZN and 1ATP", async ({
  page,
}) => {
  await open(page, "4KZN");
  await analyzeTarget(page, /^Glycan NAG–NAG–BMA–MAN/);
  await run(page);
  const glycan = await download(page);
  expect(glycan.analysis.request.ligandResidueIds).toHaveLength(6);
  expect(
    new Set(
      glycan.analysis.interactions.map(
        (i: { ligand: { residueId: string } }) => i.ligand.residueId,
      ),
    ).size,
  ).toBeGreaterThan(1);
  await open(page, "1ATP");
  await analyzeTarget(page, /^ATP /);
  const components = page.getByTestId("receptor-components");
  for (const box of await components.getByRole("checkbox").all()) {
    const text = await box.locator("xpath=..").innerText();
    if (text.includes("MN")) await box.check();
  }
  await run(page);
  await expect(
    page
      .getByRole("button", { name: /Inspect Metal candidate with MN E:35[12]/ })
      .first(),
  ).toBeVisible();
});

async function download(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON + provenance" }).click();
  return JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
}
