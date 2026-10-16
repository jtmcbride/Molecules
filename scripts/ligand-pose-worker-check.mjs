/** Builds a test-only entry with production Vite worker bundling at a subpath, then runs
 * independent fixture scores and cancellation through real Chromium module workers.
 * The temporary artifact is separate from dist; no product controls are added by M4-B.
 */
import { build, preview } from "vite";
import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "molecules-pose-worker-"));
let server, browser;
try {
  await build({
    configFile: false,
    root: process.cwd(),
    base: "/pose-check/",
    logLevel: "warn",
    build: {
      outDir: directory,
      emptyOutDir: true,
      rollupOptions: {
        input: resolve("tests/fixtures/ligand-pose/worker.html"),
      },
    },
  });
  server = await preview({
    configFile: false,
    root: process.cwd(),
    base: "/pose-check/",
    build: { outDir: directory },
    preview: { host: "127.0.0.1", port: 4182, strictPort: true },
  });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage(),
    errors = [],
    workers = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("worker", (w) => workers.push(w.url()));
  await page.goto(
    "http://127.0.0.1:4182/pose-check/tests/fixtures/ligand-pose/worker.html",
  );
  await page.waitForFunction(() => "poseWorkerCheck" in window);
  const result = await page.evaluate(() => window.poseWorkerCheck);
  if (errors.length) throw Error(errors.join("\n"));
  if (
    !workers.length ||
    workers.some((url) => !url.includes("/pose-check/assets/ligandPoseWorker-"))
  )
    throw Error("Unexpected worker bundle path");
  console.log(
    JSON.stringify(
      { ...result, workers: workers.length, basePath: "/pose-check/" },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
