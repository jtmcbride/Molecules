import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fixtureRoutes } from "./helpers/comparison";
test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", (r) => r.abort());
  await fixtureRoutes(page);
});
async function setup(page: Page, id = "1S0R") {
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Comparison PDB ID").fill(id);
  await page
    .getByRole("button", { name: "Add structure", exact: true })
    .click();
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  return slot;
}
async function exported(page: Page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export pose JSON", exact: true })
    .click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
async function occupancySettings(page: Page) {
  const toggle = page.getByRole("button", {
    name: "Show calculation settings & assumptions",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(
    page.getByText(
      "Session saved in this browser. It will reopen the next time you visit.",
      { exact: true },
    ),
  ).toBeVisible();
}
async function clearTable(page: Page, table: string) {
  await page.evaluate(async (table) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("molecular-explorer");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction(table, "readwrite");
        tx.objectStore(table).clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, table);
}
test("pose without interaction analysis exports full provenance, highlights atom pairs and recomputes for fit/occupancy", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const slot = await setup(page),
    pose = slot.getByTestId("ligand-pose");
  await pose
    .getByRole("button", { name: "Calculate pose", exact: true })
    .click();
  await expect(pose.getByTestId("pose-rmsd")).toContainText("1.081");
  let json = await exported(page);
  expect(json.schemaVersion).toBe(2);
  expect(json.comparisonVersion).toBe("comparison-1.2.0");
  const record = json.structures[0].pose;
  expect(record.result.pairs).toHaveLength(9);
  expect(record.input.reference.positions).toHaveLength(27);
  expect(
    record.chemistry.every(
      (s: { available: boolean; contentHash: string }) =>
        s.available && s.contentHash.length === 64,
    ),
  ).toBe(true);
  expect(json.reference.analysisCacheKey).toBeUndefined();
  expect(json.fingerprint).toBeNull();
  await pose.getByText("Inspect 9 atom pairs", { exact: true }).click();
  await pose.getByRole("button", { name: /^Inspect N1 to / }).click();
  await expect(page.getByTestId("investigation-pose")).toContainText("N1");
  await slot.screenshot({ path: "test-results/pose-desktop.png" });
  await page
    .locator("canvas")
    .screenshot({ path: "test-results/pose-atom-highlight.png" });
  await slot.getByLabel("Superposition of 1S0R").selectOption("binding_site");
  await expect(pose.getByTestId("pose-rmsd")).toContainText("1.076");
  await expect(page.getByTestId("investigation-pose")).toHaveCount(0);
  await occupancySettings(page);
  await page.getByLabel("Minimum occupancy", { exact: true }).fill("0.2");
  await expect(pose).toHaveAttribute("data-phase", "ready");
  json = await exported(page);
  expect(json.structures[0].pose.input.reference.minimumOccupancy).toBe(0.2);
  expect(json.structures[0].pose.input.comparison.minimumOccupancy).toBe(0.2);
  await pose
    .getByRole("button", { name: "Recalculate pose", exact: true })
    .click();
  await expect(pose.getByTestId("pose-mode")).toContainText("cached");
  await slot.getByRole("button", { name: "Hide 1S0R" }).click();
  await expect(pose.getByTestId("pose-rmsd")).toContainText("1.076");
  await page.setViewportSize({ width: 390, height: 844 });
  await slot.screenshot({ path: "test-results/pose-phone.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("saved schema 4 restores exact pose settings and results without coordinate, chemistry or biological requests", async ({
  page,
}) => {
  const slot = await setup(page),
    pose = slot.getByTestId("ligand-pose");
  await occupancySettings(page);
  await page.getByLabel("Minimum occupancy", { exact: true }).fill("0.2");
  await pose
    .getByRole("button", { name: "Calculate pose", exact: true })
    .click();
  await expect(pose).toHaveAttribute("data-phase", "ready");
  const before = await exported(page);
  await save(page);
  const requests: string[] = [];
  await page.route(
    /https:\/\/(www\.ebi|ftp\.ebi|rest\.uniprot|files\.rcsb)/,
    (route) => {
      requests.push(route.request().url());
      return route.abort();
    },
  );
  await page.reload();
  const restored = page.getByTestId("ligand-pose");
  await expect(restored.getByTestId("pose-mode")).toContainText(
    "Restored exact saved result",
  );
  await occupancySettings(page);
  expect(
    await page.getByLabel("Minimum occupancy", { exact: true }).inputValue(),
  ).toBe("0.2");
  const after = await exported(page);
  expect(after.structures[0].pose.result).toEqual(
    before.structures[0].pose.result,
  );
  expect(after.structures[0].pose.input).toEqual(
    before.structures[0].pose.input,
  );
  expect(requests).toEqual([]);
});
for (const table of ["ligandPoses", "poseChemistry"])
  test(`missing ${table} pins restore unavailable without requests`, async ({
    page,
  }) => {
    const slot = await setup(page),
      pose = slot.getByTestId("ligand-pose");
    await pose
      .getByRole("button", { name: "Calculate pose", exact: true })
      .click();
    await expect(pose).toHaveAttribute("data-phase", "ready");
    await page
      .getByRole("button", { name: "Save session", exact: true })
      .click();
    await clearTable(page, table);
    const requests: string[] = [];
    await page.route(
      /https:\/\/(www\.ebi|ftp\.ebi|rest\.uniprot|files\.rcsb)/,
      (route) => {
        requests.push(route.request().url());
        return route.abort();
      },
    );
    await page.reload();
    const restored = page.getByTestId("ligand-pose");
    await expect(restored).toHaveAttribute("data-phase", "unavailable");
    await expect(restored.getByTestId("pose-rmsd")).toHaveCount(0);
    expect(requests).toEqual([]);
    if (table === "ligandPoses") {
      await restored
        .getByRole("button", { name: "Recalculate pose", exact: true })
        .click();
      await expect(restored).toHaveAttribute("data-phase", "ready");
      expect(requests).toEqual([]);
    }
  });
test("cancels pending chemistry and ignores late replies after removing the comparison", async ({
  page,
}) => {
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "https://files.rcsb.org/ligands/download/BEN.cif",
    async (route) => {
      await delayed;
      try {
        await route.fulfill({
          body: await readFile("tests/fixtures/BEN-ccd.cif"),
          contentType: "text/plain",
        });
      } catch {
        /* request was cancelled */
      }
    },
  );
  const slot = await setup(page),
    pose = slot.getByTestId("ligand-pose");
  await pose
    .getByRole("button", { name: "Calculate pose", exact: true })
    .click();
  await expect(pose).toHaveAttribute("data-phase", "preparing");
  await pose.getByRole("button", { name: "Cancel pose", exact: true }).click();
  await expect(pose).toHaveAttribute("data-phase", "cancelled");
  await pose
    .getByRole("button", { name: "Recalculate pose", exact: true })
    .click();
  await slot.getByRole("button", { name: "Remove 1S0R" }).click();
  release();
  await expect(page.getByTestId("comparison-slot")).toHaveCount(0);
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
});
test("requires one explicit coherent alternate and then calculates that conformer", async ({
  page,
}) => {
  const raw = gunzipSync(
    await readFile("tests/fixtures/biology/1S0R.cif.gz"),
  ).toString();
  const synthetic = raw
    .split("\n")
    .map((line) => {
      if (!line.startsWith("HETATM")) return line;
      const cols = line.trim().split(/\s+/);
      if (cols[5] !== "BEN") return line;
      cols[4] = "A";
      return cols.join(" ");
    })
    .join("\n");
  await page.route("https://files.rcsb.org/download/1S0R.cif", (route) =>
    route.fulfill({ body: synthetic, contentType: "chemical/x-mmcif" }),
  );
  const slot = await setup(page),
    pose = slot.getByTestId("ligand-pose");
  await pose
    .getByRole("button", { name: "Calculate pose", exact: true })
    .click();
  await expect(pose.getByTestId("pose-status")).toContainText(
    "coherent alternate conformer",
  );
  await pose.getByLabel("Comparison pose conformer for 1S0R").selectOption("A");
  await expect(pose).toHaveAttribute("data-phase", "ready");
  const data = await exported(page);
  expect(data.structures[0].pose.input.comparison.conformerId).toBe("A");
});
test("HEM remains explicitly unavailable while the hemoglobin comparison stays usable", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Comparison PDB ID").fill("1HHO");
  await page
    .getByRole("button", { name: "Add structure", exact: true })
    .click();
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  const pose = slot.getByTestId("ligand-pose");
  await pose
    .getByRole("button", { name: "Calculate pose", exact: true })
    .click();
  await expect(pose.getByTestId("pose-status")).toContainText(
    "Metal-containing",
  );
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
});
