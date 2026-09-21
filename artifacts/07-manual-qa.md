# 07 — Manual QA

Manual verification performed 21/09/2026 against the production build
(`npm run build` → `npm run preview`), Chromium 153, on the hardware recorded in
`06-performance-baseline.md` §1.

Screenshots are in `artifacts/screenshots/` and were captured from the running
application, not mocked up.

---

## 1. What manual QA found that the automated tests did not

This section exists first because it is the point of doing manual QA at all.

### The planets were invisible

All 33 automated tests passed. The body table showed correct positions, the
diagnostics showed correct energy, every assertion was green — **and on screen
you could see only the Sun.**

Cause: the renderer used the body's physical radius directly. The Earth is
4.3 × 10⁻⁵ AU in radius; on a 4 AU stage at ~700 px that is well under one
pixel. Nothing was wrong with the physics. Nothing was wrong with the tests.
The product was simply unusable, and only looking at it revealed that.

**There was a second, deeper problem behind it.** The scenario generator had
been inflating radii by ×40 to compensate — but `radius` is also the collision
contact radius, so that inflation made bodies merge at forty times the correct
separation. A display problem had been solved by corrupting the physics.

Fixed properly by separating the two concerns:

- **Data** now carries the _true_ physical radius. Collisions are correct, and
  the "radii are exaggerated" caveat was removed from every scenario's citation
  because it is no longer true.
- **The renderer** enforces a minimum _apparent_ size in pixels, computed from
  the camera distance and field of view. Physics never sees it.

### Everything then rendered the same size

The first fix clamped every body to one minimum, so the Sun looked identical to
Mercury — visible, but the mass hierarchy was gone. The floor now scales with
the cube root of the body's true radius, compressing the real ~100× range into a
legible spread while still guaranteeing visibility. Display only.

Neither problem was detectable by the test suite as written, and neither is the
kind of thing a passing build will tell you about.

---

## 2. Test matrix

| #   | Check                                            | Result                     | Evidence                 |
| --- | ------------------------------------------------ | -------------------------- | ------------------------ |
| 1   | Catalogue loads, cards render, citations shown   | **Pass**                   | `01-catalogue.png`       |
| 2   | Search narrows results, prefix matching works    | **Pass**                   | automated + manual       |
| 3   | Filters combine; clear-filters restores          | **Pass**                   | automated                |
| 4   | Scenario opens, worker starts, bodies appear     | **Pass**                   | `03-simulator.png`       |
| 5   | **All bodies visible at default framing**        | **Pass** _(after fix, §1)_ | `03-simulator.png`       |
| 6   | Relative body sizes legible                      | **Pass** _(after fix, §1)_ | `03-simulator.png`       |
| 7   | Play/pause/step/reset behave correctly           | **Pass**                   | automated                |
| 8   | Trails render and follow the true path           | **Pass**                   | `06-figure-eight.png`    |
| 9   | Figure-eight traces the published closed curve   | **Pass**                   | `06-figure-eight.png`    |
| 10  | Body table matches the rendered positions        | **Pass**                   | `03-simulator.png`       |
| 11  | Diagnostics show energy and momentum drift       | **Pass**                   | `04-diagnostics.png`     |
| 12  | Source citation panel complete                   | **Pass**                   | `05-source-citation.png` |
| 13  | Integrator switch takes effect; guidance updates | **Pass**                   | automated                |
| 14  | RK4 warns it is not symplectic                   | **Pass**                   | automated                |
| 15  | Share link round-trips; payload in fragment      | **Pass**                   | automated                |
| 16  | Damaged share link rejected with explanation     | **Pass**                   | automated                |
| 17  | Save to IndexedDB, list, reopen                  | **Pass**                   | automated                |
| 18  | Import rejects malformed JSON with a reason      | **Pass**                   | automated                |
| 19  | Keyboard-only operation end to end               | **Pass**                   | automated                |
| 20  | Skip link is the first tab stop                  | **Pass** _(after fix)_     | automated                |
| 21  | Pinch-zoom not blocked                           | **Pass**                   | automated                |
| 22  | Mobile: no horizontal scroll                     | **Pass** _(after fix)_     | `07-mobile.png`          |
| 23  | Mobile: touch targets ≥ 40 px                    | **Pass**                   | automated                |
| 24  | Zero third-party network requests                | **Pass**                   | automated                |
| 25  | axe: no WCAG A/AA violations on any route        | **Pass**                   | automated                |

---

## 3. Visual verification of physics correctness

The figure-eight choreography (`06-figure-eight.png`) is the strongest visual
evidence in the suite. Three equal masses trace a **single closed
figure-eight** and the trails overlay exactly. This orbit is periodic but
dynamically unstable: any material error in the force calculation or the
integrator makes the curve visibly open up or drift within a few periods. It
does not.

The inner solar system (`03-simulator.png`) shows four planets on distinct
orbits at correct relative distances, with the body table's positions matching
what is drawn.

---

## 4. Known cosmetic limitations

Recorded rather than left for a user to discover.

| Limitation                                         | Why it is acceptable now                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| No body labels in the 3D view                      | The Bodies table names every object and is the accessible path; labels are a v2 enhancement |
| Camera orbits a fixed origin; cannot follow a body | The spec defers camera focus; arrow keys and zoom cover the basic need                      |
| Trails are a fixed 240 points for all bodies       | Adaptive trail length by frame time is spec'd but not yet driven by the measured frame cost |
| Bodies render as untextured spheres                | Deliberate: textures would be a large asset download for no scientific gain at v1           |
| Mobile keeps the side panel below the view         | Correct for a narrow viewport, but a tabbed full-screen mode would be better on a phone     |

---

## 5. Not covered by this pass

- Real iOS/Android devices — only an emulated Pixel 5 viewport in Chromium.
- Firefox and Safari — Chromium only.
- Screen-reader testing with an actual screen reader (NVDA/JAWS/VoiceOver).
  ARIA semantics are verified structurally by axe and by role-based queries,
  which is **not** the same as a real assistive-technology user's experience.
- Long-duration soak testing (hours) for memory growth.
