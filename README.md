# Gravity Simulator

An interactive Newtonian n-body gravity simulator for the browser, built so the
physics is both correct **and visibly correct**.

## Why this exists

Three things are unusual here, and each answers a defect measured in a
comparable product (see `artifacts/03-current-site-audit.md`):

1. **Simulation speed does not depend on your monitor.** A fixed-timestep
   accumulator means a 144 Hz display and a 60 Hz display advance simulated time
   identically. Asserted by test.
2. **Collisions conserve momentum.** Merges use centre-of-mass velocity and
   position, and conserve volume. Asserted by test.
3. **You can see the error.** Relative energy and angular-momentum drift are
   computed continuously and shown on screen, so you can tell when an
   integration is diverging instead of trusting it blindly.

## Architecture

```
Main thread                          Worker
  React (UI chrome only)      ⇄      Simulation core (zero dependencies)
  Three.js renderer                  Structure-of-arrays Float64Array
  Never holds per-frame state        Fixed-timestep accumulator
```

Per-frame body state never enters React. Physics never runs on the main thread.

## Commands

| Command          | Does                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `npm run dev`    | Dev server                                                           |
| `npm run build`  | Build the catalogue, typecheck, and produce `dist/`                  |
| `npm test`       | Unit and physics regression tests                                    |
| `npm run e2e`    | Browser and accessibility tests                                      |
| `npm run verify` | **Everything**: format, lint, typecheck, licences, tests, build, e2e |

First e2e run needs a browser: `npm run e2e:install`.

## Test suites

| Suite            | Count | Covers                                                                                                                                              |
| ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/physics/` | 30    | Two-body orbits, figure-eight choreography, Barnes-Hut vs direct force, collisions, timestep independence, deterministic replay                     |
| `tests/schema/`  | 50    | Schema validation, migrations, and **physical** correctness of the shipped data (Earth's year, the lunar month, Jupiter's period, trojan stability) |
| `tests/worker/`  | 18    | Worker protocol: command serialisation, message routing, zero-copy buffer transfer, disposal                                                        |
| `tests/share/`   | 9     | Share-link round-trip, compression, fragment-only payload, rejection of malformed input                                                             |
| `tests/e2e/`     | 33    | Browser flows, axe accessibility scans, keyboard-only operation, mobile viewport, performance baseline                                              |

**107 unit tests + 33 browser tests.**

## Repository layout

```
src/sim/        Simulation core — pure TypeScript, no dependencies, no DOM
src/schema/     Versioned scenario schema, Zod validation, migrations
src/worker/     Worker entry and message protocol
src/render/     Three.js renderer
src/ui/         React components
src/catalog/    Search index and catalogue access
data/scenarios/ Scenario source of truth
scripts/        Build-time pipeline and gates
tests/          Unit, physics regression, and e2e tests
artifacts/      Research, audit, licensing and specification documents
docs/adr/       Architecture decision records
```

## Licensing

This project is a **clean-room implementation**. It contains no code, assets,
data files or text from any other gravity simulator. Physics is implemented from
published scientific method, cited at the point of use; scenario data comes from
primary sources with a mandatory citation on every scenario.

No `LICENSE` file is present yet — the project is `UNLICENSED` and `private`
pending a decision on open-source versus proprietary. See
`artifacts/04-licensing-and-clean-room.md`.

## Prior art

Harmony of the Spheres by Darrell Huffman and contributors is prior art in this
space. This project is not derived from it.
