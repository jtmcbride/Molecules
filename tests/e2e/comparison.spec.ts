import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixtureRoutes } from "./helpers/comparison";
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
  await page.goto("./");
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
  await expect(
    slot.locator(".comparison-analysis-status[role=status]"),
  ).toContainText(/\d+ chemical interactions with \d+ residues · fresh/);
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
  await expect(
    slot.locator(".comparison-analysis-status[role=status]"),
  ).toContainText("cached");
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
  await page.goto("./");
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
  await expect(
    slot.locator(".comparison-analysis-status[role=status]"),
  ).toContainText("Choose a ligand");
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
  await page.goto("./");
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
  await page.goto("./");
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
  expect(json.schemaVersion).toBe(2);
  expect(json.comparisonVersion).toBe("comparison-1.2.0");
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

const AMINO_ACIDS = new Set(
  "ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL".split(
    " ",
  ),
);
/** Canvas fractions from the centre outwards, so a hit near the middle is found first. */
const SCAN = Array.from({ length: 13 * 13 }, (_, i) => ({
  fx: 0.2 + (i % 13) * 0.05,
  fy: 0.2 + Math.floor(i / 13) * 0.05,
})).sort(
  (a, b) =>
    Math.hypot(a.fx - 0.5, a.fy - 0.5) - Math.hypot(b.fx - 0.5, b.fy - 0.5),
);
/**
 * Clicks the canvas from the centre outwards until the selection is a paired amino acid of
 * the comparison structure `label`; returns the point and residue name. The camera is reset
 * and zoomed onto the superposed pair first, so the scan does not depend on where earlier
 * steps left the view. Clicks pick synchronously; hover picking is asynchronous and proved
 * unreliable under software WebGL on CI runners.
 */
async function pickComparisonResidue(page: Page, label: string) {
  const canvas = page.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Reset camera" }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Let the reset animation finish before zooming.
  await page.waitForTimeout(1000);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(800);
  const card = page.getByTestId("investigation");
  const outcomes: Record<string, number> = {};
  for (const { fx, fy } of SCAN) {
    const x = box.x + box.width * fx,
      y = box.y + box.height * fy;
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    let outcome = "nothing selected";
    if (await card.count()) {
      const text = (await card.textContent()) ?? "";
      const side = card
        .getByRole("region", { name: label, exact: true })
        .locator(".investigation-residues");
      const component = (await side.count())
        ? (await side.textContent())?.trim().match(/^([A-Z0-9]{1,3}) /)?.[1]
        : undefined;
      if (
        text.includes(`COMPARISON · ${label}`) &&
        text.includes("paired · exact SIFTS") &&
        component &&
        AMINO_ACIDS.has(component)
      )
        return { x, y, component };
      outcome = `${label} ${component ?? "?"} not paired`;
    } else if (await page.locator(".residue-identity h2").count())
      outcome = "reference residue";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  throw new Error(
    `No paired ${label} residue picked: ${JSON.stringify(outcomes)}`,
  );
}

test("a residue picked in a comparison structure resolves to its own structure and SIFTS partner", async ({
  page,
}) => {
  // Two click scans under software WebGL.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  const target = page.getByLabel("Analysis target ligand");
  const targetBefore = await target.inputValue();
  await addComparison(page, "1S0R");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-mapping")).toContainText(
    "residues exactly mapped",
  );
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");

  const point = await pickComparisonResidue(page, "1S0R");
  const card = page.getByTestId("investigation");
  await expect(card).toContainText("COMPARISON · 1S0R");
  await expect(card).toContainText(`${point.component} `);
  await expect(card).toContainText("P00760");
  await expect(card).toContainText("paired · exact SIFTS");
  // The reference inspector follows the exactly corresponding reference residue.
  await expect(page.locator(".residue-identity h2")).toHaveText(
    point.component,
  );
  // Inspecting a comparison residue leaves the reference analysis target alone.
  await expect(target).toHaveValue(targetBefore);

  await slot.getByRole("button", { name: "Hide 1S0R" }).click();
  await expect(card).toContainText("1S0R is hidden");
  await slot.getByRole("button", { name: "Show 1S0R" }).click();
  await expect(card).not.toContainText("is hidden");

  // Empty space clears the investigation.
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await expect(card).toHaveCount(0);

  // Removing the structure clears an investigation of it.
  await pickComparisonResidue(page, "1S0R");
  await expect(card).toContainText("COMPARISON · 1S0R");
  await slot.getByRole("button", { name: "Remove 1S0R" }).click();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("fingerprint cells and binding-site rows open the comparison inspector from the keyboard", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  const summary = page.locator(".analysis-summary");
  await expect(summary).toContainText("Fresh result");
  const summaryBefore = await summary.textContent();
  const target = page.getByLabel("Analysis target ligand");
  const targetBefore = await target.inputValue();
  await addComparison(page, "1S0R");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  await slot.getByRole("button", { name: "Analyze" }).click();
  const fingerprint = page.getByTestId("fingerprint");
  await expect(
    fingerprint.getByTestId("fingerprint-column").nth(1),
  ).toContainText("Tanimoto 1.00");

  // A water-mediated interaction present in both structures, opened from the keyboard.
  const bridge = fingerprint.getByRole("button", {
    name: /^Inspect 1S0R A · 216 · .*Water-bridge candidate: present$/,
  });
  await bridge.focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByTestId("investigation");
  await expect(inspector).toContainText("Fingerprint · Water-bridge candidate");
  await expect(bridge).toHaveAttribute("aria-pressed", "true");
  // Each side draws its own bridge, water included; nothing is guessed.
  const reference = inspector.getByRole("region", { name: "Reference · 3PTB" });
  const comparison = inspector.getByRole("region", { name: "1S0R" });
  for (const side of [reference, comparison]) {
    await expect(side.getByTestId("investigation-cell")).toHaveText(
      "Fingerprint: present",
    );
    const drawn = side.locator(".investigation-interaction[aria-pressed=true]");
    await expect(drawn).toHaveCount(1);
    await expect(drawn).toContainText("Water-bridge candidate");
    await expect(drawn).toContainText("via HOH");
  }
  await expect(inspector.getByTestId("sequence-strip")).toHaveAttribute(
    "aria-label",
    /UniProt P00760 216: reference \w+, 1S0R \w+$/,
  );

  // A cell with several interactions lists them all; another one can be drawn.
  const hbond = fingerprint.getByRole("button", {
    name: /^Inspect 1S0R A · 194 · ASP 189 H-bond candidate: present$/,
  });
  await hbond.focus();
  await page.keyboard.press("Enter");
  await expect(inspector).toContainText("Fingerprint · H-bond candidate");
  const options = reference.locator(".investigation-interaction");
  expect(await options.count()).toBeGreaterThan(1);
  await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");
  await options.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(options.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(options.nth(1)).toContainText("drawn");

  // A binding-site row, from the keyboard; Gln192 (UniProt 197) changes rotamer.
  const site = slot.getByTestId("comparison-site");
  await site.locator("summary").focus();
  await page.keyboard.press("Enter");
  const row = site.getByRole("button", { name: /^Inspect UniProt 197:/ });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(inspector).toContainText("Binding-site residue");
  await expect(row).toHaveAttribute("aria-pressed", "true");
  const details = inspector.getByTestId("investigation-site");
  await expect(details).toContainText("rotamer change");
  const global = await details.textContent();
  // Refitting on the binding site re-resolves the same residues with new geometry.
  await slot.getByLabel("Superposition of 1S0R").selectOption("binding_site");
  await expect(details).not.toHaveText(global!);
  await expect(inspector).toContainText("GLN 192");
  await expect(row).toHaveAttribute("aria-pressed", "true");

  // Inspecting comparisons never changed the reference analysis.
  await expect(target).toHaveValue(targetBefore);
  await expect(summary).toHaveText(summaryBefore!);
  expect(errors).toEqual([]);
});

test("a gained or lost interaction is drawn only in the structure that forms it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByText("Structure ready", { exact: true }),
  ).toBeVisible();
  await page.locator(".example-button").nth(1).click();
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Analysis target ligand")
    .selectOption({ label: "HEM A:142" });
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toContainText("Fresh result");
  await addComparison(page, "1HHO");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  await slot
    .getByLabel("Comparison ligand for 1HHO")
    .selectOption({ label: "HEM A:143" });
  await slot.getByRole("button", { name: "Analyze" }).click();
  const fingerprint = page.getByTestId("fingerprint");
  await expect(
    fingerprint.getByTestId("fingerprint-column").nth(1),
  ).toContainText("Tanimoto");
  // His58 π-stacks with the heme in deoxy 4HHB but not in oxy 1HHO.
  const cell = fingerprint.getByRole("button", {
    name: /^Inspect 1HHO A · 59 · HIS 58 π-stacking: absent/,
  });
  await cell.focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByTestId("investigation");
  const reference = inspector.getByRole("region", { name: "Reference · 4HHB" });
  const comparison = inspector.getByRole("region", { name: "1HHO" });
  await expect(reference.getByTestId("investigation-cell")).toContainText(
    "Fingerprint: present",
  );
  await expect(
    reference.locator(".investigation-interaction[aria-pressed=true]"),
  ).toContainText("π-stacking");
  // Both residues are selected; the absent side states it and draws nothing.
  await expect(comparison).toContainText("HIS 58 · chain A");
  await expect(comparison.getByTestId("investigation-cell")).toContainText(
    "Fingerprint: absent",
  );
  await expect(comparison).toContainText("nothing is drawn");
  await expect(comparison.locator(".investigation-interaction")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("rows of an assembly copy resolve to that chain instance", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  await page.locator("#pdb-id").fill("1HHO");
  await page.getByRole("button", { name: "Load PDB structure" }).click();
  await expect(page.locator(".pdb-badge")).toHaveText("1HHO");
  await page.getByLabel("Biological assembly").selectOption("1");
  await expect(page.locator(".chain-button")).toHaveCount(4);
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  // The heme of the second copy (operator ASM-2) of the αβ dimer.
  await page
    .getByLabel("Analysis target ligand")
    .selectOption({ label: "HEM A:143 · ASM-2" });
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toContainText("Fresh result");
  await addComparison(page, "4HHB");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  // 4HHB chain C pairs with the copy of chain A (chain order); compare its heme.
  await expect(
    slot.getByLabel("Partner of reference chain A (ASM-2) (P69905) in 4HHB"),
  ).toHaveValue(/"C"/);
  await slot
    .getByLabel("Comparison ligand for 4HHB")
    .selectOption({ label: "HEM C:142" });
  await slot.getByRole("button", { name: "Analyze" }).click();
  const fingerprint = page.getByTestId("fingerprint");
  await expect(
    fingerprint.getByTestId("fingerprint-column").nth(1),
  ).toContainText("Tanimoto");
  // Rows name the operator, because both copies share author chain A.
  const cell = fingerprint.getByRole("button", {
    name: /^Inspect 4HHB A \(ASM-2\) · 88 · HIS 87 Metal candidate: present/,
  });
  await cell.focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByTestId("investigation");
  await expect(
    inspector.getByRole("region", { name: "Reference · 1HHO" }),
  ).toContainText("HIS 87 · chain A · ASM-2");
  await expect(inspector.getByRole("region", { name: "4HHB" })).toContainText(
    "HIS 87 · chain C",
  );
  // The reference inspector follows the copy's residue, not chain A of the first copy.
  await expect(page.locator(".identity-tags")).toContainText("Chain A");
  await expect(
    page.locator(".property-list", { hasText: "Assembly operator" }),
  ).toContainText("Assembly operatorASM-2");
  expect(errors).toEqual([]);
});

test("section navigation and the comparison inspector work from the keyboard on a phone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByText("Protein annotations ready", { exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Workspace sections" });
  // Navigation never leaves the expanded viewer; it is hidden until the view is closed.
  await page.getByRole("button", { name: "Expand molecular view" }).click();
  await expect(nav).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(nav).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.locator(".analysis-summary")).toContainText("Fresh result");
  const comparisonLink = nav.getByRole("link", { name: "Comparison" });
  await comparisonLink.focus();
  await page.keyboard.press("Enter");
  const comparisonPanel = page.locator("#comparison");
  await expect(comparisonPanel).toBeFocused();
  await expect(comparisonPanel).toBeInViewport();
  await addComparison(page, "1S0R");
  const slot = page.getByTestId("comparison-slot");
  await expect(slot.getByTestId("comparison-fit")).toContainText("Core RMSD");
  await slot.getByRole("button", { name: "Analyze" }).click();
  const cell = page.getByRole("button", {
    name: /^Inspect 1S0R A · 216 · .*Water-bridge candidate: present$/,
  });
  await cell.focus();
  await page.keyboard.press("Enter");
  await nav.getByRole("link", { name: "Inspector" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector")).toBeFocused();
  const inspector = page.getByTestId("investigation");
  await expect(inspector).toBeInViewport();
  await expect(inspector).toContainText("Fingerprint · Water-bridge candidate");
  // The drawn interaction can be changed from the keyboard inside the inspector.
  const drawn = inspector.locator(".investigation-interaction").first();
  await drawn.focus();
  await expect(drawn).toBeFocused();
  const widths = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(
      '[data-testid="investigation"]',
    )!;
    return {
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      card: card.scrollWidth,
      cardBox: card.clientWidth,
    };
  });
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.card).toBeLessThanOrEqual(widths.cardBox);
  expect(errors).toEqual([]);
});
