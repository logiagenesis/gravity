# 05 — Product and Technical Specification

**This is the build blueprint. Implementation does not start until this is
committed and pushed.**

Every decision traces to evidence in `01`–`04`. Where a decision rests on
judgement rather than evidence, it says so.

---

## 1. Product goals

**Positioning**, from the gap identified in `02` §"What this benchmark
actually decides": NASA Eyes is authoritative but read-only; Universe Sandbox is
interactive but paid and installed; indie web simulators are instant but
shallow. **Nobody occupies free + instant + deep catalogue + cited data +
visibly correct physics.**

| #   | Goal                                          | Measurable as                                                                      |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| G1  | **Correct physics, and visibly so**           | Conservation diagnostics on screen; drift bounds asserted in CI                    |
| G2  | **Fast, and independent of display hardware** | Fixed-timestep accumulator; identical trajectory at 30/60/144 Hz, asserted by test |
| G3  | **Findable**                                  | Full-text search + facets over the whole catalogue; no 248-page pagination crawl   |
| G4  | **Usable by everyone**                        | WCAG 2.2 AA for chrome; keyboard-complete; axe-clean in CI                         |
| G5  | **Trustworthy**                               | Mandatory per-scenario citation; no third-party requests; no ads in simulation     |
| G6  | **Durable**                                   | Versioned schema + migrations; simulation core has zero runtime dependencies       |

**Non-goals for v1:** general relativity; hydrodynamics; multiplayer; accounts;
mission-design-grade force models (third-body perturbation catalogues,
solar-radiation pressure, drag). Stated so scope creep is visible.

---

## 2. Personas and jobs-to-be-done

| Persona                | Job-to-be-done                                       | What it demands                                                                     |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **P1 Curious visitor** | "Show me something amazing, now"                     | <2 s to first frame; zero chrome; no signup                                         |
| **P2 Educator**        | "Demonstrate a concept in class, on school hardware" | Beginner mode; shareable link; keyboard-operable; works on a low-end laptop; no ads |
| **P3 Student**         | "Understand why orbits do that"                      | Guided experiments; parameter manipulation; explanation of what changed             |
| **P4 Technical user**  | "Check this is actually right"                       | Integrator choice; diagnostics; citations; export; deterministic replay             |

**Core JTBD:** _"Show me what this gravitational system does, let me change one
thing, and let me see whether the answer can be trusted."_

---

## 3. Architecture

```
┌─────────────────── Main thread ────────────────────┐   ┌──── Worker ────┐
│  React 19 + TS        UI chrome only               │   │ Simulation core│
│    ├── Catalogue, search, filters                  │   │  (zero deps)   │
│    ├── Controls, diagnostics HUD, dialogs          │   │                │
│    └── NEVER holds per-frame body state  [F4]      │   │ SoA Float64Array│
│                                                    │   │ Fixed-timestep  │
│  Three.js renderer                                 │   │  accumulator    │
│    └── reads latest snapshot, instanced draw       │   │ Verlet/PEFRL/RK4│
│                                                    │   │ Direct ⇄ B-H    │
│  SnapshotBus  ◄──── transferable ArrayBuffer ──────┼───┤ Collisions      │
│                ──── commands ─────────────────────►│   │ Conservation    │
└────────────────────────────────────────────────────┘   └────────────────┘
```

**Three rules, each fixing a verified defect:**

1. React state never holds per-frame body data → fixes **F4**.
2. Physics never runs on the main thread → fixes **F5**.
3. Simulation time never depends on frame delivery → fixes **F3**.

### 3.1 Stack decision (ADR-0001, recorded in `docs/adr/`)

**React + TypeScript + Vite.** Rejected alternatives:

- **Gatsby** — what upstream uses; its GraphQL data layer is what forces
  4,435 scenarios into 4,435 built pages (`03` §6) and motivated the
  `node_modules` monkey-patch (**F7**). Rejected.
- **Next.js** — server runtime we do not need; the product is static + worker.
- **Astro** — genuinely good for content; but this is one heavy interactive
  island, which is Astro's weakest case.

**Vite**: fast dev, first-class worker support (`new Worker(new URL(...))`),
static output deployable to any CDN. **Confidence: High** on the reasoning;
the choice itself is engineering judgement.

**Deferred:** WebAssembly. Stellarium Web proves the compiled-core pattern
(`02` §7), but TypeScript-over-`Float64Array` in a worker is the right v1 —
correctness and architecture first, then measure, then optimise. WASM is a
clean later swap precisely because the core has no dependencies.

---

## 4. Physics specification

### 4.1 Units — canonical, and non-negotiable

| Quantity | Unit              |
| -------- | ----------------- |
| Length   | AU                |
| Mass     | Solar masses (M☉) |
| Time     | Days              |
| Velocity | AU/day            |

`G` is **derived, not measured**: with the Gaussian gravitational constant
`k = 0.01720209895`, `G = k² = 2.959122082855911×10⁻⁴ AU³ M☉⁻¹ day⁻²` exactly in
these units. Chosen so `G` is exact by definition rather than carrying
measurement uncertainty — the standard convention for solar-system work.

### 4.2 State layout — structure-of-arrays

```ts
positions: Float64Array; // [x0,y0,z0, x1,y1,z1, ...]
velocities: Float64Array;
accelerations: Float64Array;
masses: Float64Array;
radii: Float64Array;
flags: Uint8Array; // bit 0 = active, bit 1 = massless test particle
```

Rationale (`01` Q28): contiguous memory, no per-step allocation, and
**zero-copy transfer to the worker** via transferable `ArrayBuffer`. Directly
replaces upstream's per-step `{x,y,z}` allocation (`03` §5.3).

### 4.3 Force calculation

**Plummer-softened Newtonian acceleration:**

a_i = Σ_{j≠i} G·m_j·(r_j − r_i) / (|r_j − r_i|² + ε²)^{3/2}

- **Massless test particles** (flag bit 1) are excluded as _sources_ but
  integrated as _targets_. Fixes the half-measure at `03` §4.6 and keeps them
  out of the octree entirely.
- **Direct O(n²)** below a measured threshold; **Barnes-Hut** above it. The
  threshold is set from **our own benchmark**, not assumed. Until measured, the
  default is direct.

### 4.4 Barnes-Hut — the three upstream bugs, explicitly designed out

| Upstream defect                                  | Our requirement                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **F1** fixed ±500 root box silently drops bodies | Root bounds **recomputed from actual body extent every rebuild**, with padding. A body can never fall outside the root |
| **F18** root CoM seeded with corner position     | CoM accumulators initialised to **zero**; asserted by unit test                                                        |
| **F19** unbounded recursion                      | Hard `MAX_DEPTH`; at depth limit, bodies form a **leaf bucket** instead of subdividing                                 |

**Acceptance test:** Barnes-Hut vs direct force on the same configuration must
agree to a stated relative tolerance as θ→0, **including for bodies at 10³ and
10⁴ AU** — the exact case where upstream returns zero.

### 4.5 Integrators

| Method              | Order | Force evals/step | Role                                                                              |
| ------------------- | ----- | ---------------- | --------------------------------------------------------------------------------- |
| **Velocity Verlet** | 2     | 1                | **Default.** Symplectic; bounded energy error over long runs                      |
| **PEFRL**           | 4     | 4                | High accuracy, still symplectic                                                   |
| **RK4**             | 4     | 4                | Familiarity and comparison. **Not symplectic — drifts secularly.** UI must say so |

Coefficients from their **published sources, cited in comments at the point of
use** (`04` §5.3). Verlet is the default because bounded energy error over long
integrations is what an orbital simulator actually needs — and because the
research reference code makes the same architectural choice (`02`, REBOUND).

**Adaptive high-accuracy method for close encounters: deferred to v2,** and
recorded as deferred rather than silently dropped. The brief permits it "if
justified"; it is not yet justified by a measured need.

### 4.6 Fixed-timestep accumulator — fixes F3

```
accumulator += min(wallClockDelta, MAX_FRAME_TIME)
while (accumulator >= dt) { step(dt); accumulator -= dt; stepCount++ }
```

`MAX_FRAME_TIME` clamps the spiral-of-death after a stall. **Simulated time
advances identically regardless of display refresh rate**, and this is asserted
by test (§11).

### 4.7 Collisions — fixes F2

Merge is **momentum-conserving**, which upstream's is measurably not
(`03` §4.2, 200 → 0):

```
M   = m₁ + m₂
v   = (m₁v₁ + m₂v₂) / M          ← conserves linear momentum
x   = (m₁x₁ + m₂x₂) / M          ← centre of mass
r   = (r₁³ + r₂³)^(1/3)          ← conserves volume at constant density
```

Iteration is **safe**: collision pairs are collected in a first pass, then
applied — never splicing the array under the loop (fixes **F22**).

Kinetic energy is **expected to decrease** (inelastic merge). Tests assert mass
and momentum conserved _exactly_ (to floating-point tolerance) and kinetic
energy non-increasing — not that energy is conserved, which would be physically
wrong.

Elastic/inelastic/bounce modes: deferred to v2, recorded.

### 4.8 Conservation diagnostics — G1, fixes the F-gap at `03` §4.7

Computed on the worker, reported in every snapshot:

```
E = Σ ½mᵢvᵢ²  −  Σ_{i<j} G·mᵢmⱼ / √(rᵢⱼ² + ε²)
L = Σ mᵢ (rᵢ × vᵢ)
```

Relative drift `|E(t) − E₀| / |E₀|` and `|L(t) − L₀| / |L₀|` surface in the HUD.
**This is the differentiator** (`02` conclusion 5): no consumer competitor shows
its own error.

### 4.9 Deterministic replay

A run is `(scenario, integrator, dt, softening, stepCount)`. Physics uses **no
randomness**; any future stochastic feature takes an explicit seed. Stepping
from a fixed accumulator makes step count — not frame count — the clock, so the
same inputs give bit-identical output on the same build. Asserted by test.

---

## 5. Worker protocol

Commands (main → worker): `init`, `play`, `pause`, `setSpeed`, `setIntegrator`,
`setTimestep`, `reset`, `stepOnce`, `loadScenario`, `setForceMode`.

Snapshots (worker → main), transferable, at render cadence not step cadence:

```ts
type Snapshot = {
  positions: Float64Array; // transferred, zero-copy
  simTime: number;
  stepCount: number;
  bodyCount: number;
  energy: number;
  energyDrift: number;
  angularMomentum: number;
  angularMomentumDrift: number;
  stepsLastBatch: number;
  workerStepMs: number;
};
```

Buffers are **pooled and recycled** — returned to the worker after render — so
steady-state allocation is zero.

---

## 6. Renderer

Three.js (MIT). Reads the **latest snapshot only**; never interpolates from
React state. `InstancedMesh` for bodies, so body count does not drive draw
calls. Trails as ring-buffer `BufferGeometry` with a bounded vertex budget.
Labels in a DOM overlay, not canvas-drawn — so they are selectable and
accessible. Adaptive quality: measured frame time drives trail length and
segment counts. `prefers-reduced-motion` respected.

---

## 7. Scenario schema and data pipeline

### 7.1 Versioned schema, Zod-validated at every boundary

```ts
{
  schemaVersion: 1,               // integer, mandatory
  id, name, summary,
  category, tags[], difficulty,   // beginner | intermediate | advanced
  source: {                       // MANDATORY — 04 §6
    provider, reference, retrievedAt, url?
  },
  physics: { g?, softening, integrator, dt, forceMode },
  bodies: [{ id, name, mass, radius, position:{x,y,z},
             velocity:{x,y,z}, massless?, colour? }],
  camera?: { distance, target }
}
```

`source` is **required** — the cheapest trust signal, and absent upstream
(`01` Q34).

### 7.2 Validation rule — fixes F17

**No scenario enters the simulation without passing Zod validation.** Applies
to bundled scenarios, imported files, share links and IndexedDB loads. Invalid
input produces an actionable error, never a partial load.

### 7.3 Migrations

`migrate(doc)` chains `v_n → v_n+1`. A document older than the current version
is upgraded on load; newer is rejected with a clear message. **No silent data
loss** — tested.

### 7.4 Pipeline separation

`data/` (source-of-truth JSON) → build-time validate + index → `catalog.json`
manifest + `search-index.json`. **A manifest, not thousands of built pages** —
directly rejecting the upstream model (`03` §6). Pipeline code lives outside
the app bundle.

---

## 8. Search, filters, persistence, sharing

- **Search:** build-time inverted index over name/summary/tags/body names.
  Client-side, instant, no network. Fixes the no-search finding (`01` Q5).
- **Filters:** category, body count, difficulty, computational cost, data
  source, tags.
- **Persistence:** IndexedDB for local saves; schema-versioned; migrated on
  read.
- **Import/export:** validated JSON, round-trip tested.
- **Share links:** compressed scenario in the URL fragment. **Fragment, not
  query string** — it is never sent to the server, so sharing leaks nothing.
  Server-side immutable IDs deferred (would require a backend; §12).

---

## 9. Accessibility requirements — G4

Target **WCAG 2.2 AA** for all UI chrome. Method adopted from PhET
(`02` §9): native HTML + ARIA + a live textual layer for the visual canvas.

| Requirement                                                                                           | Fixes   |
| ----------------------------------------------------------------------------------------------------- | ------- |
| All controls are real `<button>`/`<input>`/`<select>` with accessible names                           | **F11** |
| Full keyboard operation; visible focus; logical order                                                 | **F11** |
| Focus trapped in dialogs; restored on close                                                           | —       |
| Tabs use `role="tablist"`/`tab"`/`tabpanel"` with arrow-key navigation                                | **F11** |
| **Viewport meta never sets `maximum-scale` or `user-scalable=no`**                                    | **F10** |
| Canvas has `role="img"` + `aria-label`; a **live accessible body table** is the non-visual equivalent | **F11** |
| `aria-live` announcements for play/pause/integrator changes                                           | —       |
| `prefers-reduced-motion` honoured                                                                     | —       |
| Contrast ≥ 4.5:1 for text                                                                             | —       |

**Honest limit** (`01` Q46): the 3D view cannot be made equivalent for a blind
user. The _information_ can — body list, elements, diagnostics, play state are
all semantic HTML. Posture: "the data is fully accessible; the visualisation is
an enhancement."

---

## 10. SEO, privacy, security

### SEO — fixes F12, F13, F14

- **One canonical origin.** No `/version-2/` split (**F20**).
- Canonical URL per route, **generated from one source of truth** so no
  doubled prefix is possible (**F13**).
- `sitemap.xml` **generated at build** and verified to exist by CI — the
  advertised sitemap must not 404 (**F12**).
- `robots.txt` pointing at the real sitemap.
- All OG/social image URLs **percent-encoded and same-origin** (**F14**).
- JSON-LD: `LearningResource`/`CreativeWork` for scenarios (not
  `GameApplication`) plus `BreadcrumbList`.

### Privacy — fixes F8, F9

- **Zero third-party requests on first paint.** No CDN fonts, no trackers.
- **No analytics in v1.** No dead UA tags (**F8**), no consent theatre.
  If measurement is ever added: self-hosted, cookieless, opt-in first.
- **No ads anywhere in the application, and categorically none in the
  simulation view** (**F9**).
- A real privacy page stating plainly what is and is not collected.

### Security — fixes F15, F17

- CSP with a real `default-src`/`script-src`, not just `frame-ancestors`.
- `Strict-Transport-Security` **with `includeSubDomains`**.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` denying geolocation/camera/microphone, `X-Frame-Options: DENY`.
- Headers shipped as `public/_headers` (Netlify/Cloudflare) **and** committed as
  `nginx`/`Caddy` snippets, so the posture is host-portable.
- All scenario input Zod-validated (**F17**).
- No inline event handlers; no `dangerouslySetInnerHTML`.
- Dependency audit + licence gate in CI (`04` §7).

---

## 11. Test strategy

`npm run verify` runs, in order: **generate catalogue → format check → lint →
typecheck → dependency licence gate → unit tests → production build → browser
and accessibility tests**.

The catalogue generation step comes first because the manifest and search index
are gitignored build artefacts that the app's TypeScript imports; without it,
`verify` fails on a clean clone. CI caught exactly that.

As built, this is **107 unit tests** (physics, schema, worker protocol, share
links) and **33 browser tests** (flows, axe, keyboard-only, mobile,
performance baseline).

### Physics regression tests (all mandated by the brief)

| Test                       | Assertion                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Two-body circular orbit    | Radius and speed stable; period matches 2π√(a³/GM)                                             |
| Two-body elliptical orbit  | Energy and angular momentum conserved within tolerance; apsides correct                        |
| Figure-eight choreography  | Configuration recurs after one period within tolerance                                         |
| Conservation drift         | Verlet/PEFRL drift bounded over many orbits; **RK4 permitted to be worse** — that is the point |
| Collision merge            | Mass and momentum conserved exactly; KE non-increasing; radius from volume                     |
| Barnes-Hut vs direct       | Agreement within tolerance, **including at 10³–10⁴ AU** (the F1 case)                          |
| Timestep independence      | Same simulated end time from different frame cadences (the **F3** case)                        |
| Deterministic replay       | Identical inputs → bit-identical state                                                         |
| Particle/mass separation   | Massless particles exert **zero** force on anything                                            |
| Invalid scenario rejection | Malformed/absent-source/wrong-version documents rejected with actionable errors                |

### Browser tests

Load catalogue · search · filter · open scenario · play/pause · change speed ·
switch integrator · import/export · save/load local · **keyboard-only
navigation** · **mobile viewport smoke** · **axe accessibility scan**.

---

## 12. Performance

**No budget is asserted before baseline measurement** — the brief forbids
invented numbers, and `03` §14 records none.

Procedure: measure on **named** hardware and browser, at stated body counts,
recording frame time, worker step time, steps/second and memory where the
platform exposes it. Budgets are set from that baseline and only then enforced.
Results land in `artifacts/06-performance-baseline.md`.

---

## 13. Deployment

Static bundle + worker. No server required. Deployable to any static host/CDN.
Headers via `public/_headers` plus portable server snippets. CI runs
`npm run verify` on every push.

---

## 14. Traceability — every verified defect has an owner

| Defect                     | Fixed by                                 |
| -------------------------- | ---------------------------------------- |
| F1 Barnes-Hut drops bodies | §4.4 dynamic bounds + test at 10³–10⁴ AU |
| F2 Momentum destroyed      | §4.7 momentum-conserving merge + test    |
| F3 Refresh-rate coupling   | §4.6 fixed-timestep accumulator + test   |
| F4 Per-frame Redux clone   | §3 rule 1 — React never holds body state |
| F5 Main-thread physics     | §3 rule 2 — worker                       |
| F6 No tests/CI             | §11 + CI                                 |
| F7 node_modules patch      | §3.1 — Gatsby rejected                   |
| F8 Dead UA tag             | §10 — no analytics                       |
| F9 Ads in simulation       | §10 — no ads                             |
| F10 Blocked zoom           | §9 — no `maximum-scale`                  |
| F11 Non-semantic controls  | §9 — real elements, ARIA, live table     |
| F12 404 sitemap            | §10 — generated + CI-verified            |
| F13 Doubled path prefix    | §10 — single URL source of truth         |
| F14 Unencoded OG URLs      | §10 — percent-encoded, same-origin       |
| F15 Missing headers        | §10 — full header set                    |
| F16 Licence ambiguity      | `04` — clean-room, explicit posture      |
| F17 No validation          | §7.2 — Zod at every boundary             |
| F18 Bad CoM seed           | §4.4 — zero-init + test                  |
| F19 Unbounded recursion    | §4.4 — MAX_DEPTH + leaf buckets          |
| F20 Version fragmentation  | §10 — one canonical origin               |
| F21 Dead plugin deps       | §3.1 — different stack                   |
| F22 Splice-under-iteration | §4.7 — collect then apply                |
