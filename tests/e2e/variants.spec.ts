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
  await page.goto("/");
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
