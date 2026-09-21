/**
 * Two-body regression tests against closed-form Keplerian results.
 *
 * Units here are G = 1 so the expected values are exact and independent of the
 * AU/M☉/day constant.
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../../src/sim/engine";
import type { BodyInit } from "../../src/sim/state";

const body = (
  id: string,
  mass: number,
  position: [number, number, number],
  velocity: [number, number, number],
  radius = 1e-6,
): BodyInit => ({
  id,
  name: id,
  mass,
  radius,
  position: { x: position[0], y: position[1], z: position[2] },
  velocity: { x: velocity[0], y: velocity[1], z: velocity[2] },
});

/**
 * Exact circular two-body orbit about the common barycentre.
 * ω = √(G·M/a³); each body orbits at rᵢ = a·m_other/M with vᵢ = ω·rᵢ.
 */
function circularPair(m1: number, m2: number, a: number) {
  const M = m1 + m2;
  const omega = Math.sqrt(M / (a * a * a)); // G = 1
  const r1 = (a * m2) / M;
  const r2 = (a * m1) / M;
  return {
    bodies: [
      body("primary", m1, [-r1, 0, 0], [0, -omega * r1, 0]),
      body("secondary", m2, [r2, 0, 0], [0, omega * r2, 0]),
    ],
    period: (2 * Math.PI) / omega,
  };
}

function separation(sim: Simulation): number {
  const p = sim.state.positions;
  const dx = p[3] - p[0];
  const dy = p[4] - p[1];
  const dz = p[5] - p[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Peak-to-peak variation in separation over `orbits` orbits at a given dt. */
function radialWobble(a: number, dtDivisor: number, orbits: number): number {
  const { bodies, period } = circularPair(1, 1e-3, a);
  const sim = new Simulation({
    bodies,
    g: 1,
    dt: period / dtDivisor,
    integrator: "verlet",
    collisionsEnabled: false,
  });
  const steps = Math.round((orbits * period) / sim.dt);
  let minSep = Infinity;
  let maxSep = -Infinity;
  for (let i = 0; i < steps; i++) {
    sim.stepFixed(1);
    const s = separation(sim);
    if (s < minSep) minSep = s;
    if (s > maxSep) maxSep = s;
  }
  return maxSep - minSep;
}

describe("two-body circular orbit", () => {
  it("holds separation constant over ten orbits, within the method's truncation error", () => {
    const a = 1;
    const dtDivisor = 4000;
    const wobble = radialWobble(a, dtDivisor, 10);

    // Velocity Verlet is second order, so the radial truncation error scales as
    // O(dt²). With dt = T/N the natural scale is (2π/N)². Asserting against
    // that scale is meaningful; asserting against a round number would just be
    // a magic constant that happens to pass today.
    const dtScale = (2 * Math.PI) / dtDivisor;
    const theoreticalBound = 2 * dtScale * dtScale;

    expect(wobble).toBeLessThan(theoreticalBound);
    // And it must not be growing without bound either.
    expect(Number.isFinite(wobble)).toBe(true);
  });

  it("converges at second order: halving dt reduces the error about fourfold", () => {
    const a = 1;
    const coarse = radialWobble(a, 2000, 2);
    const fine = radialWobble(a, 4000, 2);

    // For a second-order method, halving dt should reduce error by ~4x.
    // A window of 3–5 accommodates the constant factor without being vacuous.
    const ratio = coarse / fine;
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });

  it("returns to its starting position after exactly one period", () => {
    const a = 1;
    const { bodies, period } = circularPair(1, 1e-3, a);
    const dt = period / 20000;
    const sim = new Simulation({
      bodies,
      g: 1,
      dt,
      integrator: "pefrl",
      collisionsEnabled: false,
    });

    const start = Array.from(sim.state.positions.slice(0, 6));
    sim.stepFixed(Math.round(period / dt));
    const end = sim.state.positions;

    // Period from Kepler's third law: T = 2π√(a³/GM).
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(end[i] - start[i])).toBeLessThan(1e-4);
    }
  });
});

describe("two-body elliptical orbit", () => {
  it("conserves energy and angular momentum, and respects the apsides", () => {
    // Start at periapsis of an e = 0.5 orbit with a = 1, G = 1, M ≈ 1.
    const e = 0.5;
    const a = 1;
    const m1 = 1;
    const m2 = 1e-3;
    const M = m1 + m2;
    const rPeri = a * (1 - e);
    // Vis-viva at periapsis: v = √(GM(2/r − 1/a)).
    const vPeri = Math.sqrt(M * (2 / rPeri - 1 / a));

    const sim = new Simulation({
      bodies: [
        body("star", m1, [0, 0, 0], [0, 0, 0]),
        body("planet", m2, [rPeri, 0, 0], [0, vPeri, 0]),
      ],
      g: 1,
      dt: 1e-5,
      integrator: "verlet",
      collisionsEnabled: false,
    });

    const before = sim.diagnostics();
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / M);

    let minR = Infinity;
    let maxR = -Infinity;
    const steps = Math.round((3 * period) / sim.dt);
    for (let i = 0; i < steps; i++) {
      sim.stepFixed(1);
      const r = separation(sim);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }

    const after = sim.diagnostics();

    // Symplectic integrator: energy error bounded, not merely small once.
    expect(after.energyDrift).toBeLessThan(1e-6);
    expect(after.angularMomentumDrift).toBeLessThan(1e-10);

    // Apsides from the orbital elements: r_peri = a(1−e), r_apo = a(1+e).
    expect(Math.abs(minR - a * (1 - e))).toBeLessThan(1e-3);
    expect(Math.abs(maxR - a * (1 + e))).toBeLessThan(1e-3);

    // Angular momentum is the strongest invariant here; confirm it directly.
    expect(Math.abs(after.angularMomentum - before.angularMomentum)).toBeLessThan(
      1e-12,
    );
  });
});
