# 03 — Audit of gravitysimulator.org and Harmony-of-the-Spheres

**Subjects**
- Live site: `https://gravitysimulator.org` (v1, apex) and
  `https://gravitysimulator.org/version-2/` (v2). Fetched **21/09/2026**.
- Source: `TheHappyKoala/harmony-of-the-spheres` @
  `ffbd3ebde342170515bb581b2637ffde87e7f1d0` (HEAD of default branch,
  "Merge pull request #196", 17/07/2026), cloned 21/09/2026.

**Method.** Nothing here is carried over from any supplied report. Every claim
below is from a command I ran, an HTTP response I fetched, a source line I
read, or a probe I executed. The two most serious physics defects are
**empirically demonstrated**, not merely argued from source. Line references
are `path:line` at the pinned commit.

**Note on the target repo.** `logiagenesis/gravity` was **empty** at session
start (`README.md`, 9 bytes, commit `85ecc61`). It is not a fork. There is no
inherited code to audit and no GPL history to unwind.

---

## 1. Summary of findings by severity

| # | Severity | Finding | Evidence |
|---|---|---|---|
| F1 | **Critical** | Barnes-Hut silently drops every body beyond a hardcoded ±500 box, returning **exactly zero** force. Default code path | §4.1, probe |
| F2 | **Critical** | Collision merge destroys linear momentum — measured **200 → 0** | §4.2, probe |
| F3 | **Critical** | Simulation speed is proportional to **monitor refresh rate** | §4.3 |
| F4 | **High** | Entire Redux state deep-cloned **and** all body state dispatched back, **every frame** | §5.1 |
| F5 | **High** | Physics runs on the main thread; no Web Worker anywhere | §5.2 |
| F6 | **High** | Zero tests, zero CI | §8 |
| F7 | **High** | Build **rewrites its own `node_modules`** on every run | §7.2 |
| F8 | **High** | Dead Universal Analytics tag still loading on every page | §9.2 |
| F9 | **High** | AdSense in the `<head>` of simulation pages — contradicting the project README | §9.1 |
| F10 | **High** | v2 blocks pinch-zoom (`maximum-scale=1.0`) — WCAG 2.2 SC 1.4.4 failure | §10.1 |
| F11 | **High** | Interactive controls are `<div>`/`<li>`, not buttons; no keyboard access, no accessible names | §10.2 |
| F12 | **Medium** | `robots.txt` advertises a sitemap that returns **404** | §11.1 |
| F13 | **Medium** | v2 `og:url` contains a **doubled** `/version-2/version-2/` path | §11.2 |
| F14 | **Medium** | v1 `og:image` URLs contain **unencoded spaces** and use a different host | §11.3 |
| F15 | **Medium** | No `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`; CSP has only `frame-ancestors` | §12.1 |
| F16 | **Medium** | No `LICENSE` file despite a GPLv3 claim in `package.json` | §13 |
| F17 | **Medium** | No runtime validation of imported/saved scenarios | §12.3 |
| F18 | **Medium** | Barnes-Hut root centre of mass seeded with a spurious `(−500,−500,−500)` | §4.4 |
| F19 | **Medium** | Unbounded octree recursion — no depth guard | §4.5 |
| F20 | **Low** | Two live product versions (Gatsby 2 and Gatsby 5) competing on one domain | §3 |
| F21 | **Low** | `gatsby-plugin-sitemap` and `gatsby-plugin-google-gtag` are dependencies but not registered plugins | §7.3 |
| F22 | **Low** | Collision loop splices while iterating without correcting indices | §4.2 |

---

## 2. Commands run

```
git ls-remote --heads origin
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/TheHappyKoala/harmony-of-the-spheres
git -C … rev-parse HEAD                 → ffbd3ebde342170515bb581b2637ffde87e7f1d0
find src -type f | sed 's/.*\.//' | sort | uniq -c
find src/scenarios -name "*.json" | wc -l         → 4435
grep -rn "new Worker|worker" src -il              → (no matches)
find . \( -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" \)  → (empty)
ls -la .github                                    → No such file or directory
find . -iname "LICENSE*" -o -iname "COPYING*"     → (empty)
grep -rni "kinetic|angularMomentum|totalEnergy" src → (no matches)
grep -rn "depth|MAX_DEPTH" src/physics             → (no matches)
./node_modules/.bin/tsx probe.ts                   → see §4.1, §4.2
```
Live-site fetches: homepage, `/robots.txt`, `/sitemap-index.xml`,
`/solar-system/the-solar-system`, `/version-2/scenarios/all/`, and a
`securityheaders.com` scan. All 21/09/2026.

---

## 3. Product structure and version fragmentation (F20)

| | v1 | v2 |
|---|---|---|
| URL | `https://gravitysimulator.org/` | `https://gravitysimulator.org/version-2/` |
| `<meta name="generator">` | **Gatsby 2.32.13** | **Gatsby 5.12.4** |
| Built from repo HEAD? | **No** | Yes |
| "All scenarios" pagination | 107 pages | 248 pages |
| Ads present | **Yes** | Not observed on the catalogue page |
| Blocks pinch-zoom | No | **Yes** |

`gatsby-config.ts:4` sets `pathPrefix: "/version-2"`, so the repo builds v2
only. v1's source is not at HEAD. Two overlapping, separately indexable copies
of the same product compete on one domain, with no cross-version canonical
strategy. Gatsby 2 is long past end of life.

**Confidence: High.**

---

## 4. Physics audit

Source: `src/physics/`. 14 integrators are implemented (Euler, RK4, Verlet,
PEFRL, Nyström 3–6, RKN64, RKN12, Yoshida6, Kahan-Li8, SOFSPA10, orbital
elements) — `src/physics/integrators/index.ts`. **This breadth is a genuine
strength and the most valuable thing in the project.** The defects below are in
the shared base class and the collision handler, so they affect all of them.

### 4.1 F1 — Barnes-Hut silently drops distant bodies (Critical)

`src/physics/integrators/euler.ts:38` hardcodes `this.maximumDistance = 1000`.
`constructBHTree` (`:319-323`) builds a root cube spanning **−500 … +500** on
each axis. `insertMassInTree` (`:279-297`) only descends when `isInTree` matches
a child; a body outside the root box matches nothing and the function **returns
without inserting it**. Its mass then contributes **no force at all**.

`euler.ts:36` sets `this.useBarnesHut = params.useBarnesHut ?? true` — **Barnes-Hut
is the default path.**

**Empirical proof** — two 1-mass bodies, G = 1, softening 0, varying separation;
Barnes-Hut vs the direct sum vs the closed-form `1/r²`:

```
  separation= 100  direct.ax=1.0000e-4  barnesHut.ax=1.0000e-4  analytic=1.0000e-4
  separation= 400  direct.ax=6.2500e-6  barnesHut.ax=6.2500e-6  analytic=6.2500e-6
  separation= 600  direct.ax=2.7778e-6  barnesHut.ax=0.0000e+0  analytic=2.7778e-6  <-- BH DROPPED THE BODY
  separation=2000  direct.ax=2.5000e-7  barnesHut.ax=0.0000e+0  analytic=2.5000e-7  <-- BH DROPPED THE BODY
```

Beyond 500 units the approximation does not degrade — it returns **exactly
zero**. Any scenario wider than ~500 AU (Oort-cloud objects, wide-binary
exoplanets, the 330 AU and 572 AU systems visible in v2's own catalogue)
silently loses gravity on its outer bodies.

**Confidence: High — measured.**

### 4.2 F2 — Collision merge destroys momentum (Critical)

`src/physics/collisions/collisions-check.ts:40` is the entire merge:

```ts
survivor.m = massI.m + massJ.m;   // :40
masses.splice(looserIndex, 1);    // :42
```

Mass is summed. The survivor's **velocity is never updated**, its **position is
never moved to the centre of mass**, and its **radius is never recomputed**.

**Empirical proof** — a 10-mass body at rest merging with a 2-mass body moving
at vₓ = 100:

```
  before: totalMass=12  totalPx=200
  after : totalMass=12  totalPx=0
  survivor: name=Heavy m=12 vx=0 x=0 radius=1
  MASS conserved:     true
  MOMENTUM conserved: false   (lost 200)
```

**100% of the linear momentum is destroyed in a single merge.** The correct
result is `v = (m₁v₁ + m₂v₂)/(m₁+m₂) = 200/12 ≈ 16.67`.

**F22:** the same function splices from `masses` while iterating it with indices
`i` and `j`, decrementing only `massesLength` (`:46`). Neither loop index is
corrected, so bodies can be skipped, and `massI` is still dereferenced after the
element it refers to may have been removed. `looserIndex--` (`:48`) is dead code.

**Confidence: High — measured.**

### 4.3 F3 — Simulation speed tracks monitor refresh rate (Critical)

`src/scene/scenes/planetary-scene.ts`:
- `:342` `const delta = this.clock.getDelta();`
- `:386` `this.integrator.iterate();` — called **once per frame**, inside
  `if (this.scenario.playing)`
- `:1002` `requestAnimationFrame(this.iterate)`

There is no accumulator. `delta` is referenced exactly once more in the whole
1,109-line file — `:632`, a star shader's `time` uniform. **It never reaches the
integrator.**

Consequence: one `dt` advance per displayed frame. A 144 Hz display advances
simulated time **2.4× faster** than a 60 Hz display for the same scenario;
a throttled background tab runs slower still. Two users watching "the same"
simulation see different physics.

**Confidence: High.**

### 4.4 F18 — Barnes-Hut centre of mass is seeded wrong

`euler.ts:323` initialises the root as
`CoM: { x: -a/2, y: -a/2, z: -a/2 }` — the **corner position**, not zero.
`insertMassInTree` then accumulates `CoM += m·r` onto that seed, and `fixCoM`
(`:306-315`) divides by total mass. The spurious `(−500,−500,−500)` is never
removed, so the root centre of mass is offset by `(−500,−500,−500)/M`.
**Confidence: High.**

### 4.5 F19 — Unbounded octree recursion

`insertMassInTree` (`:260-297`) recurses with **no depth limit**
(`grep -rn "depth|MAX_DEPTH" src/physics` → no matches). Two bodies at
near-identical coordinates subdivide until the stack overflows.
**Confidence: High** for the absence of a guard; **Medium** that it is reachable
from a shipped scenario (I did not attempt to trigger it).

### 4.6 What is correct

For fairness — the force law itself is right. `euler.ts:123` computes
`G·m_j / (r² + ε²)^{3/2}`, the standard **Plummer-softened** acceleration.
`euler.ts:113` correctly skips zero-mass sources in the direct path. The
integrator *coefficients* were not audited; the defects above are all in the
surrounding infrastructure.

### 4.7 No correctness diagnostics exist

`grep -rni "kinetic|potentialEnergy|angularMomentum|totalEnergy|energyDrift" src`
returns **nothing**. Nothing in the product tells a user whether an integration
is diverging — which, given F1–F3, matters a great deal.
**Confidence: High.**

---

## 5. Rendering and state management

### 5.1 F4 — Per-frame full-state clone and dispatch (High)

Inside the `requestAnimationFrame` callback in `planetary-scene.ts`:

- **`:344`** `this.scenario = JSON.parse(JSON.stringify(this.store.getState()));`
  — a full **serialise + parse** of the entire Redux state, including every
  body's position, velocity and graphics config.
- **`:984`** `store.dispatch(modifyScenarioProperty({ key: "masses", value: this.integrator.masses }))`
  — the whole `masses` array pushed back into Redux.
- **`:988`** a second dispatch for camera state.

So each frame: clone all state → step physics → dispatch all body state →
reducer allocates a new state object → subscribers notified → next frame clones
it all again. At 60 Hz. This is the precise anti-pattern of holding per-frame
physics state in React/Redux, and it is doing it twice per frame in both
directions.

**Confidence: High.**

### 5.2 F5 — No Web Worker (High)

`grep -ril "worker" src` → **no matches**. All force computation, integration,
collision detection and octree construction run on the main thread, competing
with React reconciliation, Three.js and the compositor. A slow physics step
directly stalls input handling and rendering.

**Confidence: High.**

### 5.3 Data layout

Array-of-objects throughout. `Vector.toObject()` allocates a fresh `{x,y,z}`
literal per body per sub-step; `new Vector()` is allocated *inside*
`BHAccelerate`, `generateChildren`, `insertMassInTree` and `fixCoM` — i.e.
inside the hot recursion. Sustained GC pressure at frame rate, and no
possibility of zero-copy transfer to a worker.

**Confidence: High.**

### 5.4 Renderer

Three.js `^0.169.0` plus a second 2D canvas overlay for labels.
`non-stellar-procedural-manifestation.ts` is 2,086 lines — the largest
non-generated source file. Adaptive quality was **not** assessed; marked
**UNKNOWN**, resolvable by profiling a live session.

---

## 6. Scenario catalogue and data

- **4,435** scenario JSON files in `src/scenarios/` (`find … | wc -l`).
- `gatsby-node.ts` `createPages` emits **one built page per scenario** plus
  paginated category and sub-category pages.
- No schema, no validator, no version field observed in the ingest path.
- v2 scenario descriptions credit "NASA exoplanet systems and JPL Horizons
  Solar System models" — but whether each JSON carries a machine-readable
  citation is **UNKNOWN** (I did not scan all 4,435 files).
- **No search.** Navigation is category tabs plus numeric pagination — 248
  pages deep on v2. Finding a named system means knowing its category or
  paging.

**Confidence: High** except where marked.

---

## 7. Build process

### 7.1 Stack
Gatsby 5.12.4, React 18, Redux 4 + redux-thunk, Three 0.169, LESS, TypeScript
5.1. `package.json` scripts: `develop`, `start`, `build`, `serve`, `clean`,
`typecheck`, `format`. **No lint script. No test script.**

### 7.2 F7 — The build rewrites its own dependencies (High)

`gatsby-node.ts:41-74` defines `patchGatsbyLoaderStaleCheck()`. It reads
`node_modules/gatsby/cache-dir/loader.js` (`:59`), string-replaces two
expressions, and **writes the file back** (`:72`). It is invoked at module top
level (`:77`) and again from four lifecycle hooks (`:80, :84, :88, :92`).

Every build mutates installed dependency source in place. Builds are not
reproducible from a clean `npm ci`; the patch silently no-ops (or corrupts) on
any Gatsby update; and it is indistinguishable in shape from a supply-chain
tamper. Whatever upstream bug motivated it, this is the wrong layer to fix it.

**Confidence: High.**

### 7.3 F21 — Declared-but-unregistered plugins

`gatsby-plugin-sitemap` and `gatsby-plugin-google-gtag` are in
`package.json` dependencies but appear **zero** times in `gatsby-config.ts`
(verified by `grep -c`). They are installed, shipped in the lockfile, and do
nothing. v2 therefore generates **no sitemap**.

**Confidence: High.**

---

## 8. F6 — Tests and CI (High)

- Test files: **none.** `find . \( -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" \)` → empty.
- CI: **none.** `.github/` does not exist.
- Quality gates: Prettier + `tsc --noEmit` exist as scripts, with husky and
  lint-staged configured, but nothing runs them in CI and there is no linter.

A 14-integrator numerical codebase with zero regression tests is how F1–F3
survive to production.

**Confidence: High.**

---

## 9. Ads, analytics and privacy

### 9.1 F9 — AdSense on simulation pages, contradicting the README (High)

`README.md` states: *"ads are displayed on the scenario menu pages, but not on
the scenario pages where you run the simulations themselves."*

The `<head>` of `https://gravitysimulator.org/solar-system/the-solar-system`
— a scenario/simulation page — contains:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2939351490512475" crossorigin="anonymous">
```

The documented policy and the shipped behaviour disagree. **Confidence: High.**

### 9.2 F8 — Dead Universal Analytics tag (High)

Same page head:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=UA-153406767-1"></script>
```

`UA-` denotes a **Universal Analytics** property. Google ceased processing data
in standard UA properties on **1 July 2023** and subsequently deleted them.
The tag still loads on every page view: users pay the third-party request and
the privacy exposure, and the owner receives no data in return. Pure cost.

**Confidence: High.**

### 9.3 No consent layer

No CMP, cookie banner or consent gate appears in the served HTML; AdSense and
gtag load unconditionally in `<head>`. For EU/UK visitors this is a
**compliance gap requiring legal review** — I am recording the technical
absence, not issuing a legal conclusion. A privacy policy page was not found in
v1 navigation or the v2 footer; marked **UNKNOWN** pending a full route crawl.

**Confidence: High** (absence in fetched pages); **Medium** (site-wide).

---

## 10. Accessibility

### 10.1 F10 — v2 blocks pinch-zoom (High)

v2 viewport meta:
`width=device-width, minimum-scale=1.0, maximum-scale=1.0`

`maximum-scale=1.0` prevents pinch-zoom. This fails **WCAG 2.2 SC 1.4.4 Resize
Text (AA)**.

**Precision matters here:** v1's meta is
`width=device-width, initial-scale=1, shrink-to-fit=no`. `shrink-to-fit` is a
legacy iOS property and does **not** restrict zoom. **v1 does not block zoom;
v2 does.** I am separating these because conflating them would be an easy,
wrong claim.

**Confidence: High.**

### 10.2 F11 — Non-semantic controls (High)

From the rendered simulation page:

```html
<div class="button play-pause"><i class="fas fa-play"></i></div>
<div class="button reset"><i class="fas fa-refresh"></i></div>
<ul class="nav"><li class="nav-item active"><span><i class="fas fa-paint-brush"></i>Graphics</span></li>…
```

- Controls are `<div>` — not `<button>`. No `role`, no `tabindex`. **Not
  keyboard focusable, not operable by keyboard.**
- Labels are Font Awesome glyphs with **no accessible name** — a screen reader
  announces nothing useful for play/pause/reset/save.
- The tab strip has no `role="tablist"`, `role="tab"`, `aria-selected` or
  `aria-controls`.
- `<canvas width="1920" height="993">` has **no `aria-label`, no `role`, and no
  fallback content**.
- No `prefers-reduced-motion` query in the served CSS.

A keyboard-only or screen-reader user cannot start, stop or reset a simulation.

**Confidence: High** for the fetched page.

---

## 11. SEO

### 11.1 F12 — Advertised sitemap 404s

`https://gravitysimulator.org/robots.txt`:
```
User-agent: *
Allow: /
Sitemap: https://gravitysimulator.org/sitemap-index.xml
Host: https://gravitysimulator.org
```
`https://gravitysimulator.org/sitemap-index.xml` → **HTTP 404** (Netlify "Page
not found"). Crawlers are directed to a dead sitemap. **Confidence: High.**

### 11.2 F13 — Doubled path prefix in v2 canonical/OG URL

v2 emits `og:url` =
`https://gravitysimulator.org/version-2/version-2/scenarios/all/`

`/version-2/` appears **twice**. Cause: `gatsby-config.ts:6` sets
`siteUrl: "https://gravitysimulator.org/version-2"` while `:4` sets
`pathPrefix: "/version-2"`, and `gatsby-plugin-canonical-urls` (`:11-16`) is
given the already-prefixed `siteUrl`. The prefix is applied twice.
**Confidence: High.**

### 11.3 F14 — Invalid social image URLs on v1

`og:image` = `https://www.gravitysimulator.org/images/social/The Solar System.jpg`

Two defects: **literal unencoded spaces** (illegal in a URL; must be `%20`), and
the `www.` host while the canonical is apex. **Confidence: High.**

### 11.4 Structured data

v1 emits JSON-LD `SoftwareApplication` with
`applicationCategory: "GameApplication"`. For an educational science tool that
category is questionable, and there is no `BreadcrumbList` and no
`LearningResource`. **Confidence: High** for what is present; **Medium** for the
judgement.

### 11.5 Canonicals
v1's `<link rel="canonical">` on the scenario page is correct and matches the
URL. Credit where due.

---

## 12. Security

### 12.1 F15 — Response headers

Verified via securityheaders.com, 21/09/2026 (grade **B**; `server: Netlify`;
IP 35.157.26.135):

| Header | Value | Verdict |
|---|---|---|
| `content-security-policy` | `frame-ancestors 'none'` | present, but **no `default-src`/`script-src`** → no XSS mitigation |
| `strict-transport-security` | `max-age=31536000` | present, **no `includeSubDomains`, no `preload`** |
| `x-frame-options` | `DENY` | present |
| `x-content-type-options` | — | **missing** |
| `referrer-policy` | — | **missing** |
| `permissions-policy` | — | **missing** |

**Confidence: High.**

### 12.2 Third-party scripts without integrity

Font Awesome 4.7.0 is loaded from `cdnjs.cloudflare.com` with **no `integrity`
attribute and no `crossorigin`**. Plus googletagmanager and googlesyndication.
**Confidence: High.**

### 12.3 F17 — No scenario validation

No validation library is present in `package.json` (no Zod, Ajv, or JSON-Schema
validator). Saved and imported scenarios are parsed and spread into state
unchecked. **Confidence: High** for the absence. Whether this is exploitable was
**not tested** — I did not attempt an exploit and am not going to.

### 12.4 Secrets
No committed secrets found in the files inspected. Not an exhaustive
history scan. **Confidence: Medium.**

---

## 13. F16 — Licensing state

- `package.json:11` → `"license": "GNU General Public License v3.0"`
- `find . -iname "LICENSE*" -o -iname "COPYING*"` → **empty. No licence file
  anywhere in the repository.**
- The declared string is **not a valid SPDX identifier**
  (`GPL-3.0-only` / `GPL-3.0-or-later`).
- v2 footer asserts "Copyright © Darrell Arjuna Huffman 2024".

GPLv3 requires the full licence text to accompany the work. A missing licence
file does **not** make code freely reusable — the default is exclusive
copyright, while the `package.json` string signals copyleft intent. The net
effect is that reuse is *more* legally ambiguous, not less.

Full analysis and decision: `04-licensing-and-clean-room.md`.
**Confidence: High.**

---

## 14. Performance

**No performance numbers are asserted.** I did not run Lighthouse, did not
profile a live session, and did not measure frame time, worker time or memory
on the live site. Any figure here would be invented, and the brief forbids that.

What is established is **architectural**, from source, and independent of
measurement:
- physics on the main thread (F5),
- a full state serialise+parse and a full body-state dispatch every frame (F4),
- per-step object allocation in the hot path (§5.3),
- O(n²) collision checks that examine every ordered pair twice (§4.2).

These are structural costs, not tuning issues. Baseline measurement of the
**rebuild** is defined in `05-product-and-technical-spec.md`; budgets are set
only after that baseline exists.

---

## 15. What is genuinely good, and should be preserved conceptually

Stated plainly, because an audit that only lists faults is not useful:

1. **The integrator library is excellent** — 14 methods including PEFRL,
   Yoshida6, Kahan-Li8, SOFSPA10 and adaptive RKN. Richer than any web
   competitor found in `02-top-20-benchmark.md`.
2. **The Plummer softening is correct** (`euler.ts:123`).
3. **The catalogue is a real asset** — 4,435 scenarios with genuine astronomical
   content is a decade of curation.
4. **v2's scenario descriptions are good** — specific, numerate, and they cite
   their data sources in prose.
5. **v1's canonical tags and JSON-LD** show SEO was thought about.
6. **TypeScript throughout**, with Prettier, husky and lint-staged configured.

The failures are architectural and procedural — no worker, no tests, no CI, no
validation — not a lack of domain knowledge. The rebuild should aim to match the
numerical ambition while fixing the architecture around it.

---

## 16. Explicit unknowns

| Unknown | What would resolve it |
|---|---|
| Live traffic, audience, geography | Owner grants analytics/log access |
| Revenue from AdSense | Owner provides AdSense reporting |
| Whether a `/privacy` page exists | Full route crawl of both versions |
| Whether each of the 4,435 scenarios carries a citation field | Schema scan of all files |
| v1's source at its deployed commit | Owner identifies the v1 branch/tag |
| Adaptive quality in the renderer | Profile a live session |
| Real-device frame timings | Instrumented runs on named hardware |
| Whether F19 (unbounded recursion) is reachable from a shipped scenario | Fuzz the octree with near-coincident bodies |
