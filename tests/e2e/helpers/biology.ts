import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

export async function biologyRoutes(page: Page) {
  await page.route(
    "https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/*",
    async (route) => {
      const id = route.request().url().split("/").at(-1)!;
      await route.fulfill({
        body: await readFile(`tests/fixtures/biology/${id}-discovery.json`),
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
      });
    },
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
  await page.route(
    "https://data.rcsb.org/rest/v1/core/chemcomp/*",
    async (route) => {
      const component = route.request().url().split("/").at(-1)!;
      await route.fulfill({
        body: await readFile(
          `tests/fixtures/biology/chemcomp-${component}.json`,
        ),
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.route(
    "https://data.rcsb.org/rest/v1/core/nonpolymer_entity_instance/**",
    async (route) => {
      const [entry, asym] = route.request().url().split("/").slice(-2);
      await route.fulfill({
        body: await readFile(
          `tests/fixtures/biology/ligand-${entry}-${asym}.json`,
        ),
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.route("https://rest.uniprot.org/uniprotkb/*", async (route) => {
    const accession = route.request().url().split("/").at(-1)!;
    await route.fulfill({
      body: await readFile(`tests/fixtures/biology/${accession}`),
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
    });
  });
}
