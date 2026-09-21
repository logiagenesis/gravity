# 02 — Top 20 Competitive / Technical Benchmark

**Scope.** Twenty organisations or products that build things comparable to a
web gravity simulator: 3D space simulators, orbital-mechanics tools, scientific
visualisation platforms, astronomy apps, simulation engines, and space-mission
analysis software. A separate section covers non-company benchmark leaders
(academic codes, standards bodies, data providers) that matter technically but
are not companies.

**Evidence discipline.** Researched 21/09/2026. Rendering technology and physics
method are stated **only where a primary or strong secondary source says so**.
Where a stack is not publicly documented it is written **UNKNOWN** — not
guessed. Pricing is time-sensitive and marked as such; where I could not
confirm a current figure I say so rather than quote a remembered number.

**Confidence:** High = vendor/primary documentation or source code.
Medium = reputable secondary source. Low = single weak source or inference.

---

## 1. Giant Army — Universe Sandbox

| Field                 | Finding                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Desktop physics sandbox: collide planets, alter stars, run n-body gravity at arbitrary speed, destroy worlds                                                                             |
| **Target users**      | Hobbyists, students, science communicators; entertainment-first                                                                                                                          |
| **Rendering**         | **Unity** engine — _Confidence: Medium_ (widely reported; not read from source)                                                                                                          |
| **Physics**           | N-body Newtonian gravity; also thermal/collision/tidal models. Specific integrator **UNKNOWN**                                                                                           |
| **Data sources**      | Real body catalogues for presets; specifics **UNKNOWN**                                                                                                                                  |
| **Discovery model**   | In-app preset browser; no web catalogue                                                                                                                                                  |
| **UX strengths**      | Immediate, tactile, visually spectacular; "what if" framing is superb at creating curiosity                                                                                              |
| **UX weaknesses**     | Desktop install required; paid wall before first experience; no shareable link                                                                                                           |
| **Performance**       | Native desktop GPU — not web-constrained                                                                                                                                                 |
| **Monetisation**      | Paid, **USD 29.99** — _Confidence: Medium, price checked 21/09/2026, volatile_                                                                                                           |
| **A11y / privacy**    | **UNKNOWN** — no published accessibility conformance report found                                                                                                                        |
| **Copy conceptually** | "What if?" as the primary hook. Destruction and extremes are a legitimate teaching device                                                                                                |
| **Beat them on**      | Zero-install, zero-cost, instantly linkable. A URL beats a 30-dollar download for a curious visitor                                                                                      |
| **Evidence**          | [universesandbox.com](https://universesandbox.com/) · [Steam](https://store.steampowered.com/app/230290/Universe_Sandbox/) · [Wikipedia](https://en.wikipedia.org/wiki/Universe_Sandbox) |

## 2. Cosmographic Software — SpaceEngine

| Field                 | Finding                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | 1:1-scale procedural universe simulator; real catalogues where known, procedural generation elsewhere                                                                  |
| **Target users**      | Enthusiasts, VR users, content creators                                                                                                                                |
| **Rendering**         | Proprietary in-house engine — _Confidence: Medium._ Internals **UNKNOWN**                                                                                              |
| **Physics**           | Primarily Keplerian orbital propagation for navigation/scale, not a general n-body integrator — _Confidence: Low_                                                      |
| **Data sources**      | Real star/exoplanet catalogues plus procedural generation for uncharted space — _Confidence: High_ (vendor description)                                                |
| **Discovery model**   | In-app search by object name/catalogue designation                                                                                                                     |
| **UX strengths**      | Unmatched sense of scale; seamless zoom from galaxy to surface                                                                                                         |
| **UX weaknesses**     | Windows-centric; heavy GPU requirement; steep first-run learning curve                                                                                                 |
| **Performance**       | Aggressive LOD and procedural streaming — _Confidence: Medium_                                                                                                         |
| **Monetisation**      | Paid on Steam. **Current price not confirmed** — discounts seen but base figure unverified; I am not quoting a number                                                  |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                            |
| **Copy conceptually** | Continuous scale navigation without modal "zoom levels"                                                                                                                |
| **Beat them on**      | Scientific _defensibility_: SpaceEngine blends real and procedural data; we cite every number                                                                          |
| **Evidence**          | [spaceengine.org](https://spaceengine.org/) · [Wikipedia](https://en.wikipedia.org/wiki/SpaceEngine) · [Steam](https://store.steampowered.com/app/314650/SpaceEngine/) |

## 3. NASA / JPL-Caltech — Eyes on the Solar System

| Field                 | Finding                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Official NASA 3D visualisation of the solar system, missions and spacecraft, in-browser                                                                                   |
| **Target users**      | General public, press, educators — public outreach                                                                                                                        |
| **Rendering**         | **WebGL in-browser.** NASA moved from an installed client to a WebGL web engine; the desktop client now only receives mission updates — _Confidence: High_                |
| **Physics**           | Ephemeris-driven playback of known trajectories, not interactive n-body integration — _Confidence: Medium_                                                                |
| **Data sources**      | JPL mission and ephemeris data — _Confidence: High_ (first-party)                                                                                                         |
| **Discovery model**   | Curated mission/destination navigation; time controls                                                                                                                     |
| **UX strengths**      | Authoritative; beautiful; time scrubbing is excellent; no install                                                                                                         |
| **UX weaknesses**     | You cannot change anything — it is a viewer, not a sandbox. No "what if"                                                                                                  |
| **Performance**       | Web-delivered, mobile-capable — _Confidence: Medium_                                                                                                                      |
| **Monetisation**      | None — publicly funded                                                                                                                                                    |
| **A11y / privacy**    | US federal sites are subject to **Section 508**; specific conformance for this app **UNKNOWN**                                                                            |
| **Copy conceptually** | Time-scrubbing UI; authoritative sourcing; "no install" as a first-class value                                                                                            |
| **Beat them on**      | **Interactivity.** They show you what happened; we let you change it and see what would happen                                                                            |
| **Evidence**          | [science.nasa.gov/eyes](https://science.nasa.gov/eyes/) · [JPL announcement](https://www.jpl.nasa.gov/news/explore-the-solar-system-with-nasas-new-and-improved-3d-eyes/) |

## 4. Ansys (formerly AGI) — STK / Systems Tool Kit

| Field                 | Finding                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What it does**      | Professional digital mission engineering: orbit determination, manoeuvre design, sensor coverage, link budgets, constellation analysis                                                                                                                             |
| **Target users**      | Aerospace/defence engineers, satellite operators, government                                                                                                                                                                                                       |
| **Rendering**         | Proprietary desktop 3D + web viewers. Internals **UNKNOWN**                                                                                                                                                                                                        |
| **Physics**           | High-fidelity astrodynamics: full force models, numerical + analytical propagators — _Confidence: High_ (product documentation)                                                                                                                                    |
| **Data sources**      | Ephemerides, TLEs, terrain, RF models                                                                                                                                                                                                                              |
| **Discovery model**   | Scenario/object tree; not a public catalogue                                                                                                                                                                                                                       |
| **UX strengths**      | Depth and rigour unmatched; trusted for real missions                                                                                                                                                                                                              |
| **UX weaknesses**     | Enormous learning curve; enterprise procurement; unreachable for a curious member of the public                                                                                                                                                                    |
| **Performance**       | Desktop/server compute                                                                                                                                                                                                                                             |
| **Monetisation**      | Commercial licence, tiered (Pro / Premium / Enterprise). **Public list pricing is not published**; one UK Space Agency contract for an STK licence was published at **£17,760 ex-VAT for one year** — _Confidence: Medium, single public tender, not a list price_ |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                                                                                                                        |
| **Copy conceptually** | Rigour as a product value; explicit force-model configuration; named propagators                                                                                                                                                                                   |
| **Beat them on**      | Accessibility of the _concept_. STK is where professionals go; we can be where everyone else learns why it matters                                                                                                                                                 |
| **Evidence**          | [Ansys STK](https://www.ansys.com/products/missions/ansys-stk) · [AGI licensing](https://licensing.agi.com/stk/)                                                                                                                                                   |

## 5. NASA Goddard — GMAT (General Mission Analysis Tool)

| Field                 | Finding                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Open-source mission design, optimisation and navigation, LEO through deep space                                               |
| **Target users**      | Mission designers, researchers, students                                                                                      |
| **Rendering**         | Desktop GUI (C++) with a 3D view — _Confidence: High_ (it is C++, per NASA)                                                   |
| **Physics**           | High-fidelity numerical propagation, multiple force models and optimisers — _Confidence: High_                                |
| **Data sources**      | JPL DE ephemerides, SPICE                                                                                                     |
| **Discovery model**   | Script + GUI; sample mission library                                                                                          |
| **UX strengths**      | Genuinely free and genuinely capable; scriptable; real missions use it                                                        |
| **UX weaknesses**     | Desktop install; engineer-facing UI; no casual on-ramp                                                                        |
| **Performance**       | Native C++                                                                                                                    |
| **Monetisation**      | None — **Apache License 2.0** — _Confidence: High_                                                                            |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                   |
| **Copy conceptually** | **Apache-2.0 is the model to follow for permissive reuse.** Also: scriptable, reproducible scenario definitions               |
| **Beat them on**      | Time-to-first-insight. GMAT needs an afternoon; we should need ten seconds                                                    |
| **Evidence**          | [nasa/GMAT on GitHub](https://github.com/nasa/GMAT) · [NASA Software Catalog](https://software.nasa.gov/software/GSC-19097-1) |

## 6. Cesium GS — CesiumJS / Cesium ion

| Field                 | Finding                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Open-source JS library for 3D globes and maps; the de-facto standard for web geospatial and satellite visualisation                                                   |
| **Target users**      | Developers building geospatial/space web apps                                                                                                                         |
| **Rendering**         | **WebGL**, hardware-accelerated, tuned for dynamic data; a **WebGPU** renderer has been in progress — _Confidence: High_ for WebGL, _Medium_ for WebGPU status/timing |
| **Physics**           | Not a physics engine — it is visualisation + coordinate/time systems                                                                                                  |
| **Data sources**      | 3D Tiles, terrain, imagery; open formats                                                                                                                              |
| **Discovery model**   | Developer library, not an end-user catalogue                                                                                                                          |
| **UX strengths**      | Excellent time-dynamic data handling; rigorous coordinate/time reference frames                                                                                       |
| **UX weaknesses**     | Globe-centric; heavyweight for a pure heliocentric n-body view                                                                                                        |
| **Performance**       | Mature LOD/streaming for massive datasets — _Confidence: High_                                                                                                        |
| **Monetisation**      | **Apache 2.0** library, free for commercial use; monetised via **Cesium ion** hosted tiling services — _Confidence: High._ Open core, paid infrastructure             |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                           |
| **Copy conceptually** | Open-source core + paid service is the cleanest monetisation in this space. Also: take reference frames and time standards seriously                                  |
| **Beat them on**      | Not a competitor — a possible dependency. Rejected for v1 as globe-oriented overhead we do not need                                                                   |
| **Evidence**          | [cesium.com/platform/cesiumjs](https://cesium.com/platform/cesiumjs/) · [CesiumGS/cesium](https://github.com/CesiumGS/cesium)                                         |

## 7. Stellarium Labs — Stellarium Web / Stellarium Mobile

| Field                 | Finding                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Browser and mobile planetarium: realistic sky from any location/time                                                                                                                                  |
| **Target users**      | Amateur astronomers, stargazers, educators                                                                                                                                                            |
| **Rendering**         | **Stellarium Web Engine: a C engine compiled to WebAssembly, rendering via WebGL, with a Vue.js UI, deployable fully static** — _Confidence: High_ (project documentation/repo)                       |
| **Physics**           | Positional astronomy / ephemeris, not n-body dynamics                                                                                                                                                 |
| **Data sources**      | Gaia (>1 billion stars), HiPS surveys, planetary textures — _Confidence: High_                                                                                                                        |
| **Discovery model**   | Object search by name/designation; sky click-through                                                                                                                                                  |
| **UX strengths**      | Fast, beautiful, works on a phone, no install                                                                                                                                                         |
| **UX weaknesses**     | Sky-view paradigm only; not a dynamics sandbox                                                                                                                                                        |
| **Performance**       | **WASM for the hot path, JS for UI** — exactly the right architecture, and strong evidence the pattern works on the web                                                                               |
| **Monetisation**      | Free web tier; paid mobile app (Stellarium Mobile Plus); desktop Stellarium is **GPL**                                                                                                                |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                                                           |
| **Copy conceptually** | **The single most relevant architectural precedent: compiled hot-path engine + light JS UI + fully static hosting.** Validates our worker-core design, and marks WASM as the credible v2 upgrade path |
| **Beat them on**      | Interactive dynamics — they show where things _are_, we show how things _move and why_                                                                                                                |
| **Evidence**          | [stellarium-web-engine](https://github.com/Stellarium/stellarium-web-engine) · [Stellarium Labs](https://www.stellarium-labs.com/stellarium-web/)                                                     |

## 8. Celestia Project — Celestia

| Field                 | Finding                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Free real-time 3D space simulation; travel to 100,000+ stars                                                                                      |
| **Target users**      | Enthusiasts, educators                                                                                                                            |
| **Rendering**         | Desktop **OpenGL** — _Confidence: High_                                                                                                           |
| **Physics**           | Trajectories from **Keplerian elements, VSOP87 analytic theory, and SPICE kernels**; JPL DE / INPOP ephemerides in forks — _Confidence: High_     |
| **Data sources**      | SPICE, JPL DE ephemerides, star catalogues                                                                                                        |
| **Discovery model**   | `.ssc` catalogue files; add-on ecosystem                                                                                                          |
| **UX strengths**      | Extensible add-on ecosystem; genuinely scientific trajectory sources                                                                              |
| **UX weaknesses**     | Dated UI; desktop-only; contributor bus-factor risk                                                                                               |
| **Performance**       | Native OpenGL                                                                                                                                     |
| **Monetisation**      | None — **GPL v2 or later** — _Confidence: High_                                                                                                   |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                       |
| **Copy conceptually** | Trajectory _source_ is a first-class, declared property (elements vs analytic theory vs kernel). Our schema should record provenance the same way |
| **Beat them on**      | Platform reach and modern UI                                                                                                                      |
| **Evidence**          | [CelestiaProject/Celestia](https://github.com/CelestiaProject/Celestia) · [Celestia/SPICE wikibook](https://en.wikibooks.org/wiki/Celestia/SPICE) |

## 9. University of Colorado Boulder — PhET Interactive Simulations

| Field                 | Finding                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Free interactive HTML5 science/maths simulations, including gravity and orbits                                                                                                                                                                                                                                 |
| **Target users**      | **Classrooms, K-12 through undergraduate** — the education segment, directly                                                                                                                                                                                                                                   |
| **Rendering**         | **HTML5** (Canvas/SVG via their own Scenery stack) — _Confidence: High_ for HTML5                                                                                                                                                                                                                              |
| **Physics**           | Simplified, pedagogically tuned models — deliberately not research-grade                                                                                                                                                                                                                                       |
| **Data sources**      | N/A — conceptual models                                                                                                                                                                                                                                                                                        |
| **Discovery model**   | Searchable, filterable library by subject and grade level — **the best discovery model in this entire list**                                                                                                                                                                                                   |
| **UX strengths**      | Ruthless pedagogical focus; one concept per sim; immediate manipulation                                                                                                                                                                                                                                        |
| **UX weaknesses**     | Deliberately low fidelity; not for anyone who wants real numbers                                                                                                                                                                                                                                               |
| **Performance**       | Tuned for low-end school hardware — _Confidence: Medium_                                                                                                                                                                                                                                                       |
| **Monetisation**      | Free; grant and donation funded                                                                                                                                                                                                                                                                                |
| **A11y / privacy**    | **The benchmark leader, by a wide margin.** Published research programme on keyboard navigation, screen-reader support via native HTML + WAI-ARIA, dynamic auditory descriptions built in partnership with OCAD's Inclusive Design Research Centre, and sonification — _Confidence: High_                      |
| **Copy conceptually** | **Their accessibility method is the one to adopt**: native HTML enhanced with ARIA, a live-updating textual description layer for the visual canvas, and full keyboard operation. Also their grade/subject filtering                                                                                           |
| **Beat them on**      | Scientific fidelity. PhET teaches the concept; we can teach the concept _and_ give defensible numbers                                                                                                                                                                                                          |
| **Evidence**          | [phet.colorado.edu](https://phet.colorado.edu/) · [Accessibility research (PERC)](https://www.per-central.org/items/perc/4806.pdf) · [SNOW/IDRC writeup](https://snow.idrc.ocadu.ca/articles/the-phet-interactive-simulations-project-working-to-increase-access-to-interactive-stem-simulations-part-2-of-2/) |

## 10. INOVE / Solar System Scope

| Field                 | Finding                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| **What it does**      | Web + mobile + desktop 3D model of the solar system and night sky                                  |
| **Target users**      | General public, schools                                                                            |
| **Rendering**         | **WebGL** in the browser — _Confidence: High_ (vendor states WebGL requirement)                    |
| **Physics**           | Orrery-style positional model, not interactive n-body — _Confidence: Medium_                       |
| **Data sources**      | **UNKNOWN** in detail                                                                              |
| **Discovery model**   | Object selection panels                                                                            |
| **UX strengths**      | Clean, fast, approachable; freely usable textures have spread widely                               |
| **UX weaknesses**     | Viewer not sandbox; limited depth                                                                  |
| **Performance**       | Lightweight web — _Confidence: Medium_                                                             |
| **Monetisation**      | Free web; free mobile with IAP; **desktop at USD 9.80** — _Confidence: Medium, checked 21/09/2026_ |
| **A11y / privacy**    | **UNKNOWN**                                                                                        |
| **Copy conceptually** | Low-friction free web tier funnelling to a paid richer client                                      |
| **Beat them on**      | Depth and interactivity                                                                            |
| **Evidence**          | [solarsystemscope.com](https://www.solarsystemscope.com/)                                          |

## 11. Simulation Curriculum — SkySafari

| Field                 | Finding                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **What it does**      | Mobile planetarium and telescope control                                                                    |
| **Target users**      | Amateur astronomers, telescope owners                                                                       |
| **Rendering**         | Native mobile; internals **UNKNOWN**                                                                        |
| **Physics**           | Positional astronomy                                                                                        |
| **Data sources**      | Large star/DSO catalogues                                                                                   |
| **Discovery model**   | Strong object search and observing lists                                                                    |
| **UX strengths**      | Best-in-class object search; hardware integration                                                           |
| **UX weaknesses**     | App-store only; tiered pricing confusion                                                                    |
| **Performance**       | **UNKNOWN**                                                                                                 |
| **Monetisation**      | Paid tiers (Basic/Plus/Pro) — _Confidence: Medium_                                                          |
| **A11y / privacy**    | **UNKNOWN**                                                                                                 |
| **Copy conceptually** | **Observing lists** ≈ our saved-scenario collections. Tiering by depth rather than by paywalling the basics |
| **Beat them on**      | Web reach; shareability                                                                                     |
| **Evidence**          | [skysafariastronomy.com](https://skysafariastronomy.com/) — _Confidence: Medium overall_                    |

## 12. Vito Technology — Star Walk

| Field                 | Finding                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| **What it does**      | Consumer AR sky-identification app                                           |
| **Target users**      | Mass-market casual public                                                    |
| **Rendering**         | Native mobile + AR; internals **UNKNOWN**                                    |
| **Physics**           | Positional only                                                              |
| **Data sources**      | **UNKNOWN**                                                                  |
| **Discovery model**   | Point-your-phone AR discovery                                                |
| **UX strengths**      | Lowest-friction onboarding in the category; beautiful                        |
| **UX weaknesses**     | Shallow; ad/subscription pressure                                            |
| **Performance**       | **UNKNOWN**                                                                  |
| **Monetisation**      | Freemium + subscription — _Confidence: Medium_                               |
| **A11y / privacy**    | **UNKNOWN**                                                                  |
| **Copy conceptually** | Onboarding that produces delight within seconds, before any explanation      |
| **Beat them on**      | Substance — and by not monetising via interruption                           |
| **Evidence**          | [vitotechnology.com](https://vitotechnology.com/) — _Confidence: Low–Medium_ |

## 13. Intercept Games / Private Division (Take-Two) — Kerbal Space Program

| Field                 | Finding                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Rocket-building and spaceflight game with orbital mechanics as core mechanic                                                                              |
| **Target users**      | Gamers; became an accidental orbital-mechanics teaching tool                                                                                              |
| **Rendering**         | **Unity** (KSP 1) — _Confidence: Medium_                                                                                                                  |
| **Physics**           | **Patched-conic approximation**, single dominant body at a time — explicitly _not_ n-body — _Confidence: Medium_                                          |
| **Data sources**      | Fictional Kerbol system                                                                                                                                   |
| **Discovery model**   | In-game progression                                                                                                                                       |
| **UX strengths**      | The best manoeuvre-node UI ever built for a general audience; failure is fun and instructive                                                              |
| **UX weaknesses**     | Enormous time investment; KSP2's troubled development damaged trust — _Confidence: Medium_                                                                |
| **Performance**       | Patched conics chosen **specifically** because n-body is expensive and unstable for gameplay — a real engineering lesson                                  |
| **Monetisation**      | Paid game                                                                                                                                                 |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                               |
| **Copy conceptually** | **Manoeuvre nodes** and predicted-trajectory overlay: change something, see the future path update live. Also: patched conics as a legitimate _fast mode_ |
| **Beat them on**      | Honesty about the model, and true n-body when the user wants it                                                                                           |
| **Evidence**          | [kerbalspaceprogram.com](https://www.kerbalspaceprogram.com/) — _Confidence: Medium_                                                                      |

## 14. Algoryx Simulation AB — Algodoo / AGX Dynamics

| Field                 | Finding                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Algodoo: 2D physics sandbox for education. AGX Dynamics: commercial multibody physics for industrial simulation and digital twins |
| **Target users**      | Algodoo: schools. AGX: industrial simulation engineers                                                                            |
| **Rendering**         | **UNKNOWN**                                                                                                                       |
| **Physics**           | Rigid-body/multibody dynamics; AGX targets real-time high-fidelity — _Confidence: Medium_                                         |
| **Data sources**      | N/A                                                                                                                               |
| **Discovery model**   | Algodoo scene sharing                                                                                                             |
| **UX strengths**      | Algodoo's draw-it-and-it-falls immediacy is exceptional for beginners                                                             |
| **UX weaknesses**     | Algodoo is 2D and its development has been quiet — _Confidence: Low_                                                              |
| **Performance**       | **UNKNOWN**                                                                                                                       |
| **Monetisation**      | **Dual model: free education tool as the funnel, commercial industrial engine as the revenue.** Structurally interesting          |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                       |
| **Copy conceptually** | Free education product and paid professional product built on one core engine                                                     |
| **Beat them on**      | 3D, and a domain with real published data                                                                                         |
| **Evidence**          | [algoryx.se](https://www.algoryx.se/) · [algodoo.com](http://www.algodoo.com/) — _Confidence: Low–Medium_                         |

## 15. Wolfram Research — Wolfram Alpha / Mathematica / Demonstrations

| Field                 | Finding                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Computational knowledge engine; symbolic/numeric computing; a large library of interactive demonstrations including orbital mechanics |
| **Target users**      | Students, researchers, engineers                                                                                                      |
| **Rendering**         | Proprietary; Demonstrations historically required the CDF plugin — a cautionary tale about plugin dependence — _Confidence: Medium_   |
| **Physics**           | General numerical/symbolic computation                                                                                                |
| **Data sources**      | Extensive curated data, including astronomical                                                                                        |
| **Discovery model**   | **Natural-language query** — genuinely differentiated                                                                                 |
| **UX strengths**      | Ask in plain words, get a computed answer with units                                                                                  |
| **UX weaknesses**     | Paywalled depth; CDF plugin friction                                                                                                  |
| **Performance**       | Server-side compute                                                                                                                   |
| **Monetisation**      | Subscription + licences                                                                                                               |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                           |
| **Copy conceptually** | Natural-language entry into a structured catalogue; always show units                                                                 |
| **Beat them on**      | Open, inspectable method. Wolfram is a black box; our integrator and its error should be visible                                      |
| **Evidence**          | [wolframalpha.com](https://www.wolframalpha.com/) · [demonstrations.wolfram.com](https://demonstrations.wolfram.com/)                 |

## 16. NVIDIA — Omniverse

| Field                 | Finding                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Platform for building and operating 3D simulation and digital-twin applications, built on OpenUSD                                                           |
| **Target users**      | Industrial/enterprise developers                                                                                                                            |
| **Rendering**         | **RTX / real-time ray tracing**, OpenUSD scene description — _Confidence: High_ (vendor)                                                                    |
| **Physics**           | **PhysX** and connected solvers — _Confidence: High_                                                                                                        |
| **Data sources**      | Customer CAD/sensor data                                                                                                                                    |
| **Discovery model**   | Developer platform                                                                                                                                          |
| **UX strengths**      | Interoperability via an open scene format                                                                                                                   |
| **UX weaknesses**     | Heavy GPU dependency; enterprise-scale complexity                                                                                                           |
| **Performance**       | GPU-first                                                                                                                                                   |
| **Monetisation**      | Enterprise licensing + hardware pull-through                                                                                                                |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                 |
| **Copy conceptually** | **An open, versioned interchange format (OpenUSD) as the interoperability strategy.** Our versioned scenario JSON schema is the same bet at a smaller scale |
| **Beat them on**      | Not a competitor — a lesson in why the file format is a strategic asset                                                                                     |
| **Evidence**          | [nvidia.com/omniverse](https://www.nvidia.com/en-us/omniverse/)                                                                                             |

## 17. Ansys (core simulation) — Fluent / Mechanical / Digital Twin

| Field                 | Finding                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Engineering simulation: CFD, FEA, electromagnetics, and digital-twin products                                                                                                          |
| **Target users**      | Professional engineers                                                                                                                                                                 |
| **Rendering**         | Proprietary; internals **UNKNOWN**                                                                                                                                                     |
| **Physics**           | Validated, certification-grade numerical solvers — _Confidence: High_                                                                                                                  |
| **Data sources**      | Customer geometry and material data                                                                                                                                                    |
| **Discovery model**   | Project-based                                                                                                                                                                          |
| **UX strengths**      | **Solver validation and verification is a published, marketed product attribute**                                                                                                      |
| **UX weaknesses**     | Cost and complexity                                                                                                                                                                    |
| **Performance**       | HPC/cluster                                                                                                                                                                            |
| **Monetisation**      | Enterprise licensing                                                                                                                                                                   |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                                            |
| **Copy conceptually** | **Treat numerical validation as a feature you advertise, not an internal detail.** This directly motivates our visible conservation diagnostics and published physics regression suite |
| **Beat them on**      | N/A — different market; the lesson is the posture                                                                                                                                      |
| **Evidence**          | [ansys.com](https://www.ansys.com/)                                                                                                                                                    |

## 18. Siemens Digital Industries — Simcenter

| Field                 | Finding                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **What it does**      | Simulation and test portfolio for the industrial digital twin                                                |
| **Target users**      | Industrial engineering teams                                                                                 |
| **Rendering**         | **UNKNOWN**                                                                                                  |
| **Physics**           | Multi-domain system simulation — _Confidence: Medium_                                                        |
| **Data sources**      | Customer engineering data                                                                                    |
| **Discovery model**   | Enterprise PLM integration                                                                                   |
| **UX strengths**      | Whole-lifecycle traceability                                                                                 |
| **UX weaknesses**     | Very heavy; long onboarding                                                                                  |
| **Performance**       | Enterprise compute                                                                                           |
| **Monetisation**      | Enterprise licensing                                                                                         |
| **A11y / privacy**    | **UNKNOWN**                                                                                                  |
| **Copy conceptually** | Traceability from input data to result — versioned inputs and reproducible runs                              |
| **Beat them on**      | N/A — lesson only: **deterministic replay is an enterprise-grade expectation**, and we can offer it for free |
| **Evidence**          | [siemens.com/simcenter](https://plm.sw.siemens.com/en-US/simcenter/) — _Confidence: Medium_                  |

## 19. Dassault Systèmes — SIMULIA / 3DEXPERIENCE

| Field                 | Finding                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **What it does**      | Multiphysics simulation (Abaqus lineage) on a collaborative platform                                                              |
| **Target users**      | Enterprise engineering                                                                                                            |
| **Rendering**         | **UNKNOWN**                                                                                                                       |
| **Physics**           | Validated FEA/multiphysics — _Confidence: Medium_                                                                                 |
| **Data sources**      | Customer data                                                                                                                     |
| **Discovery model**   | Platform-integrated                                                                                                               |
| **UX strengths**      | Collaboration and data management around simulation                                                                               |
| **UX weaknesses**     | Cost, lock-in                                                                                                                     |
| **Performance**       | HPC                                                                                                                               |
| **Monetisation**      | Enterprise licensing/cloud                                                                                                        |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                       |
| **Copy conceptually** | Simulation as a _shareable artefact_ with an identity, not a throwaway session — motivates our share-link and import/export model |
| **Beat them on**      | N/A — lesson only                                                                                                                 |
| **Evidence**          | [3ds.com/simulia](https://www.3ds.com/products/simulia) — _Confidence: Medium_                                                    |

## 20. Independent web n-body simulators (collective entry)

Several small/indie browser n-body simulators are active in 2025–2026 — among
them **Teskooano**, **trisolarchaos.com**, and assorted Three.js three-body
demos. Treated as one entry because individually they are small, but
collectively they define the immediate competitive floor.

| Field                 | Finding                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What they do**      | Browser n-body / three-body simulators, often chaos-focused                                                                                                                                                                             |
| **Target users**      | Curious public, students, "Three-Body Problem" readers                                                                                                                                                                                  |
| **Rendering**         | **Three.js / WebGL** — _Confidence: High_ (self-described)                                                                                                                                                                              |
| **Physics**           | Newtonian n-body; several advertise multiple integration methods and energy conservation — _Confidence: Medium_                                                                                                                         |
| **Data sources**      | Mostly synthetic initial conditions                                                                                                                                                                                                     |
| **Discovery model**   | Thin — a handful of presets, no real catalogue                                                                                                                                                                                          |
| **UX strengths**      | Instant load, zero friction, topical hook                                                                                                                                                                                               |
| **UX weaknesses**     | Shallow catalogues, little provenance, accessibility generally unaddressed — _Confidence: Medium_                                                                                                                                       |
| **Performance**       | Typically main-thread — _Confidence: Low, not individually verified_                                                                                                                                                                    |
| **Monetisation**      | Mostly none                                                                                                                                                                                                                             |
| **A11y / privacy**    | **UNKNOWN**                                                                                                                                                                                                                             |
| **Copy conceptually** | Speed to first frame; riding cultural interest in the three-body problem                                                                                                                                                                |
| **Beat them on**      | Catalogue depth, cited data, worker-based performance, accessibility, and visible correctness — every axis where a weekend project cannot follow                                                                                        |
| **Evidence**          | [teskooano.space](https://teskooano.space/) · [trisolarchaos.com](https://trisolarchaos.com/) · [three.js forum n-body thread](https://discourse.threejs.org/t/programming-a-n-body-problem-simulator-in-javascript-with-three-js/9349) |

---

## Non-company benchmark leaders

These are not companies but set the technical bar.

### REBOUND (Hanno Rein, University of Toronto Scarborough)

Open-source multi-purpose N-body code, and **the scientific reference point for
integrator quality**. Its **IAS15** is a 15th-order adaptive high-accuracy
non-symplectic integrator (Rein & Spiegel 2015, _MNRAS_ 446(2), 1424–1437);
**WHFast** is an unbiased symplectic Wisdom–Holman integrator for long-term
integrations, roughly an order of magnitude faster than the alternatives.
_Confidence: High._
**What we take:** the _shape_ of the integrator menu — a fast symplectic default
for long runs plus a high-accuracy adaptive option for close encounters — is
exactly the right architecture, and it is validated by the leading research
code. We implement independently from published method, not from their source.
[rebound.hanno-rein.de](https://rebound.hanno-rein.de/) ·
[hannorein/rebound](https://github.com/hannorein/rebound)

### NASA JPL Solar System Dynamics — Horizons

Authoritative ephemerides and state vectors for solar-system bodies. The
correct provenance for any "real" scenario's initial conditions.
_Confidence: High._ [ssd.jpl.nasa.gov](https://ssd.jpl.nasa.gov/)

### NASA Exoplanet Archive (IPAC/Caltech)

Authoritative confirmed-exoplanet parameters. _Confidence: High._
[exoplanetarchive.ipac.caltech.edu](https://exoplanetarchive.ipac.caltech.edu/)

### W3C — WCAG 2.2

The normative accessibility target. _Confidence: High._
[w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)

---

## What this benchmark actually decides

Six conclusions carried into the spec:

1. **The market gap is real and specific.** NASA Eyes is authoritative but
   read-only. Universe Sandbox is interactive but paid and installed. The indie
   web simulators are instant but shallow. **Nobody occupies: free, instant,
   in-browser, deep catalogue, cited data, and visibly correct physics.**
2. **Stellarium Web proves the architecture.** Compiled hot-path engine + light
   JS UI + fully static hosting is a shipping, production-proven pattern. Our
   worker-based core is the same shape in TypeScript, with WASM as a clear
   later upgrade path rather than a v1 requirement.
3. **PhET sets the accessibility bar, and it is achievable.** Native HTML +
   ARIA + a live textual description layer for a visual canvas is a documented,
   researched method — not an aspiration. We adopt it.
4. **REBOUND validates the integrator menu.** Symplectic default for long runs,
   adaptive high-order for close encounters. Copy the _shape_, implement from
   published method.
5. **Validation is a marketable feature.** Ansys sells solver verification.
   Nobody in the consumer space shows their error. Visible conservation
   diagnostics is our sharpest and cheapest differentiator.
6. **The file format is strategic.** OpenUSD for NVIDIA, 3D Tiles for Cesium.
   A versioned, documented, validated scenario schema is the long-term asset —
   worth more than any single feature.
