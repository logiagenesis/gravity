# 00 — Working Log

Chronological record of every atomic change: commit SHA, what changed, what was
tested, pass/fail, what remains.

---

## Environment / baseline facts (verified 21/09/2026)

| Fact                     | Value                                     | How verified                        |
| ------------------------ | ----------------------------------------- | ----------------------------------- |
| Working dir              | `/home/user/gravity`                      | `pwd`                               |
| Remote                   | `https://github.com/logiagenesis/gravity` | `git remote -v`                     |
| Remote branches at start | `refs/heads/main` only @ `85ecc61`        | `git ls-remote --heads origin`      |
| Repo contents at start   | `README.md` (9 bytes) only                | `ls -la`, `cat README.md`           |
| Designated work branch   | `claude/amazing-wright-3iwr5k`            | session harness requirement         |
| Push access              | **Confirmed**                             | `git push -u origin HEAD` succeeded |
| Node / npm               | v22.22.2 / 10.9.7                         | `node --version`, `npm --version`   |
| CPU / RAM                | 4 × Intel Xeon @ 2.10 GHz / 15 GiB        | `/proc/cpuinfo`, `free -h`          |
| Chromium                 | `/opt/pw-browsers/chromium-1194`          | `ls /opt/pw-browsers`               |

### Branch-name deviation (recorded, not assumed)

The task text asks for `rebuild/gravity-simulator-next`. The session harness
mandates `claude/amazing-wright-3iwr5k` and forbids pushing elsewhere without
explicit permission. The harness constraint wins. Renaming is a one-line change
if the user prefers the other name.

### Material baseline finding

`logiagenesis/gravity` was **empty** — not a fork of
`TheHappyKoala/Harmony-of-the-Spheres`, no third-party code, no GPL-derived
history. This made clean-room both the safest and the cheapest option. See
`04-licensing-and-clean-room.md`.

### Network constraint encountered

The egress proxy blocks `gravitysimulator.org` for both `curl` and `WebFetch`.
Live-site evidence was gathered through the Firecrawl MCP tool instead, and
response headers through a public `securityheaders.com` scan. Recorded because
it affects how the audit evidence was obtained.

---

## Commit log

| #   | SHA             | Change                                                                                               | Checks run                                           | Result |
| --- | --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------ |
| 1   | `d412819`       | Working log with verified environment baseline                                                       | `git status`, `git diff --check`                     | pass   |
| 2   | `55657d8`       | `01-questions-and-answers.md` — 76 questions, 15 categories, per-answer confidence                   | manual source verification                           | pass   |
| 3   | `03408c0`       | `02-top-20-benchmark.md` — 20 companies/products + non-company leaders                               | web research with citations                          | pass   |
| 4   | `5297b3c`       | `03-current-site-audit.md` — 22 findings by severity                                                 | repo inspection, live fetches, **executed probes**   | pass   |
| 5   | `910ad34`       | `04-licensing-and-clean-room.md` — clean-room decision                                               | `find` for licence files, `grep` package.json        | pass   |
| 6   | `a35e855`       | `05-product-and-technical-spec.md` — build blueprint                                                 | traceability table vs all 22 findings                | pass   |
| 7   | `a8a6bca`       | Scaffold: React 19 + TS + Vite, ESLint, Prettier, Vitest, Playwright, CI, licence gate               | `npm audit` → 0 vulns; licence gate pass             | pass   |
| 8   | `5d5131f`       | Physics core: SoA state, forces, Barnes-Hut, Verlet/PEFRL/RK4, collisions, conservation, accumulator | 29 physics tests, lint, typecheck                    | pass   |
| 9   | `f7bbf67`       | Scenario schema, migrations, generator, 7 cited scenarios                                            | 79 tests total                                       | pass   |
| 10  | `737d2cf`       | Worker, renderer, UI, search, persistence, sharing, headers, sitemap                                 | typecheck, 79 tests, build                           | pass   |
| 11  | `82b37e9`       | 32 Playwright tests: browser, axe, keyboard, mobile                                                  | full `npm run verify`                                | pass   |
| 12  | `b0df49c`       | Performance baseline; corrected BH threshold; fixed drift after merges                               | benchmark + 33 e2e + 80 unit                         | pass   |
| 13  | `18b8b7b`       | Working log completed                                                                                | `npm run verify`                                     | pass   |
| 14  | `7948c50`       | **Render fix**: separated display size from physical radius; `07-manual-qa.md` + screenshots         | `npm run verify`, manual QA                          | pass   |
| 15  | `6d104fa`       | **CI fix**: generate catalogue before typecheck                                                      | reproduced failure, then verified from a clean state | pass   |
| 16  | `cb2ee84`       | Worker protocol tests (18)                                                                           | `npm run verify`                                     | pass   |
| 17  | `c2eba61`       | Share-link tests (9)                                                                                 | `npm run verify`                                     | pass   |
| 18  | `f64c822`       | README test-suite table                                                                              | `npm run verify`                                     | pass   |
| 13  | _(this commit)_ | Working log completed; `06-performance-baseline.md` recorded                                         | `npm run verify`                                     | pass   |

---

## Defects found in **my own** work, by my own checks

Recorded because a log that only lists successes is not an engineering record.

| #   | Found by      | Defect                                                                                                                                                              | Resolution                                                                                                            |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Physics test  | Circular-orbit tolerance was an arbitrary `1e-6` that the method's own O(dt²) truncation error exceeded                                                             | Replaced with a theory-derived bound **plus a convergence-order test** asserting that halving dt reduces error ~4×    |
| 2   | Physics test  | Barnes-Hut accuracy measured as per-**component** relative error, which explodes when a component is ~0 through cancellation                                        | Changed to per-body **vector** error; documented why                                                                  |
| 3   | Physics test  | Timestep-independence asserted bit-identical step counts across frame rates — unachievable, since summing 1/144 × 144 ≠ summing 1/60 × 60 in floating point         | Assert agreement **within one timestep**, the exact defensible bound, and state the reason                            |
| 4   | Typecheck     | `reducedMotion` declared in the renderer but never used — reduced-motion support was claimed, not implemented                                                       | Actually implemented: trails default off and the work is skipped entirely                                             |
| 5   | Lint          | `any` in schema tests                                                                                                                                               | Replaced with a properly-typed loose `Draft` type rather than disabling the rule                                      |
| 6   | Playwright    | Focusing `#main` on mount ran on first load too, putting focus past the skip link so the first Tab never reached it                                                 | Focus moves only on **subsequent** navigation                                                                         |
| 7   | Playwright    | Simulator overflowed a 393 px viewport by 42 px                                                                                                                     | Diagnosed by measuring offending elements, not guessing; grid items default to `min-width: auto` → set `min-width: 0` |
| 8   | Benchmark     | `AUTO_BARNES_HUT_THRESHOLD` **guessed** at 512, where Barnes-Hut is 0.82× — i.e. 22% _slower_ and approximate                                                       | Measured crossover is **1024**; constant corrected and the measurement recorded at its definition                     |
| 9   | Perf run      | Three-body scenario reported **100% energy drift** — actually a legitimate inelastic merge measured against a pre-merge reference                                   | Re-baseline after merges, count resets, explain in the HUD; regression test added                                     |
| 10  | Self-review   | Stray non-English token left in the search stop-word list                                                                                                           | Removed                                                                                                               |
| 11  | Self-review   | Ugly `.replace` string hack left in the sitemap XML builder                                                                                                         | Rewritten cleanly                                                                                                     |
| 12  | **Manual QA** | **The planets were invisible.** All 33 tests passed; on screen only the Sun could be seen. Earth is 4.3e-5 AU — under one pixel                                     | Renderer enforces a minimum _apparent_ size in pixels; physics untouched                                              |
| 13  | **Manual QA** | Behind it: the generator inflated radii ×40 to compensate, but radius is also the **collision contact radius** — a display problem solved by corrupting the physics | Data now carries the true radius; the false "exaggerated radii" caveat removed from every citation                    |
| 14  | **Manual QA** | The first fix clamped every body to one size, so the Sun looked identical to Mercury                                                                                | Floor scales with the cube root of true radius, preserving hierarchy                                                  |
| 15  | **CI**        | `npm run verify` failed on a clean checkout: typecheck ran before the gitignored catalogue was generated. Passed locally only because stale files existed           | `data:build` runs first in `verify`; CI gained an explicit step. Reproduced before fixing                             |
| 16  | Self-review   | Octree returns a shared, reused node pool — a latent footgun if a caller held two trees                                                                             | Documented the lifetime constraint at the function                                                                    |
| 17  | Self-review   | Brief requires worker tests; the worker was only covered end-to-end                                                                                                 | Added 18 protocol tests against a fake Worker                                                                         |

Items 8 and 9 would have shipped silently without a performance run.

Items 12–14 would have shipped silently without a human looking at the screen:
**every automated test passed while the product was unusable.** That is the
case for manual QA, stated as a fact about this work rather than as a principle.

---

## Verification state

`npm run verify` = format check → lint → typecheck → licence gate → unit tests
→ build → e2e. **Passing.**

- **107 unit tests** across physics, schema, worker protocol and share links
- **33 Playwright tests** (desktop + mobile); axe reports no WCAG A/AA violations
- **npm audit: 0 vulnerabilities** in full and production-only trees
- **Production build: passing**, sitemap and robots verified consistent

---

## What remains

### Out of scope for this pass, with reasons

| Item                                                   | Why                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Adaptive high-accuracy integrator for close encounters | The brief permits it "if justified"; no measured need yet. Deferred, not dropped               |
| Elastic / configurable collision modes                 | Spec'd for v2; merge is the physically complete default                                        |
| WebAssembly physics core                               | Architecture keeps it open; correctness first, then measure. Stellarium Web validates the path |
| Migrating the 4,435 upstream scenarios                 | Blocked on owner decision **B4**; the generator pipeline exists and scales                     |
| Server-side share IDs                                  | Would require a backend; fragment-based sharing needs none                                     |

### Needs owner input (blocking questions B1–B6)

Open-source vs proprietary; whether ads return at all; analytics posture;
migrate upstream scenarios or curate fresh; DNS/redirect plan for existing v1
and `/version-2/` URLs; audience priority. Defaults are stated in
`01-questions-and-answers.md` and **none blocks the code**.

### Recommended next step

Deploy the branch to a preview URL and re-run the security-header scan and a
Lighthouse pass against it. Both are listed as unmeasured in
`06-performance-baseline.md` §6 precisely because no deployment exists yet, and
both are cheap once one does.
