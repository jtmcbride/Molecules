import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

// Always serve a completed build; reject a mismatched artifact before launching.
const build = JSON.parse(
  readFileSync(new URL("./dist/build-info.json", import.meta.url), "utf8"),
);
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const basePath =
  process.env.PLAYWRIGHT_BASE_PATH ||
  process.env.VITE_BASE_PATH ||
  build.basePath;
if (
  build.schemaVersion !== 1 ||
  build.basePath !== basePath ||
  build.version !== version ||
  (process.env.GITHUB_SHA && build.commit !== process.env.GITHUB_SHA)
) {
  throw new Error(
    "The browser test context does not match dist/build-info.json. Build the requested path/commit before running test:e2e:built.",
  );
}
const origin = new URL(
  process.env.PLAYWRIGHT_ORIGIN || "http://127.0.0.1:4173",
);
if (
  origin.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
) {
  throw new Error(
    "PLAYWRIGHT_ORIGIN must be a local HTTP origin, e.g. http://127.0.0.1:4173.",
  );
}
const baseURL = new URL(basePath, origin).href;

export default defineConfig({
  testDir: "./tests/e2e",
  // Software WebGL is CPU-bound; parallel browsers compete for the CI renderer.
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command: `npm run preview -- --host ${origin.hostname} --port ${origin.port || "80"} --strictPort`,
    env: { VITE_BASE_PATH: basePath },
    url: baseURL,
    timeout: 30000,
    // A pre-existing server could serve a different build or base path.
    reuseExistingServer: false,
  },
});
