# Browser processing security review — 2026-10-25

## Scope and deployment baseline

Reviewed main `61f8dfe2115eacbdff0559e7cd749910bcc1789b`: PDF/image input, PDF.js, OpenCV worker/WASM, DOM and output handling, runtime assets, npm lockfile and workflows. No `.agents/skills` or `AGENTS.md` instructions were present in this checkout. No other repository was changed.

The [public page](https://secidoire.github.io/music_sheet_tools/) returned HTTP 200 on 2026-10-25; its Last-Modified was 2026-10-18 03:15:17 UTC. The [successful Pages workflow](https://github.com/secidoire/music_sheet_tools/actions/runs/39092936726) has the same head SHA as main. The live HTML referenced `assets/index-BncR7pCF.js`. This identifies the deployment through workflow metadata; it is not a byte-for-byte comparison of the entire live artifact.

There were no open PRs at the initial read. Work was isolated on `security/browser-input-hardening`. Existing remote branches were preserved. `deploy.yml` deploys on main push or manual dispatch. The added PR validation workflow only builds/tests and has no deployment steps. No main push, merge, workflow dispatch, production mutation, credentials extraction or external AI review was performed.

## Findings and changes

| Finding | Impact and change |
| --- | --- |
| Unbounded file bytes/count and document page count | Local browser availability risk when opening attacker-supplied documents. Reject more than 100 files, 128 MiB combined input, or 200 combined PDF/image pages. Validate in shared source loading, including worker loads, and validate file budgets before resetting the current project. |
| Unbounded raster allocations, including PDF UserUnit and staff-driven rescaling | A small PDF can request enormous rasters despite tiling. Reject nonfinite/noninteger/zero dimensions, edges over 32768 pixels, or more than 80 million pixels before grayscale allocation and OpenCV resizing. Normal 600dpi A3 fits. Bound PDF.js temporary canvas create/reset in both main and processing threads. |
| Oversized embedded PDF images and swallowed rendering failures | Set PDF.js `maxImageSize` and `stopAtErrors: true`, with a narrowly scoped error-propagation patch described below, so images exceeding the limit cause visible failure rather than silently disappearing. Failed PDF loads destroy the loading task. XFA stays disabled. |
| Error visibility and partial export | Display errors on the empty screen and page errors as React text alerts. Refuse export if any page failed or has not completed analysis, preventing an incomplete document from being silently exported. |
| Popup opener retained | Clear the opener of the synchronous placeholder tab used by asynchronous PDF delivery; the fallback popup uses `noopener,noreferrer`. Output URLs contain newly generated PDFs rather than input bytes. |
| Known vulnerable development dependencies | Update Vite 8.3.1 to 8.3.5 and source-map-js 1.2.1 to 1.2.2 through compatible dependency updates, including their build-tool transitive dependencies. No audit exceptions or disabled checks. |

The limits are availability guardrails, not a complete CPU/memory sandbox. They intentionally reject documents previously accepted without bounds.

## Dependency/advisory assessment

Before changes, npm audit reported two high-severity affected packages (Vite and source-map-js). The advisory entries were checked against the actual lockfile and the official GitHub Advisory Database:

| Package and locked version | Official advisory | Applicability |
| --- | --- | --- |
| source-map-js 1.2.1 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | Indexed source-map offset DoS; build/development dependency, not shipped runtime API. Fixed at 1.2.2. |
| Vite 8.3.1 | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | Editor-launch argument/command injection, including Windows-specific conditions; local development server exposure, not the static Pages deployment. Updated to 8.3.5. |
| Vite 8.3.1 | [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) | Development middleware/script and filesystem boundary issues. No public Vite server was found in deployment configuration. Updated to 8.3.5. |
| pdfjs-dist 6.3.289 | [GHSA-wgrm-67xf-hhpq / CVE-2024-4367](https://github.com/advisories/GHSA-wgrm-67xf-hhpq) | This historical font JavaScript execution issue affects versions through 4.1.392, patched in 4.2.67. The locked version is outside the affected range. PDF.js 6 no longer exposes `isEvalSupported`; no obsolete option is added. |

Runtime npm dependencies are now pdfjs-dist 6.4.299, pdf-lib 1.17.1, React/React DOM 19.3.0 and their transitive dependencies. PDF.js was updated from 6.3.289 to the current same-major release; other direct runtime versions were unchanged. `npm audit --omit=dev` and full `npm audit` report zero findings after updates. This does not prove absence of unknown vulnerabilities.

### PDF.js error propagation workaround

The embedded-image regression test exposed an existing PDF.js behavior: even with `stopAtErrors: true`, a failed operator stream could resolve both `getOperatorList()` and `render().promise` successfully, producing white/partial output. This was independently reproduced on 6.4.299; it is a local finding, not a claimed CVE/advisory. The reader error handler calls `operatorListChanged()` with `lastChunk=true` before rejecting its capability, allowing success to win the race.

`scripts/patch-pdfjs.mjs` patches only the legacy main renderer actually imported by the app. On operator-stream failure it rejects the operator-list capability first, cancels active render tasks with the original error, and removes the operator-list pseudo-task instead of reporting normal completion. `copy-vendor.mjs` applies this before both dev and production builds. The dependency is pinned to 6.4.299 and the script checks one exact source match (or an already patched match); unexpected versions/source fail the build. The byte-guarded patch must be reviewed/removed when upstream fixes this. Browser tests assert that an oversized embedded image fails visibly and cannot be exported; normal scanned PDF preview must still contain ink. This adds an explicit maintenance obligation and does not attest the rest of PDF.js.

OpenCV is a special case: `@techstark/opencv-js` is a development typing dependency, while the browser actually executes the checked-in `vendor/opencv` build. Its build script declares OpenCV 5.0.0 and Emscripten 6.0.10 and exports selected core/imgproc APIs. Images are decoded by the browser/PDF.js and passed as pixels; no OpenCV image-file decoder is called. npm audit does not attest this binary. [Upstream's CVE-2025-53644 discussion](https://github.com/opencv/opencv/issues/27271) identifies affected OpenCV 4.10.0/4.11.0; this is not evidence that the custom 5.0.0 binary is affected or completely safe.

Reviewed vendor SHA-256 values (baseline identification, not a provenance attestation):

- `opencv.js`: `6b76b87724651efefd94911c1bf8b1e0627a14d151ff0c4bc17b02f806ea8798`
- `opencv_js.wasm`: `fc726ed70b4c33317a9b1513d6d89186589387de5ca65da57e710f91bd0211a1`

## Other reviewed surfaces

- Static client application: no application server, authentication/authorization implementation, server API, database, or API credentials to audit. No secrets were found in the reviewed application/configuration files; this was not an exhaustive history or credential scan.
- User files enter through File/ArrayBuffer/createImageBitmap, never an input-controlled network URL. PDF.js receives bytes and same-origin decoder/font/CMap URLs. OpenCV, PDF.js workers and WASM are served locally under the Vite base path. No runtime CDN or telemetry was found. The browser smoke test records unexpected HTTP destinations for the image/export path.
- File names and errors go through React text interpolation, document.title or textContent. No input-derived HTML sink, eval, annotation scripting layer or command execution path was found in application source. Generated PDFs are reconstructed from raster output; source PDF actions, attachments, links and forms are not copied.
- Downloads/view/print use application-generated object URLs. No remote upload or share occurs automatically; sharing requires the user's UI action.
- Public Pages enforced HTTPS and returned HSTS. No CSP was present in the observed HTML/headers; Pages hosting/security settings were not changed. All project pages on this GitHub Pages origin share an origin, so it is not a security isolation boundary between repositories.

## Verification and remaining limits

Regression coverage includes file/page/dimension boundaries, staff-driven resize rejection before OpenCV, ordinary image/OpenCV/PDF export, HTML-like filenames, malformed PDFs, page-count and UserUnit amplification, oversized embedded images and ordinary scanned PDF preview. Browser tests exercise both single-worker (main-thread PDF rasterisation) and parallel-worker paths against a local production build. No malicious input was sent to the public site.

Commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:browser`, `npm audit --omit=dev`, `npm audit`, and `git diff --check`. PR CI repeats these checks and verifies the vendor paths; browser setup is `npx playwright install --with-deps chromium`. Locally, `PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome.

An independent internal agent reviewed the source/diff and rechecked the fixes. Its findings drove the explicit PDF error policy, pre-mutation validation and partial-export refusal. This was not an external AI service or formal penetration test.

Remaining risks: createImageBitmap must decode an image before its dimensions can be checked; file bytes do not bound decoded complexity. Per-page/file limits do not bound PDF object streams, path/glyph complexity, total retained analysis pixels, aggregate worker memory or CPU time, and parser/browser bugs remain possible. Complex valid PDFs can still exhaust resources. OpenCV binary provenance/reproducibility was not rebuilt/verified; the build toolchain downloads are not cryptographically pinned. Browser tests cover Chromium only, not Safari/Firefox or every print/share flow. No claim of complete safety or exhaustive vulnerability coverage is made.
