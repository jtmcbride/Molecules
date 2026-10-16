# Production artifact and release validation

M1 implementation, 2026-10-13; local package 0.6.0 (M1–M4, including ligand pose UI/results), 2026-10-15. Comparison semantics are `comparison-1.2.0`, comparison JSON schema 2 and saved sessions schema 4. Interaction/biology methods and numerical regression outputs are unchanged. Broader pose-family validation and performance calibration remain release gates; no M4 deployment is claimed.

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
4. Open 4HHB, select the beta-chain heme, run interaction analysis, and use the protein variant table to search E7V, inspect each chain, and check the independent contact filters. Explicitly request P68871 carrier lookup, confirm a fresh RCSB sequence-coordinates POST succeeds from the deployed origin, then open a listed carrier such as 2HBS as a comparison. Confirm the reference and comparison remain usable independently.
5. With 3PTB analyzed, add and analyze `1S0R`. From the keyboard, open the water-bridge cell at UniProt 216 and a binding-site row. Confirm by eye that both residues are highlighted on the superposed 1S0R cartoon (not at its deposited position), that one dashed interaction per structure is drawn through its water, that switching the superposition scope moves the 1S0R highlight and line with the cartoon, and that hiding 1S0R removes its cartoon, highlight and line while the reference line stays. Toggle water on and off. Browser tests check the resolved selection and drawn-interaction choice but cannot see the rendered scene.
6. With 3PTB and 1S0R paired, calculate the BEN pose without interaction analysis. Confirm a fresh CCD definition request succeeds from the deployed origin; inspect a paired atom and its displacement after the selected protein fit, then switch fit scope. HEM must report unavailable while comparison remains usable.
7. Save the session and reload. Confirm the pinned interpretation, lookup and analyses restore without new scientific requests. Explicit refresh should create a new revision rather than relabel the saved one as fresh.
8. Block scientific-provider requests and reopen bundled examples. Confirm the geometry workflow survives provider failure and annotations/lookup failures explain their availability state.

Attach observed failures, not just a pass/fail headline: failing URL, request method, HTTP status/CORS message, and the unaffected workflows. These checks verify deployed integration on that date; frozen fixtures remain the reproducible scientific evidence.

## Evidence for this implementation

For M4-C, 286 unit/scientific tests, source/test formatting, type checking, root/subpath builds, root hosting smoke and all 47 browser workflows at `/Molecules/` passed locally (2026-10-15). Desktop/390px and atom-selection screenshots were reviewed. Local verification details are recorded in the M1–M4 implementation records in `docs/NEXT_DEVELOPMENT_PLAN.md`. GitHub Actions execution and the post-deployment checklist are separate checks; editing the workflows does not demonstrate a successful hosted deployment.
