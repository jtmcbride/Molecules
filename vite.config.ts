import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const basePath = process.env.VITE_BASE_PATH || "/";
if (
  !/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(basePath) ||
  basePath.split("/").some((part) => part === "." || part === "..")
) {
  throw new Error(
    "VITE_BASE_PATH must be an absolute path with a trailing slash, e.g. /Molecules/.",
  );
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "release-metadata",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-info.json",
          source: JSON.stringify(
            {
              schemaVersion: 1,
              version,
              basePath,
              commit: process.env.GITHUB_SHA || null,
            },
            null,
            2,
          ),
        });
      },
    },
  ],
  base: basePath,
  define: { __APP_VERSION__: JSON.stringify(version) },
  optimizeDeps: {
    entries: [
      "index.html",
      "src/analysis/worker.ts",
      "src/biology/siftsWorker.ts",
    ],
  },
  server: { host: "0.0.0.0" },
  build: { chunkSizeWarningLimit: 4000 },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
