/**
 * Every shipped scenario must validate AND be physically sensible.
 *
 * Validating the schema only proves the file is well-formed. These tests
 * actually run each scenario and check the physics, so a data error that
 * produces a valid-but-wrong orbit is caught at build time rather than by a
 * user noticing the Earth's year is the wrong length.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateAndParse } from "../../src/schema/migrations";
import { Simulation } from "../../src/sim/engine";
import { DAYS_PER_JULIAN_YEAR } from "../../src/sim/constants";

const DIR = join(process.cwd(), "data", "scenarios");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

const load = (file: string) =>
  migrateAndParse(JSON.parse(readFileSync(join(DIR, file), "utf8")));

describe("shipped scenarios", () => {
  it("ships at least one scenario", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      it("validates against the current schema", () => {
        expect(() => load(file)).not.toThrow();
      });

      it("has a complete, non-placeholder citation", () => {
        const s = load(file);
        expect(s.source.provider.length).toBeGreaterThan(3);
        expect(s.source.reference.length).toBeGreaterThan(3);
        expect(s.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.source.provider.toLowerCase()).not.toContain("todo");
        expect(s.source.provider.toLowerCase()).not.toContain("unknown");
      });

      it("stays finite and bounded over a short run", () => {
        const s = load(file);
        const sim = new Simulation({
          bodies: s.bodies,
          g: s.physics.g,
          softening: s.physics.softening,
          integrator: s.physics.integrator,
          dt: s.physics.dt,
          forceMode: s.physics.forceMode,
          theta: s.physics.theta,
          collisionMode: s.physics.collisionMode,
        });

        sim.stepFixed(2000);

        for (let i = 0; i < sim.state.count * 3; i++) {
          expect(Number.isFinite(sim.state.positions[i])).toBe(true);
          expect(Number.isFinite(sim.state.velocities[i])).toBe(true);
        }
        expect(Number.isFinite(sim.diagnostics().totalEnergy)).toBe(true);
      });
    });
  }
});

/**
 * Targeted physical checks on the derived solar-system data. These are the real
 * test of the generator: if a mass ratio or a semi-major axis were transcribed
 * wrongly, the orbital period would come out wrong and this would fail.
 */
describe("derived solar-system data is physically correct", () => {
  const orbitalPeriodDays = (file: string, movingBodyIndex: number): number => {
    const s = load(file);
    const sim = new Simulation({
      bodies: s.bodies,
      g: s.physics.g,
      softening: s.physics.softening,
      integrator: "pefrl",
      dt: s.physics.dt / 10,
      forceMode: "direct",
      collisionMode: "pass-through",
    });

    // Detect a full revolution by tracking the cumulative swept angle of the
    // moving body relative to the system barycentre.
    const angleOf = () => {
      const k = movingBodyIndex * 3;
      return Math.atan2(sim.state.positions[k + 1], sim.state.positions[k]);
    };

    let previous = angleOf();
    let swept = 0;
    const maxSteps = 4_000_000;
    for (let i = 0; i < maxSteps; i++) {
      sim.stepFixed(1);
      const current = angleOf();
      let delta = current - previous;
      // Unwrap across the branch cut.
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      swept += delta;
      previous = current;
      if (Math.abs(swept) >= 2 * Math.PI) return sim.simTime;
    }
    throw new Error(`no full revolution within ${maxSteps} steps for ${file}`);
  };

  it("gives the Earth a year of about 365 days", () => {
    const period = orbitalPeriodDays("sun-and-earth.json", 1);
    // Sidereal year is 365.256 days. 1% tolerance covers the idealised
    // perihelion start and the finite timestep.
    expect(period).toBeGreaterThan(DAYS_PER_JULIAN_YEAR * 0.99);
    expect(period).toBeLessThan(DAYS_PER_JULIAN_YEAR * 1.01);
  });

  it("gives the Moon a month of about 27.3 days", () => {
    const period = orbitalPeriodDays("earth-and-moon.json", 1);
    expect(period).toBeGreaterThan(27.3 * 0.98);
    expect(period).toBeLessThan(27.3 * 1.02);
  });

  it("gives Jupiter a year of about 11.9 Earth years", () => {
    const period = orbitalPeriodDays("sun-and-jupiter.json", 1);
    const years = period / DAYS_PER_JULIAN_YEAR;
    expect(years).toBeGreaterThan(11.9 * 0.98);
    expect(years).toBeLessThan(11.9 * 1.02);
  });

  it("keeps the trojan test particles near their Lagrange points", () => {
    const s = load("jupiter-trojan-points.json");
    const sim = new Simulation({
      bodies: s.bodies,
      softening: s.physics.softening,
      integrator: "verlet",
      dt: 1,
      forceMode: "direct",
      collisionMode: "pass-through",
    });

    // Jupiter is index 1; the trojans are 2 and 3.
    const angleBetween = (a: number, b: number) => {
      const ka = a * 3;
      const kb = b * 3;
      const angA = Math.atan2(sim.state.positions[ka + 1], sim.state.positions[ka]);
      const angB = Math.atan2(sim.state.positions[kb + 1], sim.state.positions[kb]);
      let d = ((angA - angB) * 180) / Math.PI;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return d;
    };

    // Roughly one Jupiter orbit.
    sim.stepFixed(4333);

    // L4 and L5 are linearly stable for this mass ratio, so the trojans should
    // still be within a few degrees of 60 degrees from Jupiter.
    expect(Math.abs(Math.abs(angleBetween(2, 1)) - 60)).toBeLessThan(5);
    expect(Math.abs(Math.abs(angleBetween(3, 1)) - 60)).toBeLessThan(5);
  });
});
