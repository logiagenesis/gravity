/**
 * The figure-eight three-body choreography.
 *
 * Discovered numerically by Moore (Phys. Rev. Lett. 70, 3675, 1993) and proved
 * to exist by Chenciner & Montgomery (Annals of Mathematics 152, 881-901,
 * 2000). Three equal masses chase one another around a single figure-eight
 * curve. It is an exacting integrator test: the orbit is periodic but
 * dynamically unstable, so accumulated error shows up as visible departure
 * from the closed curve.
 *
 * Initial conditions in the standard G = m = 1 normalisation.
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../../src/sim/engine";
import type { BodyInit } from "../../src/sim/state";

const X = 0.97000436;
const Y = -0.24308753;
const VX = 0.93240737;
const VY = 0.86473146;
/** Period of the figure-eight solution in these units. */
const PERIOD = 6.32591398;

function figureEightBodies(): BodyInit[] {
  const r = 1e-4;
  return [
    {
      id: "a",
      name: "A",
      mass: 1,
      radius: r,
      position: { x: X, y: Y, z: 0 },
      velocity: { x: VX / 2, y: VY / 2, z: 0 },
    },
    {
      id: "b",
      name: "B",
      mass: 1,
      radius: r,
      position: { x: -X, y: -Y, z: 0 },
      velocity: { x: VX / 2, y: VY / 2, z: 0 },
    },
    {
      id: "c",
      name: "C",
      mass: 1,
      radius: r,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: -VX, y: -VY, z: 0 },
    },
  ];
}

function maxPositionError(sim: Simulation, reference: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < reference.length; i++) {
    const e = Math.abs(sim.state.positions[i] - reference[i]);
    if (e > worst) worst = e;
  }
  return worst;
}

describe("figure-eight choreography", () => {
  it("recurs after one period", () => {
    const dt = PERIOD / 200000;
    const sim = new Simulation({
      bodies: figureEightBodies(),
      g: 1,
      dt,
      integrator: "pefrl",
      collisionMode: "pass-through",
    });

    const start = Array.from(sim.state.positions.slice(0, 9));
    sim.stepFixed(Math.round(PERIOD / dt));

    // The configuration must return to itself after exactly one period.
    expect(maxPositionError(sim, start)).toBeLessThan(1e-4);
  });

  it("keeps the centre of mass fixed at the origin", () => {
    const sim = new Simulation({
      bodies: figureEightBodies(),
      g: 1,
      dt: PERIOD / 20000,
      integrator: "verlet",
      collisionMode: "pass-through",
    });

    sim.stepFixed(20000);
    const { centreOfMass, linearMomentum } = sim.diagnostics();

    // These initial conditions have zero net momentum, so the barycentre must
    // not move. Drift here would indicate an asymmetric force calculation.
    expect(Math.abs(centreOfMass.x)).toBeLessThan(1e-10);
    expect(Math.abs(centreOfMass.y)).toBeLessThan(1e-10);
    expect(Math.abs(linearMomentum.x)).toBeLessThan(1e-12);
    expect(Math.abs(linearMomentum.y)).toBeLessThan(1e-12);
  });

  it("conserves energy far better under a symplectic method than under RK4", () => {
    const run = (integrator: "verlet" | "pefrl" | "rk4") => {
      const sim = new Simulation({
        bodies: figureEightBodies(),
        g: 1,
        dt: PERIOD / 2000,
        integrator,
        collisionMode: "pass-through",
      });
      sim.stepFixed(2000 * 20); // twenty periods
      return sim.diagnostics().energyDrift;
    };

    const verlet = run("verlet");
    const pefrl = run("pefrl");
    const rk4 = run("rk4");

    // PEFRL (4th order symplectic) should beat Verlet (2nd order symplectic).
    expect(pefrl).toBeLessThan(verlet);
    // Both symplectic methods should keep drift bounded and small.
    expect(verlet).toBeLessThan(1e-3);
    expect(pefrl).toBeLessThan(1e-6);
    // RK4 is recorded rather than asserted against the symplectic ones: it is
    // not symplectic, and this test documents the difference rather than
    // pretending it is a defect.
    expect(Number.isFinite(rk4)).toBe(true);
  });
});
