/**
 * Every generated scenario, checked.
 *
 * The catalogue is produced by a pipeline from a 5,905-row snapshot. Nobody
 * reads 4,439 files, so the only thing standing between a bad conversion and
 * a published scenario is this file. It runs in CI on the real generated
 * output, not on a fixture.
 *
 * Two tiers:
 *   - EVERY scenario is schema-validated and given cheap physical sanity
 *     checks. Anything here that fails is a defect in the pipeline.
 *   - A deterministic SAMPLE is integrated and checked for conservation, which
 *     is too slow to run on all of them and too valuable to skip entirely.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateAndParse } from "../../src/schema/migrations";
import type { Scenario } from "../../src/schema/scenario";
import {
  SimState,
  computeConservation,
  createIntegrator,
  relativeDrift,
  G_AU3_PER_MSUN_DAY2,
} from "../../src/sim";
import { STAR_MASS_THRESHOLD_MSUN } from "../../src/catalog/format";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCENARIO_DIR = join(ROOT, "data", "scenarios");

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, out);
    else if (entry.name.endsWith(".json")) out.push(path);
  }
  return out;
}

let files: string[] = [];
let scenarios: { file: string; scenario: Scenario }[] = [];

beforeAll(() => {
  if (!existsSync(SCENARIO_DIR)) {
    throw new Error(
      `${SCENARIO_DIR} does not exist. Run: npm run data:build (the exoplanet ` +
        `scenarios are generated, not committed).`,
    );
  }
  files = collect(SCENARIO_DIR).sort();
  scenarios = files.map((file) => ({
    file: relative(ROOT, file),
    scenario: migrateAndParse(JSON.parse(readFileSync(file, "utf8"))),
  }));
});

describe("the generated catalogue", () => {
  it("is not empty, so a silent pipeline failure cannot pass as success", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("validates every scenario against the schema", () => {
    // migrateAndParse in beforeAll already throws on the first bad file; this
    // re-runs it per file so the failure names the file rather than the batch.
    const failures: string[] = [];
    for (const file of files) {
      try {
        migrateAndParse(JSON.parse(readFileSync(file, "utf8")));
      } catch (error) {
        failures.push(
          `${relative(ROOT, file)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("has a unique id for every scenario", () => {
    const byId = new Map<string, string>();
    const clashes: string[] = [];
    for (const { file, scenario } of scenarios) {
      const previous = byId.get(scenario.id);
      if (previous !== undefined)
        clashes.push(`${scenario.id}: ${previous} and ${file}`);
      byId.set(scenario.id, file);
    }
    expect(clashes).toEqual([]);
  });

  it("names a real source with a retrieval date on every scenario", () => {
    const missing = scenarios
      .filter(
        ({ scenario }) =>
          scenario.source.provider.trim() === "" ||
          scenario.source.reference.trim() === "" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(scenario.source.retrievedAt),
      )
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it("never places two bodies at the same point", () => {
    // With zero softening, coincident bodies give an infinite acceleration and
    // the integrator produces NaN on the first step.
    const coincident: string[] = [];
    for (const { file, scenario } of scenarios) {
      const bodies = scenario.bodies;
      outer: for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i].position;
          const b = bodies[j].position;
          if (a.x === b.x && a.y === b.y && a.z === b.z) {
            coincident.push(`${file}: ${bodies[i].id} and ${bodies[j].id}`);
            break outer;
          }
        }
      }
    }
    expect(coincident).toEqual([]);
  });

  it("starts every system close to rest in its own centre-of-momentum frame", () => {
    // A system with net momentum drifts out of frame while it runs, which
    // looks like a bug to the viewer even though the physics is fine.
    const drifting: string[] = [];
    for (const { file, scenario } of scenarios) {
      let px = 0;
      let py = 0;
      let pz = 0;
      let scale = 0;
      for (const b of scenario.bodies) {
        px += b.mass * b.velocity.x;
        py += b.mass * b.velocity.y;
        pz += b.mass * b.velocity.z;
        scale += b.mass * Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
      }
      if (scale === 0) continue;
      const residual = Math.hypot(px, py, pz) / scale;
      if (residual > 1e-9) drifting.push(`${file}: ${residual.toExponential(2)}`);
    }
    expect(drifting).toEqual([]);
  });

  it("chooses a timestep that resolves the fastest orbit it contains", () => {
    // A symplectic integrator is stable, not accurate, at a coarse timestep:
    // it will happily return a smooth, wrong orbit. Requiring at least 20
    // steps per revolution is the floor below which the picture stops being a
    // picture of the data.
    const tooCoarse: string[] = [];
    for (const { file, scenario } of scenarios) {
      const period = shortestPeriodDays(scenario);
      if (period === null) continue;
      const stepsPerOrbit = period / scenario.physics.dt;
      if (stepsPerOrbit < 20) {
        tooCoarse.push(`${file}: ${stepsPerOrbit.toFixed(1)} steps per orbit`);
      }
    }
    expect(tooCoarse).toEqual([]);
  });

  it("never gives an exoplanet system more than one star", () => {
    // The snapshot is grouped by hostname, so each scenario has one host. Two
    // bodies above the hydrogen-burning limit would mean the pipeline merged
    // rows from different systems.
    //
    // ZERO is a legitimate answer and is not asserted against: 25 hosts in
    // the snapshot are below the limit, which makes them brown dwarfs rather
    // than stars. An earlier version of this test assumed every host was a
    // star and was simply wrong about the data.
    const odd: string[] = [];
    for (const { file, scenario } of scenarios) {
      if (scenario.category !== "exoplanets") continue;
      const stars = scenario.bodies.filter(
        (b) => b.mass >= STAR_MASS_THRESHOLD_MSUN,
      ).length;
      if (stars > 1) odd.push(`${file}: ${stars} stars`);
    }
    expect(odd).toEqual([]);
  });

  it("only reports a starless system when its host really is below the limit", () => {
    const wrong: string[] = [];
    for (const { file, scenario } of scenarios) {
      if (scenario.category !== "exoplanets") continue;
      const stars = scenario.bodies.filter(
        (b) => b.mass >= STAR_MASS_THRESHOLD_MSUN,
      ).length;
      if (stars > 0) continue;
      const heaviest = scenario.bodies.reduce((a, b) => (b.mass > a.mass ? b : a));
      if (heaviest.mass >= STAR_MASS_THRESHOLD_MSUN) {
        wrong.push(`${file}: heaviest body is ${heaviest.mass} M☉`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("puts every exoplanet on a bound orbit", () => {
    // A planet built from a published semi-major axis that comes out unbound
    // means the state-vector conversion is wrong.
    const unbound: string[] = [];
    for (const { file, scenario } of scenarios) {
      if (scenario.category !== "exoplanets") continue;
      const g = scenario.physics.g ?? G_AU3_PER_MSUN_DAY2;
      const star = scenario.bodies.reduce((a, b) => (b.mass > a.mass ? b : a));
      for (const body of scenario.bodies) {
        if (body === star) continue;
        const r = Math.hypot(
          body.position.x - star.position.x,
          body.position.y - star.position.y,
          body.position.z - star.position.z,
        );
        const v2 =
          (body.velocity.x - star.velocity.x) ** 2 +
          (body.velocity.y - star.velocity.y) ** 2 +
          (body.velocity.z - star.velocity.z) ** 2;
        const energy = v2 / 2 - (g * (star.mass + body.mass)) / r;
        if (energy >= 0) unbound.push(`${file}: ${body.id}`);
      }
    }
    expect(unbound).toEqual([]);
  });
});

/** Shortest two-body period about the heaviest body, in days. */
function shortestPeriodDays(scenario: Scenario): number | null {
  const g = scenario.physics.g ?? G_AU3_PER_MSUN_DAY2;
  const centre = scenario.bodies.reduce((a, b) => (b.mass > a.mass ? b : a));
  if (centre.mass <= 0) return null;
  let shortest = Infinity;
  for (const body of scenario.bodies) {
    if (body === centre) continue;
    const r = Math.hypot(
      body.position.x - centre.position.x,
      body.position.y - centre.position.y,
      body.position.z - centre.position.z,
    );
    if (r === 0) continue;
    const v2 =
      (body.velocity.x - centre.velocity.x) ** 2 +
      (body.velocity.y - centre.velocity.y) ** 2 +
      (body.velocity.z - centre.velocity.z) ** 2;
    const mu = g * (centre.mass + body.mass);
    const energy = v2 / 2 - mu / r;
    if (energy >= 0) continue;
    const a = -mu / (2 * energy);
    shortest = Math.min(shortest, 2 * Math.PI * Math.sqrt((a * a * a) / mu));
  }
  return Number.isFinite(shortest) ? shortest : null;
}

describe("a sample of the generated catalogue, integrated", () => {
  /**
   * Every 149th scenario. 149 is coprime with the plausible file counts, so
   * the sample walks the whole catalogue rather than landing on one prefix,
   * and it is fixed, so a failure is reproducible.
   */
  const STRIDE = 149;
  /** One full revolution of the fastest orbit, which is where error shows. */
  const ORBITS = 1;

  it("conserves energy over one orbit of the fastest body", () => {
    const sample = scenarios.filter((_, i) => i % STRIDE === 0);
    expect(sample.length).toBeGreaterThan(10);

    const bad: string[] = [];
    for (const { file, scenario } of sample) {
      const period = shortestPeriodDays(scenario);
      if (period === null) continue;

      const state = SimState.fromBodies(scenario.bodies);
      const g = scenario.physics.g ?? G_AU3_PER_MSUN_DAY2;
      const force = {
        g,
        softening: scenario.physics.softening,
        mode: "direct" as const,
        theta: scenario.physics.theta,
      };
      const integrator = createIntegrator(scenario.physics.integrator);
      const before = computeConservation(state, g, scenario.physics.softening);

      const steps = Math.min(4000, Math.ceil((ORBITS * period) / scenario.physics.dt));
      for (let s = 0; s < steps; s++) {
        integrator.step(state, scenario.physics.dt, force);
      }

      const after = computeConservation(state, g, scenario.physics.softening);
      if (!Number.isFinite(after.totalEnergy)) {
        bad.push(`${file}: energy became ${after.totalEnergy}`);
        continue;
      }
      const drift = Math.abs(relativeDrift(after.totalEnergy, before.totalEnergy));
      // Velocity Verlet is second order, so at 20+ steps per orbit the bound
      // is loose; 1% still catches a wrong conversion, which fails by orders
      // of magnitude rather than by percent.
      if (drift > 0.01) bad.push(`${file}: energy drift ${(drift * 100).toFixed(2)}%`);
    }
    expect(bad).toEqual([]);
  });
});
