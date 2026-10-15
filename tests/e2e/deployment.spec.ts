import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { biologyRoutes } from "./helpers/biology";
import { ENGINE_VERSION, RULESET_VERSION } from "../../src/domain/analysis";

test("production hosting loads bundled data, fonts, lazy code and both workers at its build path", async ({
  page,
  baseURL,
  request,
}) => {
  const build = JSON.parse(await readFile("dist/build-info.json", "utf8"));
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const base = new URL(baseURL!);
  const served = await request.get(new URL("build-info.json", base).href);
  expect(served.ok()).toBe(true);
  expect(await served.json()).toEqual(build);
  expect(base.pathname).toBe(build.basePath);

  const errors: string[] = [],
    workers: string[] = [],
    assets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== base.origin) return;
    assets.push(url.pathname);
    if (!url.pathname.startsWith(base.pathname) || !response.ok()) {
      errors.push(`${response.status()} ${url.pathname}`);
    }
    if (
      url.pathname.endsWith(".js") &&
      !/javascript/.test(response.headers()["content-type"] || "")
    ) {
      errors.push(`Invalid JavaScript response: ${url.pathname}`);
    }
  });
  page.on("requestfailed", (req) => {
    if (new URL(req.url()).origin === base.origin)
      errors.push(`Failed asset: ${req.url()}`);
  });
  // Keep provider availability out of the hosting check; exercise real parsers.
  await page.route("https://**/*", (route) => route.abort());
  await biologyRoutes(page);
  await page.goto("./");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mapping-coverage")).toContainText("223 / 223");
  await expect(page.locator(".version")).toHaveText(`v${pkg.version}`);
  await expect(page.locator(".phase-badge")).toContainText(
    "EXPLORE · ANALYZE · COMPARE",
  );
  await expect(page.locator(".analysis-engine")).toHaveText(
    `Engine ${ENGINE_VERSION.replace(/^contacts-/, "")}`,
  );
  await expect(page.locator(".analysis-engine")).toHaveAttribute(
    "title",
    RULESET_VERSION,
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(assets.some((url) => /\/assets\/.*\.woff2?$/.test(url))).toBe(true);
  expect(assets.some((url) => /\/assets\/.*\.css$/.test(url))).toBe(true);
  expect(assets.some((url) => /\/assets\/adapter-.*\.js$/.test(url))).toBe(
    true,
  );
  expect(assets).toContain(`${base.pathname}structures/3PTB.cif`);

  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toBeVisible();
  expect(
    workers.some((url) =>
      new URL(url).pathname.startsWith(`${base.pathname}assets/siftsWorker-`),
    ),
  ).toBe(true);
  expect(
    workers.some((url) =>
      new URL(url).pathname.startsWith(`${base.pathname}assets/worker-`),
    ),
  ).toBe(true);
  // The second bundled example must resolve under the same deployment prefix.
  await page
    .getByRole("button", {
      name: "4HHB Human hemoglobin Four protein chains and heme groups",
    })
    .click();
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chain-button")).toHaveCount(4);
  expect(assets).toContain(`${base.pathname}structures/4HHB.cif`);
  expect(errors).toEqual([]);
});
