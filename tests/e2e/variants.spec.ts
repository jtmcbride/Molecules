import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
/*
 * Phase 5 curated-variant workflows. Coordinates, biology responses and RCSB sequence-coordinates
 * alignments come from the frozen fixtures in tests/fixtures/biology.
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
/** RCSB sequence-coordinates GraphQL (POST); counts requests per accession. */
async function carrierRoute(page: Page, requests: string[], status = 200) {
  await page.route(
    "https://sequence-coordinates.rcsb.org/graphql",
    async (route) => {
      if (route.request().method() !== "POST") return route.fulfill(missing);
      const accession = /queryId: \\?"([A-Z0-9]+)/.exec(
        route.request().postData() ?? "",
      )?.[1];
      requests.push(accession ?? "?");
      if (status !== 200 || !accession)
        return route.fulfill({ ...missing, status });
      await route.fulfill(
        json(
          await readFile(`tests/fixtures/biology/carriers-${accession}.json`),
        ),
      );
    },
  );
}
test.beforeEach(async ({ page }) => {
  await fixtureRoutes(page);
});
async function openHemoglobinHeme(page: Page) {
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  const target = page.getByLabel("Analysis target ligand");
  await target.selectOption(
    (await target
      .locator("option", { hasText: /HEM B:148/ })
      .getAttribute("value"))!,
  );
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toBeVisible();
}

test("curated variants at the beta heme: quoted records, atom-level consequences and background counts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openHemoglobinHeme(page);
  const summary = page.getByTestId("binding-site-summary");
  await expect(summary.getByTestId("binding-variant-natural")).toContainText(
    "18 / 21",
  );
  await expect(summary.getByTestId("binding-variant-natural")).toContainText(
    "chain 130 / 146",
  );
  await expect(summary.getByTestId("binding-variants")).toContainText(
    "UniProt P68871 lists no mutagenesis features.",
  );
  // The proximal histidine: UniProt 93, author 92.
  await page
    .getByRole("button", { name: /with HIS B:92/ })
    .first()
    .click();
  const variants = page.getByTestId("residue-variants");
  await variants.locator("summary").click();
  await expect(variants).toContainText("H93D");
  await expect(variants).toContainText(
    "in J-Altgelds Gardens; unstable; dbSNP:rs33924775",
  );
  await expect(variants).toContainText("deposited residue is the original");
  await expect(
    variants.getByTestId("variant-interactions").first(),
  ).toContainText("metal coordination · H→D");
  await expect(variants).toContainText(
    "NE2: a side-chain atom of the deposited His, not part of Asp.",
  );
  await expect(variants).toContainText(
    "whether Asp forms this or another interaction, are not evaluated",
  );
  for (const word of ["lost", "disrupt", "abolish", "pathogenic"])
    await expect(
      variants.getByTestId("variant-interactions").first(),
    ).not.toContainText(word);
  // Variant categories are offered but off by default.
  await page.getByRole("button", { name: /^Chain B / }).click();
  await expect(
    page.getByRole("checkbox", { name: "Natural variant" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Mutagenesis" }),
  ).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("deposited structures carrying a variant: lookup, comparison, pinned restore", async ({
  page,
}) => {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await carrierRoute(page, requests);
  await openHemoglobinHeme(page);
  // Select beta Glu6 (UniProt 7) from the natural-variant track.
  await page.getByRole("button", { name: /^Chain B / }).click();
  await page.getByRole("checkbox", { name: "Natural variant" }).check();
  await page
    .getByRole("button", { name: "Natural variant at label 6", exact: true })
    .click();
  await expect(page.locator(".residue-identity")).toContainText("6");
  const variants = page.getByTestId("residue-variants");
  await variants.locator("summary").click();
  await expect(variants).toContainText("E7V");
  await variants
    .getByRole("button", {
      name: "Find deposited structures with these replacements",
    })
    .click();
  const carriers = variants.getByTestId("variant-carriers");
  await expect(carriers).toContainText("E7V 10 deposited entries");
  await expect(carriers).toContainText(
    "Computed models in the response are not listed.",
  );
  expect(requests).toEqual(["P68871"]);
  await carriers.getByRole("button", { name: "Compare 2HBS" }).click();
  const slot = page.getByTestId("comparison-slot");
  await expect(slot).toHaveAttribute("data-phase", "ready");
  // SIFTS labels the sickle residue as a natural variant, so the position pairs.
  await expect(slot).toContainText("E7V");
  // The reference analysis and interpretation are untouched.
  await expect(page.locator(".analysis-summary")).toBeVisible();
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByText(/Session saved in this browser/)).toBeVisible();
  await page.route("https://www.ebi.ac.uk/**", (route) => route.abort());
  await page.route("https://ftp.ebi.ac.uk/**", (route) => route.abort());
  await page.route("https://rest.uniprot.org/**", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByText("Restored pinned interpretation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Chain B / }).click();
  await page.getByRole("checkbox", { name: "Natural variant" }).check();
  await page
    .getByRole("button", { name: "Natural variant at label 6", exact: true })
    .click();
  await page.getByTestId("residue-variants").locator("summary").click();
  await expect(page.getByTestId("variant-carriers")).toContainText("pinned");
  await expect(page.getByTestId("variant-carriers")).toContainText(
    "E7V 10 deposited entries",
  );
  expect(requests).toEqual(["P68871"]);
  expect(errors).toEqual([]);
});

test("a failed carrier lookup leaves interpretation and analysis intact", async ({
  page,
}) => {
  const requests: string[] = [];
  await carrierRoute(page, requests, 400);
  await openHemoglobinHeme(page);
  await page
    .getByRole("button", { name: /with HIS B:92/ })
    .first()
    .click();
  const variants = page.getByTestId("residue-variants");
  await variants.locator("summary").click();
  await variants
    .getByRole("button", {
      name: "Find deposited structures with these replacements",
    })
    .click();
  await expect(variants.getByRole("alert")).toContainText("HTTP 400");
  await expect(page.locator(".analysis-summary")).toBeVisible();
  await expect(page.getByTestId("binding-site-summary")).toBeVisible();
  await expect(variants).toContainText("H93D");
});

test("protein table discovers a variant, inspects a chain and opens a carrier comparison", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  await carrierRoute(page, requests);
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  const table = page.getByTestId("variant-table");
  await expect(table).toContainText(
    "UniProt P00760 lists no natural variant or mutagenesis records.",
  );
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Chain B / }).click();
  await expect(table.getByTestId("variant-type-counts")).toContainText(
    "261 Natural variant · 0 Mutagenesis",
  );
  await expect(table.getByLabel("Contact membership")).toBeDisabled();
  await expect(table.getByRole("status")).toContainText("1–10 shown");
  await table.getByRole("button", { name: "Next variants" }).click();
  await expect(table.getByRole("status")).toContainText("11–20 shown");
  await table.getByLabel("Search records").fill("E7V");
  await expect(table.getByRole("status")).toContainText(
    "1 of 261 source features",
  );
  await table.getByRole("button", { name: "Show details for E7V" }).click();
  await expect(table).toContainText(
    "2 / 2 chain instances with exact observed positions",
  );
  expect(requests).toEqual([]);
  await table.getByRole("button", { name: /^Inspect E7V in chain B / }).click();
  await expect(page.locator(".residue-identity")).toContainText("6");
  // An already-selected residue must still bring its chain back into the sequence panel.
  await page.getByRole("button", { name: /^Chain D / }).click();
  await table.getByRole("button", { name: /^Inspect E7V in chain B / }).click();
  await expect(page.getByRole("button", { name: /^Chain B / })).toHaveClass(
    /active/,
  );
  await table
    .getByRole("button", { name: "Variant evidence", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("UniProt");
  await page.getByRole("button", { name: /Close evidence/ }).click();
  await table
    .getByRole("button", {
      name: "Find deposited structures with these replacements",
    })
    .click();
  await expect(table.getByTestId("variant-carriers")).toContainText(
    "E7V 10 deposited entries",
  );
  await table.screenshot({
    path: testInfo.outputPath("variant-table-desktop.png"),
  });
  const residueVariants = page.getByTestId("residue-variants");
  await residueVariants.locator("summary").click();
  await expect(residueVariants.getByTestId("variant-carriers")).toContainText(
    "E7V 10 deposited entries",
  );
  expect(requests).toEqual(["P68871"]);
  await table.getByRole("button", { name: "Compare 2HBS" }).click();
  await expect(page.getByTestId("comparison-slot")).toHaveAttribute(
    "data-phase",
    "ready",
  );
  await expect(page.getByTestId("comparison-slot")).toContainText("E7V");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table.getByLabel("Search records")).toBeVisible();
  await table.screenshot({
    path: testInfo.outputPath("variant-table-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("variant table contact and source-type filters leave the analysis summary unchanged", async ({
  page,
}) => {
  await openHemoglobinHeme(page);
  await page.getByRole("button", { name: /^Chain B / }).click();
  const table = page.getByTestId("variant-table");
  const before = await page.getByTestId("binding-site-summary").textContent();
  await expect(table.getByLabel("Contact membership")).toBeEnabled();
  await table.getByLabel("Contact membership").selectOption("chemical");
  await expect(table.getByRole("status")).not.toContainText("261 of 261");
  await table.getByLabel("Feature type").selectOption("Mutagenesis");
  await expect(table).toContainText("No source features match these filters.");
  expect(await page.getByTestId("binding-site-summary").textContent()).toBe(
    before,
  );
  await expect(page.locator(".analysis-summary")).toBeVisible();
});
