/**
 * Adaptive sub-stepping.
 *
 * The properties that matter are not "the error is small" — that is measured
 * in artifacts/12-adaptive-integrator-decision.md — but the invariants the
 * scheme was chosen to preserve:
 *
 *   - the OUTER step is always exactly dt, so simulated time and therefore
 *     speed stay independent of frame rate
 *   - the substep count is a deterministic function of the state, so replay
 *     is reproducible
 *   - a quiet system pays nothing
 */
import { describe, it, expect } from "vitest";
import { chooseSubsteps, DEFAULT_ETA, MAX_SUBSTEPS } from "../../src/sim/adaptive";
import { SimState, type BodyInit } from "../../src/sim/state";
import { computeAccelerations } from "../../src/sim/forces";
import { Simulation } from "../../src/sim/engine";
import { computeConservation } from "../../src/sim/conservation";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";

const force = {
  g: G_AU3_PER_MSUN_DAY2,
  softening: 0,
  mode: "direct" as const,
  theta: 0.5,
};

/** Two bodies `separation` AU apart on a near-circular orbit. */
function pair(separation: number): SimState {
  const speed = Math.sqrt(G_AU3_PER_MSUN_DAY2 / separation) / 2;
  const bodies: BodyInit[] = [
    {
      id: "a",
      name: "A",
      mass: 0.5,
      radius: 1e-5,
      position: { x: -separation / 2, y: 0, z: 0 },
      velocity: { x: 0, y: -speed, z: 0 },
    },
    {
      id: "b",
      name: "B",
      mass: 0.5,
      radius: 1e-5,
      position: { x: separation / 2, y: 0, z: 0 },
      velocity: { x: 0, y: speed, z: 0 },
    },
  ];
  const state = SimState.fromBodies(bodies);
  computeAccelerations(state, force);
  return state;
}

describe("chooseSubsteps", () => {
  it("asks for nothing extra when the step already resolves the motion", () => {
    // A wide, slow pair with a tiny step needs no help.
    expect(chooseSubsteps(pair(10), 1e-4)).toBe(1);
  });

  it("asks for more substeps as the encounter tightens", () => {
    // Kept clear of the clamp, so this measures the criterion and not
    // MAX_SUBSTEPS: at 0.01 AU and below both saturate at 1024.
    const wide = chooseSubsteps(pair(3), 1);
    const close = chooseSubsteps(pair(1), 1);
    const closer = chooseSubsteps(pair(0.3), 1);
    expect(close).toBeGreaterThan(wide);
    expect(closer).toBeGreaterThan(close);
    expect(closer).toBeLessThan(MAX_SUBSTEPS);
  });

  it("always returns a power of two", () => {
    for (const separation of [5, 1, 0.3, 0.05, 0.01, 0.002]) {
      const n = chooseSubsteps(pair(separation), 1);
      expect(Math.log2(n) % 1).toBe(0);
    }
  });

  it("never exceeds the clamp, however violent the encounter", () => {
    // Without a clamp a near-collision would demand an unbounded count and
    // the simulation would appear to freeze.
    expect(chooseSubsteps(pair(1e-8), 10)).toBeLessThanOrEqual(MAX_SUBSTEPS);
  });

  it("is a deterministic function of the state, so replay reproduces", () => {
    const a = pair(0.01);
    const b = pair(0.01);
    expect(chooseSubsteps(a, 1)).toBe(chooseSubsteps(b, 1));
  });

  it("asks for more as eta tightens", () => {
    const state = pair(0.05);
    expect(chooseSubsteps(state, 1, 0.001)).toBeGreaterThan(
      chooseSubsteps(state, 1, DEFAULT_ETA),
    );
  });

  it("handles a single body, and coincident bodies, without dividing by zero", () => {
    const single = SimState.fromBodies([
      {
        id: "a",
        name: "A",
        mass: 1,
        radius: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    ]);
    expect(chooseSubsteps(single, 1)).toBe(1);
  });
});

describe("the engine's outer step stays fixed", () => {
  /** A deliberately eccentric pair, so an encounter really happens. */
  const eccentric = (): BodyInit[] => [
    {
      id: "star",
      name: "Star",
      mass: 1,
      radius: 1e-4,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    {
      id: "comet",
      name: "Comet",
      mass: 1e-9,
      radius: 1e-6,
      position: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0.004, z: 0 },
    },
  ];

  it("advances simulated time by exactly dt per step, sub-stepping or not", () => {
    const simulation = new Simulation({
      bodies: eccentric(),
      dt: 0.5,
      integrator: "pefrl",
      collisionMode: "pass-through",
    });
    simulation.stepFixed(400);
    // 400 outer steps of 0.5 days, whatever happened inside them.
    expect(simulation.simTime).toBeCloseTo(200, 9);
    expect(simulation.stepCount).toBe(400);
  });

  it("actually sub-divides when the comet comes in", () => {
    const simulation = new Simulation({
      bodies: eccentric(),
      dt: 0.5,
      integrator: "pefrl",
      collisionMode: "pass-through",
    });
    simulation.stepFixed(400);
    expect(simulation.peakSubsteps).toBeGreaterThan(1);
  });

  it("costs nothing on a quiet system", () => {
    const simulation = new Simulation({
      bodies: [
        {
          id: "sun",
          name: "Sun",
          mass: 1,
          radius: 0.00465,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        },
        {
          id: "earth",
          name: "Earth",
          mass: 3e-6,
          radius: 4.26e-5,
          position: { x: 1, y: 0, z: 0 },
          velocity: { x: 0, y: 0.0172, z: 0 },
        },
      ],
      dt: 0.5,
      integrator: "verlet",
      collisionMode: "pass-through",
    });
    simulation.stepFixed(730);
    expect(simulation.peakSubsteps).toBe(1);
  });

  it("is reproducible: the same run twice gives the same state", () => {
    const run = () => {
      const s = new Simulation({
        bodies: eccentric(),
        dt: 0.5,
        integrator: "pefrl",
        collisionMode: "pass-through",
      });
      s.stepFixed(400);
      return [...s.state.positions.slice(0, s.state.count * 3)];
    };
    expect(run()).toEqual(run());
  });

  it("keeps a close encounter's energy error far below the fixed step's", () => {
    // The headline claim of artifacts/12, asserted rather than only reported.
    const measure = (adaptive: boolean) => {
      const s = new Simulation({
        bodies: eccentric(),
        dt: 0.5,
        integrator: "pefrl",
        collisionMode: "pass-through",
        adaptive,
      });
      const before = computeConservation(s.state, G_AU3_PER_MSUN_DAY2, 0);
      s.stepFixed(400);
      const after = computeConservation(s.state, G_AU3_PER_MSUN_DAY2, 0);
      return Math.abs((after.totalEnergy - before.totalEnergy) / before.totalEnergy);
    };
    const fixed = measure(false);
    const adaptive = measure(true);
    expect(adaptive).toBeLessThan(fixed / 100);
  });
});
