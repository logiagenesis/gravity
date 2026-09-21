# 06 — Performance Baseline

**Measured, not estimated.** No number in this document was recalled,
extrapolated or rounded from intuition. Everything here came from a command
recorded below, run on the hardware named below. Where something was not
measured, it says so.

This file exists because `05-product-and-technical-spec.md` §12 forbids setting
a performance budget before a baseline exists, and `03-current-site-audit.md`
§14 explicitly declines to assert any performance figure about the audited site
because none was measured there.

---

## 1. Hardware and software under test

| Property        | Value                             | How obtained                    |
| --------------- | --------------------------------- | ------------------------------- |
| CPU             | Intel Xeon @ 2.10 GHz, 4 cores    | `/proc/cpuinfo`, `nproc`        |
| RAM             | 15 GiB                            | `free -h`                       |
| OS              | Linux 6.18.44 (containerised)     | environment                     |
| Node            | v22.22.2                          | `node --version`                |
| Browser         | Chromium 153.0.8010.12            | `navigator.userAgent`           |
| Emulated device | Pixel 5 (393 × 851 CSS px, DPR 3) | Playwright `devices["Pixel 5"]` |
| Date            | 21/09/2026                        | —                               |

**This is a shared virtualised container, not a consumer device.** Absolute
timings will differ on real hardware. The _relative_ results — particularly the
Barnes-Hut crossover — are the useful part, and any budget derived from this
must be re-validated on representative hardware.

---

## 2. Force-calculation benchmark

Command: `npx tsx scripts/benchmark-forces.ts`
Method: deterministic pseudo-random cloud of _n_ bodies in a 40 AU cube;
each method warmed up, then run repeatedly for ≥300 ms and averaged; θ = 0.5;
softening 1e-4.

| Bodies   | Direct (ms) | Barnes-Hut (ms) | Speed-up  | Mean relative error |
| -------- | ----------- | --------------- | --------- | ------------------- |
| 32       | 0.005       | 0.024           | 0.21×     | 6.73e-3             |
| 64       | 0.021       | 0.072           | 0.29×     | 8.08e-3             |
| 128      | 0.080       | 0.203           | 0.39×     | 8.30e-3             |
| 256      | 0.327       | 0.721           | 0.45×     | 7.84e-3             |
| 512      | 1.584       | 1.932           | 0.82×     | 5.62e-3             |
| **1024** | **5.118**   | **5.035**       | **1.02×** | 5.36e-3             |
| 2048     | 19.942      | 13.127          | 1.52×     | 4.87e-3             |
| 4096     | 80.014      | 32.314          | 2.48×     | 4.32e-3             |

### What this changed

`AUTO_BARNES_HUT_THRESHOLD` was initially set to **512 by guesswork**. The
measurement shows that at 512 bodies Barnes-Hut is **0.82×, i.e. 22% slower**
than the exact direct sum — _and_ approximate. That is worse on both axes.

**The constant was corrected to 1024**, the measured crossover, and the
measurement is recorded in a comment at the definition
(`src/sim/engine.ts`). This is precisely the kind of plausible-sounding
constant that survives indefinitely if nobody measures it.

### Accuracy cost

Mean relative error of the acceleration vector at θ = 0.5 is **4–8 × 10⁻³**
(under 1%), and decreases with body count as the tree becomes better populated.
`tests/physics/barnes-hut.test.ts` additionally asserts that θ → 0 reproduces
the direct sum to better than 1e-12.

Direct summation scales as expected: from 1024 → 2048 → 4096 the direct timing
goes 5.1 → 19.9 → 80.0 ms, a factor of ~3.9–4.0 per doubling, which is the
O(n²) behaviour the method should show.

---

## 3. In-browser baseline

Command: `npx playwright test --project=mobile tests/e2e/perf-mobile.spec.ts`
Method: open scenario, switch to the Diagnostics tab, play, allow 3 s to reach
steady state, then read the HUD and independently sample 90 consecutive
`requestAnimationFrame` deltas, reporting the median.

| Scenario           | Bodies | Worker step (HUD) | Frame (median of 90) | Steps in ~3 s | Energy drift |
| ------------------ | ------ | ----------------- | -------------------- | ------------- | ------------ |
| Sun + Earth        | 2      | 0.0 ms            | 16.7 ms              | 5             | 6.76e-10     |
| Inner solar system | 5      | 0.0 ms            | 16.7 ms              | 11            | 3.01e-7      |
| Jupiter trojans    | 4      | 0.0 ms            | 16.7 ms              | 2             | 1.22e-16     |
| Three-body chaos   | 3      | 0.0 ms            | 16.7 ms              | 5,919         | 0.00e+0      |

### Reading this honestly

- **16.7 ms is the vsync interval, not a measured cost.** The renderer is
  frame-rate limited at 60 Hz in all four scenarios. This says the renderer is
  not the bottleneck at these body counts; it says nothing about headroom.
- **"0.0 ms" worker step time is below the timer's resolution**, not literally
  zero. These scenarios have 2–5 bodies.
- **Step counts differ enormously and correctly.** Jupiter trojans take ~2
  steps in 3 s because its timestep is 1 day at 1 day per real second;
  three-body chaos takes ~5,919 because its timestep is 5×10⁻⁴ in dimensionless
  units. Step count is a property of the scenario, not of performance.
- **These are all small scenarios.** Nothing here exercises Barnes-Hut, which
  §2 covers instead. A large-N in-browser measurement is **not yet done** —
  see §6.

### A defect this measurement found

The first baseline run reported **energy drift of 1.00e+0 (100%)** for
three-body chaos. Investigation showed this was _not_ an integration failure:
the three bodies collapse, collide, and merge, and a perfectly inelastic merge
genuinely changes total energy. The drift was being measured against a
pre-merge reference, so a real physical event was being displayed as numerical
failure.

Fixed in `src/sim/engine.ts`: the conservation baseline is re-captured after a
merge, the reset count is surfaced in the HUD, and the Diagnostics panel
explains that drift is measured since the most recent merge. The same scenario
now reports **0.00e+0**. Regression test:
`tests/physics/collisions.test.ts` → "re-baselines, because a merge
legitimately changes total energy".

Without a performance run, this would have shipped.

---

## 4. Bundle size

Command: `npm run build`

| Asset                            | Raw        | Gzipped      |
| -------------------------------- | ---------- | ------------ |
| Initial JS (`index`)             | 309.15 kB  | **91.64 kB** |
| Simulator chunk (Three.js, lazy) | 499.86 kB  | 125.75 kB    |
| CSS                              | 6.47 kB    | 2.08 kB      |
| Simulation worker                | 74.90 kB   | —            |
| Each scenario (lazy)             | 1.5–2.4 kB | ~1 kB        |

Before the simulator was code-split, the initial bundle was **809.03 kB
(216.75 kB gzipped)**. Lazy-loading it moved Three.js out of first load, so a
visitor browsing or searching the catalogue downloads **92 kB gzipped instead
of 217 kB** — a 58% reduction — and the 3D engine arrives only when a scenario
is opened.

Scenario JSON is loaded on demand, so catalogue size does not affect initial
load. This is the structural difference from compiling every scenario into its
own page.

---

## 5. Proposed budgets

Offered as **proposals derived from this baseline**, not yet enforced. They
should be validated on representative consumer hardware before being wired into
CI, because §1 explains why these absolute timings are not representative.

| Budget                                  | Proposed            | Basis                               |
| --------------------------------------- | ------------------- | ----------------------------------- |
| Initial JS, gzipped                     | ≤ 120 kB            | measured 91.64 kB, ~30% headroom    |
| Simulator chunk, gzipped                | ≤ 160 kB            | measured 125.75 kB                  |
| Median frame time, ≤ 10 bodies          | ≤ 20 ms             | measured at the 16.7 ms vsync floor |
| Barnes-Hut mean relative error at θ=0.5 | ≤ 1e-2              | measured 4–8e-3                     |
| Direct-force scaling                    | within 10% of O(n²) | measured 3.9–4.0× per doubling      |

---

## 6. Not measured — and what it would take

Stated explicitly rather than left as a gap the reader has to notice.

| Not measured                                            | What it needs                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Large-N (10³–10⁵ bodies) in-browser frame and step time | A large synthetic scenario plus an instrumented run; §2 covers the force cost in Node only |
| Real consumer hardware                                  | Runs on named laptop/phone models; §1 is a shared VM                                       |
| Memory under sustained load                             | `performance.measureUserAgentSpecificMemory()` over a long run                             |
| Lighthouse / Core Web Vitals                            | A deployed URL; no production deployment exists yet                                        |
| Any figure for the **audited** site                     | Deliberately not measured, and deliberately not asserted anywhere (`03` §14)               |
| Cold-start time to first frame on a throttled network   | Throttled Playwright trace against a deployment                                            |

---

## 7. Reproducing

```bash
npm ci
npx tsx scripts/benchmark-forces.ts                              # §2
npm run build                                                    # §4
npx playwright test --project=mobile tests/e2e/perf-mobile.spec.ts --reporter=list   # §3
```

The in-browser measurement prints a markdown table between
`=== PERFORMANCE BASELINE ===` markers.
