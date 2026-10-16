import type { Page } from "@playwright/test";
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
export async function fixtureRoutes(page: Page) {
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
