/**
 * Kepler solver tests.
 *
 * The failure mode this guards against is an orbit that LOOKS right and has the
 * wrong period. So the tests check against closed-form results and, decisively,
 * integrate the produced state vectors and confirm the period comes out right.
 */
import { describe, it, expect } from "vitest";
import {
  solveKeplerEquation,
  elementsToStateVectors,
  orbitalPeriodDays,
  KeplerConvergenceError,
} from "../../src/sim/kepler";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";
import { Simulation } from "../../src/sim/engine";

describe("Kepler's equation", () => {
  it("is exact for a circular orbit", () => {
    for (const M of [0, 0.5, 1, 3, -2]) {
      expect(solveKeplerEquation(M, 0)).toBeCloseTo(
        ((M + Math.PI) % (2 * Math.PI)) - Math.PI,
        12,
      );
    }
  });

  it("satisfies M = E - e sin E across the eccentricity range", () => {
    // Including the high-e cases where a naive solver diverges.
    for (const e of [0, 0.1, 0.5, 0.9, 0.95, 0.99, 0.999]) {
      for (const M of [0, 0.1, 1, 2, 3, -1, -2.5, Math.PI - 1e-6]) {
        const E = solveKeplerEquation(M, e);
        let expected = M % (2 * Math.PI);
        if (expected > Math.PI) expected -= 2 * Math.PI;
        if (expected < -Math.PI) expected += 2 * Math.PI;
        expect(E - e * Math.sin(E)).toBeCloseTo(expected, 9);
      }
    }
  });

  it("rejects unbound orbits rather than returning nonsense", () => {
    expect(() => solveKeplerEquation(1, 1)).toThrow(RangeError);
    expect(() => solveKeplerEquation(1, 1.5)).toThrow(RangeError);
    expect(() => solveKeplerEquation(1, -0.1)).toThrow(RangeError);
  });

  it("reports non-convergence instead of returning a wrong answer", () => {
    // One iteration cannot converge for a demanding case.
    expect(() => solveKeplerEquation(1, 0.99, 1e-15, 1)).toThrow(
      KeplerConvergenceError,
    );
  });
});

describe("elements to state vectors", () => {
  it("places a circular orbit at the right radius and speed", () => {
    const a = 1;
    const M = 1;
    const { position, velocity } = elementsToStateVectors(
      { semiMajorAxis: a, eccentricity: 0, meanAnomaly: 0 },
      M,
    );
    const r = Math.hypot(position.x, position.y, position.z);
    const v = Math.hypot(velocity.x, velocity.y, velocity.z);

    expect(r).toBeCloseTo(a, 12);
    // Circular speed v = sqrt(mu/a).
    expect(v).toBeCloseTo(Math.sqrt((G_AU3_PER_MSUN_DAY2 * M) / a), 12);
    // At M = 0 the body sits at periapsis on +x with velocity along +y.
    expect(position.x).toBeCloseTo(a, 12);
    expect(Math.abs(position.y)).toBeLessThan(1e-12);
    expect(velocity.x).toBeCloseTo(0, 12);
    expect(velocity.y).toBeGreaterThan(0);
  });

  it("starts an eccentric orbit at periapsis with the vis-viva speed", () => {
    const a = 2;
    const e = 0.6;
    const M = 1;
    const { position, velocity } = elementsToStateVectors(
      { semiMajorAxis: a, eccentricity: e, meanAnomaly: 0 },
      M,
    );
    const r = Math.hypot(position.x, position.y, position.z);
    const v = Math.hypot(velocity.x, velocity.y, velocity.z);

    expect(r).toBeCloseTo(a * (1 - e), 10);
    // Vis-viva: v² = mu(2/r − 1/a)
    const mu = G_AU3_PER_MSUN_DAY2 * M;
    expect(v).toBeCloseTo(Math.sqrt(mu * (2 / r - 1 / a)), 10);
  });

  it("applies inclination", () => {
    const { position } = elementsToStateVectors(
      {
        semiMajorAxis: 1,
        eccentricity: 0,
        inclination: Math.PI / 2,
        argumentOfPeriapsis: Math.PI / 2,
        meanAnomaly: 0,
      },
      1,
    );
    // A 90-degree inclination with argP = 90 degrees lifts the body onto +z.
    expect(Math.abs(position.z)).toBeCloseTo(1, 10);
  });

  it("rejects impossible elements", () => {
    expect(() =>
      elementsToStateVectors({ semiMajorAxis: 0, eccentricity: 0 }, 1),
    ).toThrow(RangeError);
    expect(() =>
      elementsToStateVectors({ semiMajorAxis: -1, eccentricity: 0 }, 1),
    ).toThrow(RangeError);
    expect(() =>
      elementsToStateVectors({ semiMajorAxis: 1, eccentricity: 0 }, 0),
    ).toThrow(RangeError);
  });
});

describe("the produced state vectors actually orbit correctly", () => {
  /** Integrate and measure the period by tracking swept angle. */
  function measurePeriod(a: number, e: number, starMass: number, planetMass: number) {
    const total = starMass + planetMass;
    const state = elementsToStateVectors(
      { semiMajorAxis: a, eccentricity: e, meanAnomaly: 0 },
      total,
    );
    const expected = orbitalPeriodDays(a, total);

    const sim = new Simulation({
      bodies: [
        {
          id: "star",
          name: "Star",
          mass: starMass,
          radius: 1e-6,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        },
        {
          id: "planet",
          name: "Planet",
          mass: planetMass,
          radius: 1e-7,
          position: state.position,
          velocity: state.velocity,
        },
      ],
      integrator: "pefrl",
      dt: expected / 20000,
      forceMode: "direct",
      collisionMode: "pass-through",
    });

    const angle = () =>
      Math.atan2(
        sim.state.positions[4] - sim.state.positions[1],
        sim.state.positions[3] - sim.state.positions[0],
      );
    let previous = angle();
    let swept = 0;
    for (let i = 0; i < 400_000; i++) {
      sim.stepFixed(1);
      const current = angle();
      let d = current - previous;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      swept += d;
      previous = current;
      if (Math.abs(swept) >= 2 * Math.PI) return { measured: sim.simTime, expected };
    }
    throw new Error("no full revolution");
  }

  it("matches Kepler's third law for a circular orbit", () => {
    const { measured, expected } = measurePeriod(1, 0, 1, 3e-6);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.002);
  });

  it("matches Kepler's third law for an eccentric orbit", () => {
    const { measured, expected } = measurePeriod(2, 0.5, 1, 1e-5);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.002);
  });

  it("matches for a high-eccentricity orbit", () => {
    const { measured, expected } = measurePeriod(1.5, 0.9, 1, 1e-6);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });
});
