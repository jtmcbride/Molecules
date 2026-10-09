import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
async function biologyRoutes(page: Page) {
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
  await page.route("https://rest.uniprot.org/uniprotkb/*", async (route) => {
    const accession = route.request().url().split("/").at(-1)!;
    await route.fulfill({
      body: await readFile(`tests/fixtures/biology/${accession}`),
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
    });
  });
}
async function exportJson(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Interpretation JSON", exact: true })
    .click();
  return JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
}
test.beforeEach(async ({ page }) => {
  await biologyRoutes(page);
});
test("links computed ASP189, UniProt features, sequence tracks, 3D and evidence exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mapping-coverage")).toContainText("223 / 223");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toBeVisible();
  await page
    .getByRole("button", {
      name: /Inspect Salt-bridge candidate with ASP A:189/,
    })
    .click();
  await expect(page.getByTestId("residue-biology")).toContainText(
    "194 · exact",
  );
  await expect(page.getByTestId("residue-biology")).toContainText(
    "Binding site",
  );
  await expect(page.getByTestId("binding-site-summary")).toContainText(
    "17 / 17",
  );
  await page
    .getByRole("button", {
      name: "Inspect Active site UniProt 200",
      exact: true,
    })
    .click();
  await expect(page.locator(".residue-identity")).toContainText("195");
  await expect(page.getByTestId("residue-biology")).toContainText(
    "200 · exact",
  );
  await expect(
    page.locator('.sequence-residue[data-selected="true"]'),
  ).toHaveAttribute("aria-label", /label 177 author 195/);
  await page
    .getByRole("button", {
      name: "Evidence for Active site UniProt 200",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "No feature-level ECO evidence",
  );
  await expect(page.getByRole("dialog")).toContainText("SHA-256");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Mapped position label 177 UniProt 200",
      exact: true,
    })
    .click();
  await expect(page.locator(".residue-identity")).toContainText("SER");
  const json = await exportJson(page);
  expect(json.kind).toBe("molecular-interpretation");
  expect(
    json.interpretation.mappings.some(
      (m: { authSeqId: string; uniprotPosition: number }) =>
        m.authSeqId === "189" && m.uniprotPosition === 194,
    ),
  ).toBe(true);
  expect(
    json.analysis.interactions.some(
      (i: { type: string }) => i.type === "salt_bridge",
    ),
  ).toBe(true);
  expect(
    json.evidence.some((e: { kind: string }) => e.kind === "computed_geometry"),
  ).toBe(true);
  const csvDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Residue annotations CSV", exact: true })
    .click();
  const csv = await readFile((await (await csvDownload).path())!, "utf8");
  expect(csv).toContain("mapping_status");
  expect(csv).toContain('"P00760","194","exact","Binding site"');
  await page
    .getByRole("checkbox", { name: "Active site", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", {
      name: "Inspect Active site UniProt 200",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".analysis-summary")).toBeVisible();
  expect(errors).toEqual([]);
});
test("maps hemoglobin chains and assemblies to the correct protein records", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".protein-strip")).toContainText("P69905");
  await page.getByRole("button", { name: /^Chain B / }).click();
  await expect(page.locator(".protein-strip")).toContainText("P68871");
  await expect(page.getByTestId("mapping-coverage")).toContainText("146 / 146");
  await page.selectOption('[aria-label="Biological assembly"]', "1");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  const json = await exportJson(page);
  expect(json.interpretation.coverage).toHaveLength(4);
  for (const chain of json.structure.chains.filter(
    (c: { type: string }) => c.type === "polymer",
  )) {
    const mapped = json.interpretation.mappings.filter(
      (m: { chainInstanceId: string }) => m.chainInstanceId === chain.id,
    );
    expect(
      new Set(mapped.map((m: { accession: string }) => m.accession)),
    ).toEqual(
      new Set(["A", "C"].includes(chain.authAsymId) ? ["P69905"] : ["P68871"]),
    );
  }
});
test("restores pinned interpretation and analysis without scientific requests and refreshes into a new revision", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Inspect Active site UniProt 200",
      exact: true,
    })
    .click();
  const original = await exportJson(page);
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByText(/Session saved in this browser/)).toBeVisible();
  await page.route("https://www.ebi.ac.uk/**", (route) => route.abort());
  await page.route("https://ftp.ebi.ac.uk/**", (route) => route.abort());
  await page.route("https://rest.uniprot.org/**", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByText("Restored pinned interpretation", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".analysis-summary")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Mapped position label 177 UniProt 200",
      exact: true,
    }),
  ).toHaveClass(/selected/);
  const restored = await exportJson(page);
  expect(restored.interpretation).toEqual(original.interpretation);
  expect(restored.analysis).toEqual(original.analysis);
  await page
    .getByRole("button", { name: "Refresh annotations", exact: true })
    .click();
  await expect(page.locator('.biology-panel [role="alert"]')).toBeVisible();
  expect((await exportJson(page)).interpretation.id).toBe(
    original.interpretation.id,
  );
  await page.unroute("https://www.ebi.ac.uk/**");
  await page.unroute("https://ftp.ebi.ac.uk/**");
  await page.unroute("https://rest.uniprot.org/**");
  await page.route(
    "https://rest.uniprot.org/uniprotkb/P00760.json",
    async (route) => {
      const raw = JSON.parse(
        await readFile("tests/fixtures/biology/P00760.json", "utf8"),
      );
      raw.features.find(
        (a: { type: string; location: { start: { value: number } } }) =>
          a.type === "Active site" && a.location.start.value === 200,
      ).description = "Refreshed test annotation";
      await route.fulfill({ json: raw });
    },
  );
  await page
    .getByRole("button", { name: "Refresh annotations", exact: true })
    .click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  const refreshed = await exportJson(page);
  expect(refreshed.interpretation.id).not.toBe(original.interpretation.id);
  expect(refreshed.analysis).toEqual(original.analysis);
  expect(
    refreshed.interpretation.annotations.some(
      (a: { description: string }) =>
        a.description === "Refreshed test annotation",
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByText("Restored pinned interpretation", { exact: true }),
  ).toBeVisible();
  expect((await exportJson(page)).interpretation.id).toBe(
    original.interpretation.id,
  );
});
test("annotation failures preserve exploration and local files require validated explicit association", async ({
  page,
}) => {
  await page.route("https://www.ebi.ac.uk/**", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.biology-panel [role="alert"]')).toBeVisible();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toBeVisible();
  await page.unroute("https://www.ebi.ac.uk/**");
  const localRequests: string[] = [];
  page.on("request", (request) => {
    if (/ebi.ac.uk|uniprot.org/.test(request.url()))
      localRequests.push(request.url());
  });
  await page
    .locator("input[type=file]")
    .setInputFiles(path.resolve("public/structures/3PTB.cif"));
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".biology-panel")).toContainText(
    "No validated protein mapping",
  );
  await expect(page.locator(".protein-strip")).toHaveCount(0);
  expect(localRequests).toEqual([]);
  await page
    .getByRole("textbox", { name: "Annotation PDB association" })
    .fill("3PTB");
  await page
    .getByRole("button", { name: "Validate & load", exact: true })
    .click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mapping-coverage")).toContainText("223 / 223");
  await page
    .locator("input[type=file]")
    .setInputFiles(path.resolve("tests/fixtures/identity-edge-cases.cif"));
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Validate & load", exact: true })
    .click();
  await expect(page.locator('.biology-panel [role="alert"]')).toContainText(
    "No SIFTS protein mapping",
  );
  await expect(page.locator(".protein-strip")).toHaveCount(0);
});
test("late annotation responses cannot overwrite another structure and tracks fit a phone", async ({
  page,
}) => {
  await page.route(
    "https://ftp.ebi.ac.uk/pub/databases/msd/sifts/xml/3ptb.xml.gz",
    async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route
        .fulfill({
          body: await readFile("tests/fixtures/biology/3ptb-sifts.xml.gz"),
          contentType: "application/gzip",
        })
        .catch(() => {});
    },
  );
  await page.goto("/");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".protein-strip")).toContainText("P69905");
  await expect(page.locator(".protein-strip")).not.toContainText("P00760");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".biology-panel").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(page.locator(".annotation-track-scroll")).toBeVisible();
});

test("ambiguous track positions do not select another residue from the feature range", async ({
  page,
}) => {
  // Synthetic duplicate of SIFTS label171: the normal 194–195 feature still
  // contains an exact observed neighbor, but that neighbor is not this position.
  await page.route(
    "https://ftp.ebi.ac.uk/pub/databases/msd/sifts/xml/3ptb.xml.gz",
    async (route) => {
      const xml = gunzipSync(
        await readFile("tests/fixtures/biology/3ptb-sifts.xml.gz"),
      ).toString();
      const residue = xml.match(
        /<residue dbSource="PDBe" dbCoordSys="PDBe" dbResNum="171"[\s\S]*?<\/residue>/,
      )![0];
      await route.fulfill({
        body: gzipSync(
          xml.replace(
            residue,
            residue +
              residue.replace(
                'dbSource="UniProt" dbCoordSys="UniProt" dbAccessionId="P00760" dbResNum="194"',
                'dbSource="UniProt" dbCoordSys="UniProt" dbAccessionId="P00760" dbResNum="195"',
              ),
          ),
        ),
        contentType: "application/gzip",
      });
    },
  );
  await page.goto("/");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mapping-coverage")).toContainText(
    "1 ambiguous",
  );
  await page
    .getByRole("button", {
      name: "Residue ASP label 171 author 189",
      exact: true,
    })
    .click();
  await expect(page.locator(".residue-identity")).toContainText("189");
  await page
    .getByRole("button", { name: "Binding site at label 171", exact: true })
    .click();
  await expect(
    page.locator('.sequence-residue[data-selected="true"]'),
  ).toHaveCount(0);
  await expect(page.locator(".residue-identity")).toHaveCount(0);
  await expect(page.getByTestId("selected-annotation")).toContainText(
    "194–195",
  );
});
