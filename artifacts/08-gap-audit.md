# 08 — Honest Gap Audit

**Baseline:** `main` @ `902aece` plus M0 (`a3ddebd`). Audited 21/09/2026.

**Purpose.** Establish, without flattery, how much of the original brief is
actually built and how the rebuild compares to the product it replaces. The
previous pass reported green CI while the planets were invisible on screen.
Green checks are necessary and are **not** the definition of done.

**Method.** Every row is marked from evidence: a file path, a grep result, a
screenshot, or a live fetch. "Absent" means I looked and it is not there. Rows
citing only generated catalogue JSON (scenario descriptions and tags) are
marked **absent**, because text mentioning a feature is not the feature.

Legend: **Present** = built and tested · **Partial** = exists but incomplete
against the requirement · **Absent** = not implemented.

---

## Status at the end of M5 — every deferred row, resolved or not

**Updated 21/09/2026**, branch head `0ed56c7`. The matrices below are the
ORIGINAL audit, taken at `902aece` + M0, and they are left as written: a
point-in-time measurement that is rewritten later is not a measurement. This
section says what has happened to every row they marked Partial or Absent.

Each verdict below cites a path that exists in this commit or a test that runs
in `npm run verify`. Where something is still missing it says so and names the
milestone, rather than being quietly dropped.

### Now Present

| Row            | Requirement                                                      | Evidence                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 3.3         | Adaptive high-accuracy method **if justified**                   | `src/sim/adaptive.ts`; the justification is measured in `artifacts/12`, not assumed                                                                                  |
| A1 3.9         | Configurable elastic / inelastic / merge                         | `src/sim/collisions.ts` `COLLISION_MODES`, schema v2 + migration, `tests/physics/collisions.test.ts`                                                                 |
| A1 3.10        | Visible energy + angular-momentum drift                          | `src/ui/components/DriftChart.tsx`, charted over time, not only instantaneous                                                                                        |
| A1 4.2         | Adaptive quality                                                 | `src/render/scene.ts:adaptQuality` — frame time scales starfield density, trail length and DPR                                                                       |
| A1 4.4         | No unnecessary global high-cost settings                         | `scene.ts:609` sets `near`/`far` from the view distance, keeping the ratio inside float depth precision, so `logarithmicDepthBuffer` is **deliberately not** enabled |
| A1 5.4         | Data pipeline separate from the app                              | `scripts/pipeline/build-exoplanets.ts`, `build-horizons.ts`, `build-binaries.ts`                                                                                     |
| A1 7.1         | One canonical site                                               | Pages live and auto-deploying; evidence in `artifacts/13`                                                                                                            |
| A1 7.3         | Filters: type, count, period, difficulty, cost, source, category | `src/ui/catalogue-facets.ts` + `CataloguePage.tsx`: eight groups — category, difficulty, bodies, stars, orbital period, cost, data source, tags — with live counts   |
| A1 7.4         | Beginner / educational / advanced modes                          | `src/ui/detail-level.ts`; `tests/e2e/detail-level.spec.ts` drives all three                                                                                          |
| A1 7.5         | Guided experiments                                               | `src/experiments/catalogue.ts`, six of them, each applied to its real scenario in a test                                                                             |
| A1 7.7         | Warnings for a dangerous timestep or tolerance                   | `src/sim/warnings.ts`, seven warnings including timestep-vs-period                                                                                                   |
| A1 7.8         | Screenshot / export                                              | `scene.capturePng`, captioned with the scenario's citation                                                                                                           |
| B 7            | Collision system                                                 | as A1 3.9                                                                                                                                                            |
| B 9            | Renderer: labels                                                 | `src/render/labels.ts`; adaptive quality as A1 4.2                                                                                                                   |
| B 10           | Catalogue / search / filters / detail / citations                | 5,142 scenarios across six categories, `src/catalog/`                                                                                                                |
| B 11           | Simulator UI: modes, picker, HUD, charts, warnings               | all five now present                                                                                                                                                 |
| C (comparison) | Undo / redo                                                      | `src/ui/edit-history.ts` + `src/sim/edits.ts`, inverse-based, tested exact                                                                                           |
| C (comparison) | Guided experiments                                               | as A1 7.5                                                                                                                                                            |
| C (comparison) | Energy / momentum charts                                         | as A1 3.10                                                                                                                                                           |
| Backlog 5      | Body editor + builder + undo/redo                                | `src/ui/components/BodyEditor.tsx`, `src/ui/BuildPage.tsx`                                                                                                           |
| Backlog 6      | Modes + guided experiments                                       | as A1 7.4 and 7.5                                                                                                                                                    |
| Backlog 7      | Diagnostics charts + warnings                                    | as A1 3.10 and 7.7                                                                                                                                                   |
| Parity 241     | In-UI tuning of dt, softening, θ, force method                   | View tab, gated to the advanced level                                                                                                                                |
| Parity 242     | A higher-order symplectic and an adaptive method                 | PEFRL (4th order) + adaptive sub-stepping                                                                                                                            |
| M1 pending     | Spaceflight category                                             | shipped in M4: eight JPL Horizons scenarios, terms recorded in `artifacts/04` §11                                                                                    |

### Still open, with the milestone that owns them

| Row        | Requirement                                | State       | Owner                                                                                |
| ---------- | ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| A1 9.2     | Correct sitemap and robots                 | **Partial** | Correct, but only `/` is indexable while routing is by hash → **M6**                 |
| A1 9.3     | Structured data                            | **Partial** | `SoftwareApplication` on the home page only; no per-scenario or breadcrumbs → **M6** |
| B 14       | SEO / privacy / security pass              | **Partial** | Hash routing defeats SEO → **M6**                                                    |
| B 15       | Final verification                         | **Partial** | Chromium only; no measurement on the deployed URL → **M7**                           |
| Parity 239 | Habitable-zone overlay                     | **Absent**  | Theirs has it; cheap and directly serves the exoplanet catalogue → **M7**            |
| —          | Three browsers                             | **Absent**  | `playwright.config.ts` has two projects, both Chromium → **M7**                      |
| —          | Per-scenario preview images                | **Absent**  | The highest-value visual work outstanding; recorded in `artifacts/10` → **M7**       |
| —          | `>500 kB` chunk warning on `SimulatorPage` | **Open**    | Reported by every build → **M7**                                                     |

### Added since the original audit, and not in its matrices

| Item                         | Evidence                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Editing a live simulation    | `src/sim/edits.ts`, applied in place with exact inverses                                                    |
| Order-preserving removal     | `SimState.removeBodyPreservingOrder` + `insertBody`, so undo restores the arrangement, not only the physics |
| Camera focus by body id      | Survives any edit; an array index did not                                                                   |
| Chrome-less embedding        | `src/ui/embed.ts`, `?embed=1`                                                                               |
| The framing decision         | `docs/security-headers.md`, "The framing decision, resolved"                                                |
| A repeatable screenshot gate | `scripts/capture-screenshots.ts`, fails the run if a page errored                                           |
| Deployment verification      | `artifacts/13`, separating what was seen on the live host from what was not                                 |

---

## Matrix A — the original brief, requirement by requirement

### A1. Default target architecture (brief §1–9)

| #       | Requirement                                                                                   | State                       | Evidence                                                                             |
| ------- | --------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| 1.1     | React + TypeScript                                                                            | **Present**                 | `package.json`, `src/ui/`                                                            |
| 1.2     | Vite / Next / Astro chosen on evidence                                                        | **Present**                 | `docs/adr/0001-frontend-stack.md`                                                    |
| 1.3     | React for chrome, not per-frame physics                                                       | **Present**                 | `SimulatorPage.tsx` holds snapshots in a ref; HUD at 4 Hz                            |
| 2.1     | Physics off the main thread                                                                   | **Present**                 | `src/worker/simulation.worker.ts`                                                    |
| 2.2     | Typed arrays                                                                                  | **Present**                 | `src/sim/state.ts`                                                                   |
| 2.3     | Structure-of-arrays                                                                           | **Present**                 | `src/sim/state.ts`                                                                   |
| 2.4     | Fixed-timestep accumulator                                                                    | **Present**                 | `src/sim/engine.ts:advance`                                                          |
| 2.5     | Speed independent of refresh rate                                                             | **Present**                 | `tests/physics/timestep-and-determinism.test.ts`                                     |
| 2.6     | Renderer and simulation decoupled                                                             | **Present**                 | snapshot protocol, `src/worker/protocol.ts`                                          |
| 3.1     | Verlet or PEFRL default long-run integrator                                                   | **Present**                 | Verlet default, `src/sim/integrators/`                                               |
| 3.2     | RK4 available                                                                                 | **Present**                 | `src/sim/integrators/rk4.ts`                                                         |
| 3.3     | Adaptive high-accuracy method if justified                                                    | **Absent**                  | deferred; no measurement taken either way → **M5**                                   |
| 3.4     | Direct O(n²) below measured threshold                                                         | **Present**                 | `scripts/benchmark-forces.ts`, threshold 1024 measured                               |
| 3.5     | Dynamic Barnes-Hut octree                                                                     | **Present**                 | `src/sim/barnes-hut.ts`                                                              |
| 3.6     | Correct Plummer softening                                                                     | **Present**                 | `src/sim/forces.ts`                                                                  |
| 3.7     | Massless particles separated                                                                  | **Present**                 | `FLAG_MASSLESS`, excluded from tree and sources                                      |
| 3.8     | Momentum-conserving merges                                                                    | **Present**                 | `src/sim/collisions.ts`, tested                                                      |
| 3.9     | Configurable elastic/inelastic/merge                                                          | **Absent**                  | merge only → **M5**                                                                  |
| 3.10    | Visible energy + angular-momentum drift                                                       | **Partial**                 | instantaneous numbers only; no chart over time → **M5**                              |
| 3.11    | Deterministic replay                                                                          | **Present**                 | `tests/physics/timestep-and-determinism.test.ts`                                     |
| 4.1     | Three.js                                                                                      | **Present**                 | `src/render/scene.ts`                                                                |
| 4.2     | Adaptive quality                                                                              | **Absent**                  | `frameMs` is measured and displayed but drives nothing → **M3**                      |
| 4.3     | Instancing                                                                                    | **Present**                 | `InstancedMesh`                                                                      |
| 4.4     | No unnecessary global high-cost settings                                                      | **Partial**                 | DPR capped at 2; log depth buffer not considered → **M3**                            |
| 4.5     | No physics data in React state per frame                                                      | **Present**                 | verified by design and code                                                          |
| 4.6     | Main thread renders worker snapshots                                                          | **Present**                 | `src/worker/client.ts`                                                               |
| 5.1     | Versioned scenario JSON schema                                                                | **Present**                 | `src/schema/scenario.ts`                                                             |
| 5.2     | Runtime validation (Zod)                                                                      | **Present**                 | every boundary                                                                       |
| 5.3     | No unvalidated scenario import                                                                | **Present**                 | `migrateAndParse` is the only entry                                                  |
| 5.4     | Data pipeline separate from app                                                               | **Partial**                 | `scripts/generate-scenarios.ts` is a generator, not a source pipeline → **M4**       |
| 5.5     | Catalog manifest, not hardwired pages                                                         | **Present**                 | `scripts/build-catalog.ts`                                                           |
| 5.6     | Search index at build time                                                                    | **Present**                 | inverted index                                                                       |
| 5.7     | Citation field per scenario                                                                   | **Present**                 | mandatory in schema                                                                  |
| 6.1     | IndexedDB local saves                                                                         | **Present**                 | `src/storage/saved-scenarios.ts`                                                     |
| 6.2     | Import/export JSON                                                                            | **Present**                 | `src/share/link.ts`                                                                  |
| 6.3     | Share links                                                                                   | **Present**                 | fragment payload, compressed                                                         |
| 6.4     | No silent data loss                                                                           | **Present**                 | unreadable records surfaced, not hidden                                              |
| 6.5     | Schema migrations                                                                             | **Present**                 | `src/schema/migrations.ts`                                                           |
| 7.1     | One canonical site                                                                            | **Partial**                 | one origin, but no deploy live yet → **M0** blocked                                  |
| 7.2     | Strong full-text search                                                                       | **Present**                 | client-side inverted index                                                           |
| 7.3     | Filters: type, count, period, difficulty, cost, source, category                              | **Partial**                 | category/difficulty/cost only. No object type, body count, period, source → **M4**   |
| 7.4     | Beginner/educational/advanced modes                                                           | **Absent**                  | a catalogue _tag_ exists; no mode changes anything → **M5**                          |
| 7.5     | Guided experiments                                                                            | **Absent**                  | → **M5**                                                                             |
| 7.6     | Integrator recommendations                                                                    | **Present**                 | `INTEGRATOR_INFO.guidance`                                                           |
| 7.7     | Warnings for dangerous timestep/tolerance                                                     | **Partial**                 | warns on drift and non-symplectic long runs; no timestep-vs-period check → **M5**    |
| 7.8     | Screenshot/export                                                                             | **Absent**                  | scenario JSON export only, no image → **M5**                                         |
| 7.9     | No ads in simulation                                                                          | **Present**                 | no ads anywhere                                                                      |
| 8.1–8.9 | Accessibility (semantics, keyboard, focus, names, reduced motion, zoom, canvas fallback, axe) | **Present**                 | 33 e2e incl. axe on 4 routes                                                         |
| 9.1     | Correct canonical URLs                                                                        | **Present** _(fixed in M0)_ | was pointing at a domain we do not own                                               |
| 9.2     | Correct sitemap and robots                                                                    | **Partial**                 | correct, but only "/" is indexable while routing is hash-based → **M6**              |
| 9.3     | Structured data                                                                               | **Partial**                 | `SoftwareApplication` on home only; no per-scenario or breadcrumbs → **M6**          |
| 9.4     | No obsolete analytics                                                                         | **Present**                 | none at all                                                                          |
| 9.5     | Consent path before third-party tracking                                                      | **Present**                 | vacuously: zero third-party requests, enforced by test                               |
| 9.6     | CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame protection                     | **Partial**                 | full set in `_headers` (inert on Pages); meta CSP subset on Pages. Limits documented |
| 9.7     | Dependency scanning                                                                           | **Present**                 | `npm audit` job + licence gate                                                       |
| 9.8     | No secrets committed                                                                          | **Present**                 | scanned                                                                              |

### A2. Implementation milestones 1–15 (brief §"Implementation milestones")

| #   | Milestone                                          | State       | Note                                                             |
| --- | -------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| 1   | Repo baseline                                      | **Present** |                                                                  |
| 2   | Research/audit/spec artifacts                      | **Present** | `artifacts/01`–`07`                                              |
| 3   | App scaffold, lint, format, typecheck, tests, CI   | **Present** |                                                                  |
| 4   | Scenario schema, validators, samples, migrations   | **Present** |                                                                  |
| 5   | Physics core + tests                               | **Present** |                                                                  |
| 6   | Worker protocol, snapshots, deterministic stepping | **Present** |                                                                  |
| 7   | Collision system                                   | **Partial** | merge only; elastic/pass-through missing → **M5**                |
| 8   | Barnes-Hut with benchmark                          | **Present** | crossover measured at 1024                                       |
| 9   | Renderer: scene, labels, trails, adaptive quality  | **Partial** | **no labels, no adaptive quality**; trails fixed-length → **M3** |
| 10  | Catalog/search/filters/detail/citations            | **Partial** | 7 scenarios; filters incomplete → **M4**                         |
| 11  | Simulator UI: modes, picker, HUD, charts, warnings | **Partial** | picker + HUD only → **M5**                                       |
| 12  | Persistence/sharing/migration tests                | **Present** |                                                                  |
| 13  | Accessibility pass                                 | **Present** |                                                                  |
| 14  | SEO/privacy/security pass                          | **Partial** | hash routing defeats SEO → **M6**                                |
| 15  | Final verification                                 | **Partial** | Chromium only; no deployed-URL measurement → **M7**              |

### A3. Testing requirements

| Requirement                                                                                  | State       | Evidence                             |
| -------------------------------------------------------------------------------------------- | ----------- | ------------------------------------ |
| Single `npm run verify`                                                                      | **Present** | 8-stage chain                        |
| Two-body circular / elliptical                                                               | **Present** | `tests/physics/two-body.test.ts`     |
| Figure-eight choreography                                                                    | **Present** | `tests/physics/figure-eight.test.ts` |
| Conservation drift checks                                                                    | **Present** |                                      |
| Collision merge conservation                                                                 | **Present** |                                      |
| Barnes-Hut vs direct                                                                         | **Present** | incl. 10³–10⁶ AU regression          |
| Timestep independence                                                                        | **Present** |                                      |
| Deterministic replay                                                                         | **Present** |                                      |
| Particle/mass separation                                                                     | **Present** |                                      |
| Invalid scenario rejection                                                                   | **Present** | 16 rejection cases                   |
| Browser: catalog/search/filter/open/play/speed/integrator/import/export/save/keyboard/mobile | **Present** | 33 e2e                               |
| **Three browsers**                                                                           | **Absent**  | Chromium only → **M7**               |

---

## Matrix B — gravitysimulator.org v2, capability by capability

Verified 21/09/2026 by fetching the live v2 site and by reading the public
source at `ffbd3eb`. "Ours" is `main` + M0.

### B1. Catalogue

| Capability            | Theirs                                                                              | Ours                                      | Evidence                                            |
| --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Total scenarios       | **4,435**                                                                           | **7**                                     | their `src/scenarios/*.json`; our `data/scenarios/` |
| — Exoplanets          | **4,397** (99.1%)                                                                   | 0                                         | counted from their JSON `category.name`             |
| — Solar System        | 20                                                                                  | 4                                         |                                                     |
| — Choreographies      | 11                                                                                  | 2                                         |                                                     |
| — What If             | 6                                                                                   | 1                                         |                                                     |
| — Demos               | 1                                                                                   | 0                                         |                                                     |
| Categories            | Exoplanets, Solar System, Stars, What If, Choreographies, Spaceflight               | 3 (solar-system, choreographies, what-if) | live category nav                                   |
| Sub-categories        | planets, moons, asteroids, comets, interstellar-objects; exoplanets by planet count | none                                      | live nav                                            |
| Full-text search      | **Absent** (pagination only, 248 pages)                                             | **Present**                               | our inverted index                                  |
| Filters               | **Absent**                                                                          | category/difficulty/cost                  |                                                     |
| Per-scenario citation | prose only                                                                          | **mandatory structured field**            | our schema                                          |

**The finding that reframes the gap:** 99.1% of their catalogue is a bulk
import of the NASA Exoplanet Archive, not hand curation. Roughly **38
scenarios are genuinely curated**. Matching the count is therefore a _pipeline_
problem with a known primary source — which is exactly what M4 specifies — not
years of authoring. This does not excuse shipping 7; it means the gap is
closable.

### B2. Renderer

| Capability                 | Theirs                                         | Ours                                                       | Evidence                           |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| Starfield background       | Present (`graphics.background`)                | **Absent**                                                 | grep: no match in `src/`           |
| Body labels in 3D          | Present (`graphics.labels`, 2D overlay canvas) | **Absent**                                                 | grep: no match                     |
| Trails                     | Present, per-body toggle                       | **Partial** — fixed 240 points, not period-scaled, no fade | `src/render/scene.ts`              |
| Orbit ellipses             | Present (`graphics.orbits`, conic-section)     | **Absent**                                                 | grep: no match                     |
| Habitable zone             | Present (`graphics.habitableZone`)             | **Absent**                                                 | grep: no match                     |
| Procedural planet surfaces | Present (2,086-line procedural manifestation)  | **Absent** — flat `MeshStandardMaterial`                   | `src/render/scene.ts`              |
| Star glow / emissive       | Present (star shader)                          | **Absent**                                                 |                                    |
| Axial tilt                 | Present (`tilt` per body)                      | **Absent**                                                 |                                    |
| Body temperature → colour  | Present (`temperature` per body)               | **Absent**                                                 |                                    |
| Rings / particle systems   | Present, up to **400,000** particles           | **Absent** in UI                                           | their `particlesConfiguration.max` |
| Logarithmic depth buffer   | Present, per scenario                          | **Absent**                                                 |                                    |
| Adaptive quality           | Unknown                                        | **Absent** (frame time measured, unused)                   |                                    |

### B3. Camera and frames

| Capability                           | Theirs                                           | Ours                                                     | Evidence                 |
| ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------- | ------------------------ |
| Camera focus on a body               | Present (`camera.cameraFocus`)                   | **Absent**                                               | grep: no match           |
| Rotating reference frame             | Present (`camera.rotatingReferenceFrame`)        | **Absent**                                               | grep: no match           |
| Per-scenario default camera position | Present                                          | **Partial** (`camera.distance` only)                     |                          |
| Barycentre marker                    | Present (`barycenter` block, two-body or system) | **Absent**                                               | grep: no match in `src/` |
| Lagrange points L1–L5                | Present (`lagrangePoints`)                       | **Absent** in renderer (one scenario _contains_ trojans) | grep                     |

### B4. Simulator interaction

| Capability                                  | Theirs                          | Ours                                | Evidence                                   |
| ------------------------------------------- | ------------------------------- | ----------------------------------- | ------------------------------------------ |
| Add a body                                  | Present (`add-mass-controls`)   | **Absent**                          | their `src/components/`                    |
| Edit body mass/vectors                      | Present (`mass-controls`)       | **Absent**                          |                                            |
| Delete a body                               | Present (`DELETE_MASS` action)  | **Absent**                          |                                            |
| Add a ring of bodies                        | Present (`ring-controls`)       | **Absent**                          |                                            |
| Scenario builder                            | Present (`custom-scenario`)     | **Absent**                          | live nav                                   |
| Save scenario                               | Present (localStorage)          | **Present** (IndexedDB)             | ours is better: migrations, no silent loss |
| Integrator choice                           | **14 methods**                  | **3**                               | their `integrators/index.ts`               |
| Tune g / dt / tol / softening / theta in UI | Present (`integrator-controls`) | **Absent** (schema supports; no UI) |                                            |
| Undo/redo                                   | **Absent**                      | **Absent**                          | neither has it; brief requires → **M5**    |
| Guided experiments                          | **Absent**                      | **Absent**                          | brief requires → **M5**                    |
| Energy/momentum charts                      | **Absent**                      | **Absent** (numbers only)           | brief requires → **M5**                    |

### B5. Where we already win

Stated so the comparison is honest in both directions.

| Capability                         | Theirs                              | Ours                  |
| ---------------------------------- | ----------------------------------- | --------------------- |
| Full-text search                   | absent                              | present               |
| Conservation diagnostics on screen | **absent entirely**                 | present               |
| Physics off main thread            | **no worker**                       | worker                |
| Refresh-rate-independent timing    | **no — 144 Hz runs 2.4× fast**      | fixed accumulator     |
| Momentum-conserving merges         | **no — measured 200 → 0**           | conserved, tested     |
| Barnes-Hut beyond ±500 units       | **silently returns zero force**     | correct at 10⁶ AU     |
| Automated tests                    | **zero**                            | 140                   |
| CI                                 | **none**                            | verify + audit        |
| Runtime scenario validation        | none                                | Zod at every boundary |
| Keyboard operation                 | **controls are `<div>`s**           | full, tested          |
| Pinch zoom                         | **blocked (`maximum-scale=1.0`)**   | not blocked           |
| Ads on simulation pages            | **yes, contradicting their README** | none                  |
| Analytics                          | dead UA tag still loading           | none                  |
| Structured citation per scenario   | prose                               | mandatory field       |

---

## Ranked build list

Confirms the brief's M2–M7 and adds what this audit found that was not listed.

| Rank | Work                                    | Why this order                                                                   | Milestone |
| ---- | --------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| 1    | Layout/interaction shell                | Everything else is judged through it; it is the "looks like a prototype" problem | **M2**    |
| 2    | Renderer quality                        | Largest visible gap. Starfield, lighting, labels, surfaces, glow                 | **M3**    |
| 3    | Camera focus/follow + reference frames  | Blocks Trojan/Lagrange/horseshoe views, a whole scenario class                   | **M3**    |
| 4    | Catalogue pipeline at scale             | Closes the 7-vs-4,435 gap from the same primary source they used                 | **M4**    |
| 5    | Body editor + builder + undo/redo       | Turns a viewer into a sandbox                                                    | **M5**    |
| 6    | Modes + guided experiments              | The classroom requirement; currently absent                                      | **M5**    |
| 7    | Diagnostics charts + warnings           | Extends our sharpest differentiator                                              | **M5**    |
| 8    | Real URLs + prerendering                | Hash routing makes every scenario invisible to search                            | **M6**    |
| 9    | Perf, cross-browser, final verification | Needs a deployed URL and the finished feature set                                | **M7**    |

### Added by this audit, not in the brief's M2–M7 list

Nothing was removed. These are additions, each justified:

| Item                                              | Why                                                                                                                                                       | Where |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Orbit-ellipse rendering**                       | Theirs has it (`graphics.orbits`); it is the single clearest way to _show_ an orbit rather than infer it from a trail                                     | M3    |
| **Habitable-zone overlay**                        | Theirs has it; cheap, and directly serves the exoplanet catalogue M4 builds                                                                               | M3    |
| **Axial tilt + temperature-driven star colour**   | Both already exist per-body in their schema; free realism from data we will already have                                                                  | M3    |
| **In-UI integrator tuning (g, dt, softening, θ)** | Our schema supports all four; without UI the advanced mode has nothing to expose                                                                          | M5    |
| **More integrators**                              | 3 vs their 14. Not parity for its own sake — but at least one higher-order symplectic and one adaptive method is needed for M5's close-encounter decision | M5    |

### Explicitly out of scope, with reason

| Item                                 | Reason                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migrating their 4,435 JSON files     | Owner decision B4: fresh pipeline from primary sources. Also clean-room: their files are not ours to copy                                                                                                    |
| Matching all 14 of their integrators | Diminishing returns. Verlet + PEFRL + RK4 + one adaptive covers every documented use; more is a menu, not a capability                                                                                       |
| Video export                         | Heavy dependency for marginal benefit; PNG export covers the classroom need. Revisit only on request                                                                                                         |
| Spaceflight category                 | **Pending M4.** Their spaceflight scenarios use JPL Horizons spacecraft ephemerides. If the terms allow clean-room use it ships; if not it is marked "planned" and the reason recorded. Not silently dropped |
