# Production artifact and release validation

M1 implementation, 2026-10-13. Application package remains 0.5.0 until the planned M2 release. Scientific versions and calculation semantics are unchanged.

## Automated gate

Both PR/branch validation and Pages deployment call `.github/workflows/validate.yml` at the calling revision. It requires an explicit deployment base path and runs formatting, deterministic scientific tests, a root-path production smoke check when needed, and the complete browser suite at the deployment path. Browser tests use one worker and software WebGL.

The root smoke build is discarded. The final deployment build is tested without rebuilding and uploaded as `validated-site` only after the full gate succeeds. Pages depends on that gate, downloads its artifact from the same run, and uploads/deploys those bytes. Manual dispatch uses the same dependency. Validation has read-only repository permissions; only the deployment job receives Pages write and identity-token permissions.

`build-info.json` contains schema version, package version, base path, and `GITHUB_SHA` when built in CI. The Playwright configuration reads it before starting and refuses a different requested path, package version, or CI commit. The smoke test also checks the metadata served by the preview server against the local artifact. A server already occupying the requested origin causes a failure rather than reuse.

The hosting smoke test uses frozen biological responses and real application parsers. It verifies both bundled structures, lazy Mol* rendering code, loaded font/CSS assets, successful SIFTS worker mapping, interaction worker computation, release labels, and successful local asset responses under the selected prefix. Live provider availability is not a prerequisite for this deterministic check.

## Local reproduction

Install dependencies and the Playwright Chromium runtime as described in README. The convenient command builds and tests root hosting:

```sh
npm run test:e2e
```

To reproduce the gate with a repository path (use the actual repository name/case):

```sh
npm run format:check
npm test
VITE_BASE_PATH=/ npm run build
PLAYWRIGHT_BASE_PATH=/ npm run test:e2e:built -- deployment.spec.ts
VITE_BASE_PATH=/Molecules/ npm run build
PLAYWRIGHT_BASE_PATH=/Molecules/ npm run test:e2e:built
```

`test:e2e:built` requires an existing build with `build-info.json`; it never builds implicitly. A different local port can be selected with `PLAYWRIGHT_ORIGIN=http://127.0.0.1:4180`. Set `PLAYWRIGHT_CHROMIUM_PATH` for a system Chromium when necessary. Do not rebuild `dist` while browser tests are running.

## Manual post-deployment checklist

Run this after a successful deployment in a fresh browser profile or after clearing this site's storage. Existing pinned/cache responses cannot establish that live endpoints still work. Record deployment commit, URL/base path, browser/version, date, and the result of each check.

1. Read the deployed `build-info.json` and confirm its commit matches the successful workflow, its base path matches the deployed URL, and the visible app version matches the package.
2. Open both bundled examples. Check scene rendering and the browser network/console for missing local JS, CSS, fonts, favicon, coordinates, or worker scripts. Confirm asset requests remain under the deployment prefix.
3. Open public PDB entry `1S0R` by accession. Verify live coordinate retrieval, exact SIFTS correspondence and UniProt protein/feature loading. Record any provider's HTTP/CORS error separately from local asset failures; optional metadata/validation unavailability should preserve exploration.
4. Open 4HHB, select the beta-chain heme, run interaction analysis, and inspect a curated variant. Explicitly request P68871 carrier lookup, confirm a fresh RCSB sequence-coordinates POST succeeds from the deployed origin, then open a listed carrier such as 2HBS as a comparison. Confirm the reference and comparison remain usable independently.
5. Save the session and reload. Confirm the pinned interpretation, lookup and analyses restore without new scientific requests. Explicit refresh should create a new revision rather than relabel the saved one as fresh.
6. Block scientific-provider requests and reopen bundled examples. Confirm the geometry workflow survives provider failure and annotations/lookup failures explain their availability state.

Attach observed failures, not just a pass/fail headline: failing URL, request method, HTTP status/CORS message, and the unaffected workflows. These checks verify deployed integration on that date; frozen fixtures remain the reproducible scientific evidence.

## Evidence for this implementation

Local verification results are recorded in the M1 implementation record in `docs/NEXT_DEVELOPMENT_PLAN.md`. GitHub Actions execution and the post-deployment checklist are separate checks; editing the workflows does not demonstrate a successful hosted deployment.
