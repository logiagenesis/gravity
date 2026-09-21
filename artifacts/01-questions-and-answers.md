# 01 — Questions and Answers

**Method.** I generated the questions first, then answered them from primary
sources: the cloned upstream repo (`TheHappyKoala/harmony-of-the-spheres` @
`ffbd3ebde342170515bb581b2637ffde87e7f1d0`, cloned 21/09/2026), the live site
(fetched 21/09/2026), public documentation, and standards text. Every answer
carries a **confidence** and a **source**. Where I could not verify, the answer
says **UNKNOWN** and states exactly what would resolve it.

Confidence scale:
- **High** — read directly from source code, live HTTP response, or normative spec.
- **Medium** — inferred from strong indirect evidence, stated as inference.
- **Low** — plausible but unverified; treated as a hypothesis, not a fact.

Shorthands: `UP:` = upstream repo path. `LIVE:` = live-site observation.

---

## A. Product (Q1–Q8)

**Q1. What does the existing product actually do?**
An interactive Newtonian n-body gravity simulator in the browser: solar-system
models, exoplanet systems, n-body choreographies, spacecraft trajectories, and
user-built scenarios. **Confidence: High.** `UP:README.md`, `LIVE:` homepage.

**Q2. Is there one product or several?**
Several. Version 1 lives at the domain root and reports `generator: Gatsby
2.32.13`. Version 2 lives under `/version-2/` and reports `generator: Gatsby
5.12.4`. The public repo at HEAD builds **only v2** (`gatsby-config.ts` sets
`pathPrefix: "/version-2"`). So v1 is live but its source is not at repo HEAD.
**Confidence: High.** `LIVE:` `<meta name="generator">` on both; `UP:gatsby-config.ts:4`.

**Q3. How large is the scenario catalogue?**
4,435 scenario JSON files in the repo. v1's "All" listing paginates to page
107; v2's paginates to page 248. **Confidence: High.**
`find src/scenarios -name "*.json" | wc -l` → 4435; `LIVE:` pagination links.

**Q4. Is every scenario a separate built page?**
Yes. `createPages` iterates every scenario and calls `createPage` per scenario,
plus paginated category/sub-category pages. **Confidence: High.**
`UP:gatsby-node.ts` (`data?.scenariosJson.scenarios.forEach(...)`).

**Q5. Is there full-text search?**
No search input appears on either catalogue page, and no search index or search
library exists in the repo. Navigation is category tabs plus numeric
pagination only. **Confidence: High** (repo); **Medium** (live — absence of
evidence in fetched HTML, not an exhaustive interaction test).

**Q6. What is the monetisation model today?**
Google AdSense (`ca-pub-2939351490512475`). **Confidence: High.** `LIVE:` script
tag in the `<head>` of `/solar-system/the-solar-system`.

**Q7. Does the ad placement match what the project claims?**
No. `README.md` states ads appear "on the scenario menu pages, but not on the
scenario pages where you run the simulations themselves." The AdSense loader is
present in the `<head>` of the **simulation** page
`/solar-system/the-solar-system`. The documented policy and the shipped
behaviour disagree. **Confidence: High.**

**Q8. What should the rebuild's product goal be?**
Fastest, most trustworthy, most accessible way to *see* and *interrogate*
gravitational dynamics — with the physics correct and the correctness
**visible** (conservation diagnostics on screen). That is the defensible
differentiator; see `05-product-and-technical-spec.md`. **Confidence: Medium**
(a product judgement, not a measured fact).

---

## B. Users (Q9–Q14)

**Q9. Who visits today?**
**UNKNOWN.** No analytics access. To resolve: owner grants read access to the
GA4/Plausible property, or server logs.

**Q10. Is there a usable analytics signal at all right now?**
No. The live tracker is `UA-153406767-1` — a **Universal Analytics** property.
Google stopped processing data in standard UA properties on 01/07/2023 and has
since deleted them. The tag still loads on every page, so users pay the
privacy and network cost while the owner receives nothing.
**Confidence: High.** `LIVE:` gtag script; Google's UA sunset notice.

**Q11. What personas should the rebuild serve?**
Four, ranked: (1) curious learner, (2) educator/classroom, (3) student doing
coursework, (4) amateur/technical astronomer wanting defensible numbers. Derived
from the catalogue's own content mix. **Confidence: Medium** (inference).

**Q12. What is the core job-to-be-done?**
"Show me what this gravitational system does, quickly, and let me change one
thing and see what happens." **Confidence: Medium.**

**Q13. Do users need to trust the numbers?**
For personas 2–4, yes — and today nothing on screen tells a user whether the
integration is diverging. There are **zero** energy or angular-momentum
diagnostics in the codebase. **Confidence: High.**
`grep -rni "kinetic|potentialEnergy|angularMomentum|totalEnergy" src` → no matches.

**Q14. Is mobile a first-class target?**
It must be, but v2 currently blocks pinch-zoom (see Q40), and v1 shows a
"rotate to landscape" prompt below 400px. **Confidence: High.** `LIVE:`
viewport meta; `UP:` `.rotate-to-landscape-prompt` CSS.

---

## C. Physics correctness (Q15–Q24)

**Q15. What force law is implemented?**
Plummer-softened Newtonian acceleration:
`a_i = Σ_j G·m_j·(r_j − r_i) / (|r_ij|² + ε²)^{3/2}`. The softened form is
correct. **Confidence: High.** `UP:src/physics/integrators/euler.ts:118-131`.

**Q16. Are massless test particles separated from massive bodies?**
Partially. The direct-force loop skips sources with `m <= 0`
(`if (i !== j && this.masses[j].m > 0)`), and a separate `particle-system`
exists. But the **Barnes-Hut path inserts every mass including `m = 0`** into
the tree, so massless bodies still cost tree memory and traversal.
**Confidence: High.** `UP:euler.ts:120` vs `UP:euler.ts:constructBHTree`.

**Q17. Does the collision merge conserve momentum?**
**No.** `collisionsCheck` sets `survivor.m = massI.m + massJ.m` and then
`masses.splice(looserIndex, 1)`. The survivor's **velocity is never updated**,
its **position is never moved to the centre of mass**, and its **radius is never
recomputed**. Linear momentum jumps discontinuously on every merge unless the
two bodies happened to share a velocity.
**Confidence: High.** `UP:src/physics/collisions/collisions-check.ts:38-42`.

**Q18. Does the collision loop iterate safely?**
No. It splices from `masses` while iterating it with indices `i` and `j`, and
decrements only `massesLength`. Neither `i` nor `j` is corrected, and `massI` is
still dereferenced after the element it points at may have been removed. Bodies
can be skipped. `looserIndex--` on the last line is dead code.
**Confidence: High.** Same file, lines 44-51.

**Q19. Is the Barnes-Hut octree bounded correctly?**
No. The root box is hardcoded: `this.maximumDistance = 1000` and the root spans
`-500…+500` on each axis. A body outside that cube matches no child in
`isInTree`, so `insertMassInTree` falls through and **silently drops it** — its
mass then contributes no force at all. `useBarnesHut` defaults to **true**
(`params.useBarnesHut ?? true`), so this is the default code path.
**Confidence: High.** `UP:euler.ts:37`, `:constructBHTree`, `:insertMassInTree`.

**Q20. Is the Barnes-Hut centre of mass computed correctly?**
No. The root node is initialised with `CoM: { x: -a/2, y: -a/2, z: -a/2 }`
— i.e. the corner position, not zero — and `fixCoM` later divides the
accumulated mass-weighted sum by total mass. The spurious `(-500,-500,-500)`
seed is never removed, so the root centre of mass is offset by
`(-500,-500,-500)/M`. **Confidence: High.** `UP:euler.ts:constructBHTree`, `:fixCoM`.

**Q21. Is tree recursion depth-limited?**
No. `insertMassInTree` recurses with no depth guard. Two bodies at (near-)
identical coordinates subdivide indefinitely → stack overflow.
**Confidence: High.** `grep -rn "depth|MAX_DEPTH" src/physics` → no matches.

**Q22. Which integrators exist upstream?**
Fourteen: Euler, RK4, Verlet, PEFRL, Nyström 3/4/5/6, RKN64, RKN12, Yoshida6,
Kahan-Li8, SOFSPA10, and an orbital-elements propagator. This is genuinely
strong — far richer than most competitors. **Confidence: High.**
`UP:src/physics/integrators/index.ts`.

**Q23. Is there any regression test for any of them?**
No. There are **zero** test files in the repository.
**Confidence: High.** `find . -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__"` → empty.

**Q24. What should the rebuild's default integrator be?**
Velocity Verlet as the default (symplectic, 2nd order, one force evaluation per
step, bounded energy error over long integrations), PEFRL for higher accuracy at
~4 force evaluations/step, RK4 for familiarity and comparison. RK4 is **not**
symplectic and drifts secularly in energy — it should never be the silent
default. **Confidence: High** (standard numerical-analysis result).

---

## D. Numerical methods (Q25–Q30)

**Q25. Is the simulation timestep independent of monitor refresh rate?**
**No.** `iterate()` calls `this.integrator.iterate()` exactly once per
`requestAnimationFrame` callback, using the scenario's fixed `dt`. There is no
accumulator. A 144 Hz display therefore advances simulated time **2.4× faster**
than a 60 Hz display for the same scenario. **Confidence: High.**
`UP:src/scene/scenes/planetary-scene.ts:381-386` and `:1002`.

**Q26. Isn't `clock.getDelta()` used for that?**
No. `const delta = this.clock.getDelta()` is on line 342, but `delta` is
referenced exactly once more in the entire file — line 632, a star shader's
`time` uniform. It never reaches the integrator.
**Confidence: High.** `grep -n "delta" src/scene/scenes/planetary-scene.ts` → lines 342, 632 only.

**Q27. What data layout does the physics use?**
Array-of-objects. Every body is `{ position: {x,y,z}, velocity: {x,y,z}, ... }`
and `Vector.toObject()` allocates a **fresh** `{x,y,z}` literal per body per
sub-step. `new Vector()` is additionally allocated *inside* `BHAccelerate`,
`generateChildren`, `insertMassInTree` and `fixCoM` — i.e. inside the hot
recursion. **Confidence: High.** `UP:euler.ts`, `UP:rkn-base.ts`.

**Q28. Why does that matter?**
Structure-of-arrays over `Float64Array` gives contiguous memory, predictable
cache behaviour, zero per-step allocation, and — decisively — **zero-copy
transfer to a Web Worker** via transferable `ArrayBuffer`s. Array-of-objects
gives none of these and generates continuous GC pressure at 60 Hz.
**Confidence: High** (property of the platform).

**Q29. Is there deterministic replay?**
No. Nothing seeds or records a run, and the step count is coupled to frame
delivery (Q25), so two runs of the same scenario on the same machine need not
agree. **Confidence: High.**

**Q30. What accuracy check should the rebuild ship?**
Relative energy drift `|E(t) − E(0)| / |E(0)|` and relative angular-momentum
drift, computed on the worker and surfaced in the HUD, plus regression tests
asserting drift bounds per integrator. This turns "trust us" into "look at the
number". **Confidence: High** (design decision, standard practice).

---

## E. Data sources (Q31–Q35)

**Q31. Where does the upstream scenario data come from?**
v2 scenario descriptions cite "NASA exoplanet systems and JPL Horizons Solar
System models". **Confidence: High** for the claim being made; **UNKNOWN** for
whether each scenario JSON carries a machine-readable provenance field —
I did not audit all 4,435 files. To resolve: schema-scan every file for a
citation key.

**Q32. Which authoritative sources are openly usable?**
- **JPL Horizons** (SSD/CNEO, NASA/Caltech) — ephemerides and state vectors.
- **NASA Exoplanet Archive** (IPAC/Caltech) — confirmed exoplanet parameters.
- **IAU / NASA planetary fact sheets** — masses, radii, rotation.
All are US-government-funded public data. **Confidence: High** that these exist
and are the canonical sources; **Medium** on per-dataset reuse terms — each
must be checked at ingest time and recorded per scenario. Reuse terms are a
licensing question, answered in `04-licensing-and-clean-room.md`.

**Q33. Should the rebuild embed a full ephemeris?**
No. Ship *initial conditions* (epoch + state vectors) with a citation, and
integrate forward. Embedding full ephemerides would bloat the bundle and add
a data-licensing surface for no user benefit. **Confidence: High.**

**Q34. Must every scenario carry a citation?**
Yes — it is the single cheapest trust signal, and today it is absent from the
schema as a required field. The rebuild's schema makes `source` mandatory.
**Confidence: High** (design decision).

**Q35. What physical constants should be canonical?**
Work in AU / solar masses / days, with `G` derived from the **Gaussian
gravitational constant** `k = 0.01720209895` such that `G = k²` in those units
— this makes `G` exact by definition rather than a measured quantity with
uncertainty, and is the standard choice for solar-system work.
**Confidence: High.**

---

## F. Rendering (Q36–Q39)

**Q36. What renders today?**
Three.js `^0.169.0`, with a WebGL canvas plus a second 2D canvas overlay for
labels. **Confidence: High.** `UP:package.json`; `LIVE:` two `<canvas>` elements.

**Q37. Is per-frame physics state held in React/Redux?**
**Yes — twice over, and this is the single worst performance defect.** Each
frame the scene (a) deep-clones the *entire* Redux state with
`JSON.parse(JSON.stringify(this.store.getState()))`, and (b) dispatches the
whole `masses` array back into the store via `modifyScenarioProperty`. So every
frame does a full serialise + parse + reducer pass + subscriber notification
over all body state. **Confidence: High.**
`UP:planetary-scene.ts:344` and `:984-995`.

**Q38. Is there a Web Worker?**
No. `grep -ril "worker" src` returns nothing. All physics runs on the main
thread, competing with React, Three.js and the compositor.
**Confidence: High.**

**Q39. Should the rebuild keep Three.js?**
Yes initially. It is the mature, well-documented choice with instancing,
adaptive-quality hooks and a large ecosystem; nothing found in research
justifies the cost of a bespoke WebGL/WebGPU layer at v1. Revisit only against
a measured bottleneck. **Confidence: Medium** (engineering judgement).

---

## G. Accessibility (Q40–Q46)

**Q40. Does the site block browser zoom?**
**v2: yes.** Its viewport meta is
`width=device-width, minimum-scale=1.0, maximum-scale=1.0` — `maximum-scale=1.0`
prevents pinch-zoom. That fails **WCAG 2.1 SC 1.4.4 (Resize Text, AA)**.
**v1: no** — its meta is `width=device-width, initial-scale=1, shrink-to-fit=no`;
`shrink-to-fit` is a legacy iOS property and does **not** restrict zoom. I am
stating this precisely because the two versions differ and it would be easy to
over-claim. **Confidence: High.** `LIVE:` viewport meta on each.

**Q41. Are interactive controls semantic elements?**
No. Play/pause, reset, save and the tab strip are `<div class="button">` and
`<li class="nav-item"><span>`. They are not `<button>`, carry no `role`, no
`tabindex`, and no accessible name — the label is a Font Awesome glyph
(`<i class="fas fa-play">`). They are unreachable and unannounceable by keyboard
and screen reader. **Confidence: High.** `LIVE:` rendered HTML of a scenario page.

**Q42. Are the tabs real tabs?**
No. `<ul class="nav">` / `<li class="nav-item active">` with no `role="tablist"`,
`role="tab"`, `aria-selected` or `aria-controls`.
**Confidence: High.** Same source.

**Q43. Does the canvas have a text alternative?**
No. `<canvas width="1920" height="993">` has no `aria-label`, no `role`, and no
fallback content between its tags. A non-visual user gets nothing at all.
**Confidence: High.**

**Q44. Is reduced motion respected?**
No `prefers-reduced-motion` media query appears in the served CSS.
**Confidence: High** for the fetched stylesheet; **Medium** overall (I did not
fetch every stylesheet on every route).

**Q45. What is the accessibility target for the rebuild?**
WCAG 2.2 AA for all UI chrome, with the canvas treated as a rich image that has
a live textual equivalent (an accessible data table of bodies + a live region
announcing state changes). Automated axe checks in CI plus a scripted
keyboard-only walkthrough. **Confidence: High** (design decision).

**Q46. Can a gravity simulator be meaningfully accessible?**
The 3D view cannot be made equivalent for a blind user, but the *information*
can: body list, orbital elements, conservation diagnostics and play state are
all expressible as semantic HTML. The honest posture is "the data is fully
accessible; the visualisation is an enhancement." **Confidence: Medium.**

---

## H. SEO (Q47–Q51)

**Q47. Is the declared sitemap reachable?**
**No.** `robots.txt` declares `Sitemap: https://gravitysimulator.org/sitemap-index.xml`.
That URL returns **HTTP 404** (Netlify's "Page not found"). Search engines are
being pointed at a dead sitemap.
**Confidence: High.** Fetched 21/09/2026, `statusCode: 404`.

**Q48. Are canonicals correct?**
v1: yes — `<link rel="canonical" href="https://gravitysimulator.org/solar-system/the-solar-system">`
matches the URL. v2: **broken** — `og:url` is
`https://gravitysimulator.org/version-2/version-2/scenarios/all/`, with
`/version-2/` **doubled**, because `siteUrl` already ends in `/version-2` and the
`pathPrefix` is applied again on top. **Confidence: High.**
`LIVE:` v2 metadata; `UP:gatsby-config.ts:6,11-16`.

**Q49. Are social images valid URLs?**
No. v1 emits `og:image` =
`https://www.gravitysimulator.org/images/social/The Solar System.jpg` —
**literal unencoded spaces**, and on the `www.` host while the canonical is
apex. Spaces are not legal in a URL and must be `%20`.
**Confidence: High.**

**Q50. Is there structured data?**
Yes on v1: JSON-LD `SoftwareApplication` with
`applicationCategory: "GameApplication"`. For an educational physics tool that
is a questionable category, and there is no `BreadcrumbList` and no
`LearningResource`/`Dataset` markup. **Confidence: High** for what is present;
**Medium** for the judgement that the category is wrong.

**Q51. What is the biggest SEO structural problem?**
Two indexable copies of the same product (apex and `/version-2/`) with
overlapping content and no cross-version canonical strategy — self-competition
across thousands of near-duplicate pages. **Confidence: Medium** (the
duplication is certain; the ranking impact is an inference).

---

## I. Privacy (Q52–Q55)

**Q52. Is there a consent mechanism before third-party tracking?**
No CMP, cookie banner or consent gate appears in the served HTML. AdSense and
the gtag script load unconditionally in `<head>`.
**Confidence: High** for the fetched page; **Medium** that no consent layer
exists anywhere on the site.

**Q53. Is that a compliance problem?**
For EU/UK visitors, non-essential cookies and ad personalisation generally
require prior consent (ePrivacy + GDPR). South Africa's POPIA imposes its own
lawful-basis and direct-marketing duties. I am flagging a **gap requiring legal
review**, not issuing a legal conclusion — that is out of my remit.
**Confidence: Medium** (the absence is verified; the legal consequence is not mine to settle).

**Q54. Is there a privacy policy page?**
**UNKNOWN.** No privacy link appeared in the v1 navigation or v2 footer I
fetched. To resolve: crawl all routes for a `/privacy` page.

**Q55. What should the rebuild's policy be?**
Zero third-party requests on first paint; no analytics without explicit opt-in;
no ads inside the simulation view at all; a real privacy page. Default to
privacy-preserving, self-hosted, cookieless measurement if any is used.
**Confidence: High** (design decision).

---

## J. Security (Q56–Q59)

**Q56. What security headers does the live site send?**
Verified 21/09/2026 (grade **B**, server: Netlify, IP 35.157.26.135):

| Header | Value | Verdict |
|---|---|---|
| `content-security-policy` | `frame-ancestors 'none'` | present but **no `default-src`/`script-src`** — no XSS mitigation |
| `strict-transport-security` | `max-age=31536000` | present, **no `includeSubDomains`, no `preload`** |
| `x-frame-options` | `DENY` | present |
| `x-content-type-options` | — | **missing** |
| `referrer-policy` | — | **missing** |
| `permissions-policy` | — | **missing** |

**Confidence: High.** Raw response headers.

**Q57. Are third-party scripts integrity-checked?**
No. Font Awesome 4.7.0 is loaded from `cdnjs.cloudflare.com` with no
`integrity` attribute and no `crossorigin`. **Confidence: High.** `LIVE:` link tag.

**Q58. Is imported scenario data validated?**
No runtime schema validation library is present in `package.json` (no Zod, no
Ajv, no JSON-Schema validator). Saved/imported scenarios are parsed and spread
into state. **Confidence: High** for the absence of a validator;
**Medium** that this is exploitable — I did not attempt an exploit, and I am
not going to.

**Q59. Does the build mutate its own dependencies?**
**Yes, and this is a serious maintainability and supply-chain smell.**
`gatsby-node.ts` defines `patchGatsbyLoaderStaleCheck()`, which reads
`node_modules/gatsby/cache-dir/loader.js` (and three other paths), string-replaces
two expressions, and **writes the file back**. It is invoked at module top level
plus in four Gatsby lifecycle hooks. The build rewrites installed dependency
source on every run. **Confidence: High.** `UP:gatsby-node.ts:27-90`.

---

## K. Licensing (Q60–Q63)

**Q60. Does the upstream repo actually contain a GPL licence?**
**No.** `package.json` has `"license": "GNU General Public License v3.0"`, but
there is **no `LICENSE` or `COPYING` file anywhere in the repository**, and that
string is not a valid SPDX identifier (`GPL-3.0-only` / `GPL-3.0-or-later`
are). GPLv3 §10 and the licence's own instructions require the full licence text
to accompany the work. **Confidence: High.**
`find . -iname "LICENSE*" -o -iname "COPYING*"` → empty.

**Q61. Does the project assert copyright elsewhere?**
Yes. The v2 footer reads "Copyright © Darrell Arjuna Huffman 2024".
**Confidence: High.** `LIVE:` v2 footer.

**Q62. What does that ambiguity mean for us?**
It makes reuse *riskier*, not safer. A missing licence file does not place code
in the public domain; the default is exclusive copyright, and the `package.json`
string signals copyleft intent. Building on it would mean taking on GPLv3
obligations of uncertain scope. **Confidence: High** on the copyright default;
the strategic conclusion is in `04-licensing-and-clean-room.md`.

**Q63. What is the decision?**
**Clean-room.** No upstream code, assets, scenario files, shaders, text or
implementation structure is copied. Physics is implemented from published
scientific method; data comes from openly licensed primary sources with
per-scenario citation. This is also the *cheapest* path here, because
`logiagenesis/gravity` is empty — there is no existing derivation to unwind.
**Confidence: High.**

---

## L. Deployment (Q64–Q66)

**Q64. Where is the site hosted?**
Netlify (`server: Netlify`, `cache-status: "Netlify Edge"`, and the 404 body is
Netlify's support page). **Confidence: High.**

**Q65. Is there CI?**
No. The upstream repo has **no `.github` directory** — no workflows, no
automated checks, and no tests for CI to run.
**Confidence: High.**

**Q66. What should the rebuild deploy as?**
A static bundle plus a worker, deployable to any static host/CDN. No server is
required for the core product, which keeps hosting cost near zero and removes a
whole class of security surface. **Confidence: High.**

---

## M. Monetisation (Q67–Q69)

**Q67. Is the current model working?**
**UNKNOWN** — no revenue data. What *is* verifiable is that it is implemented in
the most user-hostile available way: ads in the `<head>` of the simulation page,
contradicting the project's own stated policy (Q7).

**Q68. What is the constraint for the rebuild?**
No ads inside the active simulation, ever. That is a product-quality line, and
the brief states it explicitly.

**Q69. What are the honest alternatives?**
Ads confined to catalogue/marketing routes and loaded only post-consent;
optional supporter tier; educational licensing. Each needs owner input —
see **Blocking questions** below. **Confidence: Low** (commercial, not technical).

---

## N. Education / classroom (Q70–Q72)

**Q70. What blocks classroom use today?**
Keyboard inaccessibility (Q41), blocked zoom on v2 (Q40), ads on simulation
pages (Q7), no shareable/importable scenario format for assignments, and no
correctness indicator (Q13). **Confidence: High.**

**Q71. What would unlock it?**
Guided experiments with explicit learning objectives, a "what am I looking at"
panel, per-scenario citations, share-by-URL, and offline-capable static
hosting. **Confidence: Medium.**

**Q72. Is any of this legally sensitive for minors?**
Ad-serving to an audience that plausibly includes children raises COPPA-style
questions. **Flagging for legal review, not concluding.**
**Confidence: Low.**

---

## O. Long-term maintainability (Q73–Q76)

**Q73. What is the biggest maintainability risk upstream?**
The dependency monkey-patch (Q59) — it silently breaks on any Gatsby update and
makes builds non-reproducible. Second: 4,435 hand-maintained JSON files with no
schema and no validation.
**Confidence: High.**

**Q74. Are there automated quality gates?**
Prettier and `tsc --noEmit` exist as npm scripts; there is **no linter, no test
runner, and no CI to run any of it**. `UP:package.json` scripts.
**Confidence: High.**

**Q75. Is the stack current?**
Repo: Gatsby 5, React 18, Three 0.169 — dated but maintained. Live v1: Gatsby
2 — long past end of life. **Confidence: High.**

**Q76. What single architectural decision most improves maintainability?**
Separating the **simulation core** (pure, typed-array, dependency-free,
independently testable, runs in a worker) from **rendering** and from **UI**.
Each can then be tested and replaced independently. This is the spec's
organising principle. **Confidence: High.**

---

## Blocking questions for the owner

These genuinely cannot be answered by inspection, research or measurement. I
have **proceeded on the stated default** for each so that no work is blocked;
each is cheap to change later.

| # | Question | Default I am proceeding on | Cost to change later |
|---|---|---|---|
| B1 | Is the rebuild proprietary or open-source? | **Clean-room, no upstream code**, licence left unset | Low — clean-room is safe either way |
| B2 | Keep ads at all? | **No ads anywhere in the new app**; no ad code written | Low |
| B3 | Analytics vendor and consent posture? | **No analytics shipped**; no third-party requests | Low |
| B4 | Migrate the 4,435 upstream scenarios, or build a fresh catalogue? | **Fresh, clean-room scenarios from primary sources** | Medium — a pipeline exists either way |
| B5 | Will `gravitysimulator.org` DNS point at the rebuild, and does v1 stay up? | **Assume a clean single-origin deploy**; no redirect map written | Medium — needs a redirect plan if v1 URLs must survive |
| B6 | Target audience priority: general public vs classroom? | **Learner-first, classroom-capable** | Low |

**Nothing in the build below depends on B1–B6 being answered first.**
