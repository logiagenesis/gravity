/**
 * Collision merge conservation.
 *
 * REGRESSION for the measured defect in a comparable implementation, where a
 * single merge summed the masses but left the survivor's velocity, position and
 * radius untouched — destroying 100% of the linear momentum
 * (artifacts/03-current-site-audit.md §4.2, measured 200 → 0).
 */
import { describe, it, expect } from "vitest";
import { SimState, type BodyInit } from "../../src/sim/state";
import { resolveCollisions } from "../../src/sim/collisions";
import { computeConservation } from "../../src/sim/conservation";

const body = (
  id: string,
  mass: number,
  radius: number,
  p: [number, number, number],
  v: [number, number, number],
): BodyInit => ({
  id,
  name: id,
  mass,
  radius,
  position: { x: p[0], y: p[1], z: p[2] },
  velocity: { x: v[0], y: v[1], z: v[2] },
});

function momentum(state: SimState) {
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < state.count; i++) {
    const k = i * 3;
    px += state.masses[i] * state.velocities[k];
    py += state.masses[i] * state.velocities[k + 1];
    pz += state.masses[i] * state.velocities[k + 2];
  }
  return { px, py, pz };
}

describe("collision merge", () => {
  it("conserves mass and linear momentum exactly", () => {
    // The exact configuration that measured 200 → 0 upstream.
    const state = SimState.fromBodies([
      body("Heavy", 10, 1, [0, 0, 0], [0, 0, 0]),
      body("Light", 2, 1, [1, 0, 0], [100, 0, 0]),
    ]);

    const massBefore = state.totalMass();
    const pBefore = momentum(state);
    expect(pBefore.px).toBe(200);

    const events = resolveCollisions(state);

    expect(events).toHaveLength(1);
    expect(state.count).toBe(1);
    expect(state.totalMass()).toBeCloseTo(massBefore, 12);

    const pAfter = momentum(state);
    expect(pAfter.px).toBeCloseTo(200, 10);
    expect(pAfter.py).toBeCloseTo(0, 12);
    expect(pAfter.pz).toBeCloseTo(0, 12);

    // v = (m₁v₁ + m₂v₂)/M = 200/12
    expect(state.velocities[0]).toBeCloseTo(200 / 12, 10);
  });

  it("places the survivor at the centre of mass", () => {
    const state = SimState.fromBodies([
      body("A", 3, 1, [0, 0, 0], [0, 0, 0]),
      body("B", 1, 1, [1, 0, 0], [0, 0, 0]),
    ]);
    resolveCollisions(state);
    // (3·0 + 1·1)/4 = 0.25
    expect(state.positions[0]).toBeCloseTo(0.25, 12);
  });

  it("conserves volume when computing the merged radius", () => {
    const state = SimState.fromBodies([
      body("A", 1, 3, [0, 0, 0], [0, 0, 0]),
      body("B", 1, 4, [1, 0, 0], [0, 0, 0]),
    ]);
    resolveCollisions(state);
    // r = (3³ + 4³)^(1/3) = 91^(1/3)
    expect(state.radii[0]).toBeCloseTo(Math.cbrt(91), 12);
  });

  it("decreases kinetic energy, because a merge is perfectly inelastic", () => {
    const state = SimState.fromBodies([
      body("A", 1, 1, [0, 0, 0], [10, 0, 0]),
      body("B", 1, 1, [1, 0, 0], [-10, 0, 0]),
    ]);
    const before = computeConservation(state, 1, 0).kineticEnergy;
    resolveCollisions(state);
    const after = computeConservation(state, 1, 0).kineticEnergy;

    // Head-on equal-and-opposite: all kinetic energy goes into the merge.
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(0, 12);
  });

  it("merges a three-body pile-up in one operation, independent of ordering", () => {
    const state = SimState.fromBodies([
      body("A", 1, 1, [0, 0, 0], [3, 0, 0]),
      body("B", 2, 1, [0.5, 0, 0], [0, 6, 0]),
      body("C", 3, 1, [1.0, 0, 0], [0, 0, 9]),
    ]);
    const pBefore = momentum(state);

    const events = resolveCollisions(state);

    expect(events).toHaveLength(1);
    expect(state.count).toBe(1);
    expect(state.masses[0]).toBeCloseTo(6, 12);

    const pAfter = momentum(state);
    expect(pAfter.px).toBeCloseTo(pBefore.px, 10);
    expect(pAfter.py).toBeCloseTo(pBefore.py, 10);
    expect(pAfter.pz).toBeCloseTo(pBefore.pz, 10);
  });

  /** REGRESSION: splicing under iteration can skip bodies entirely. */
  it("never skips a body when several separate pairs merge at once", () => {
    // Three well-separated pairs, each pair overlapping internally.
    const state = SimState.fromBodies([
      body("A1", 1, 0.6, [0, 0, 0], [1, 0, 0]),
      body("A2", 1, 0.6, [1, 0, 0], [-1, 0, 0]),
      body("B1", 1, 0.6, [100, 0, 0], [2, 0, 0]),
      body("B2", 1, 0.6, [101, 0, 0], [-2, 0, 0]),
      body("C1", 1, 0.6, [200, 0, 0], [3, 0, 0]),
      body("C2", 1, 0.6, [201, 0, 0], [-3, 0, 0]),
    ]);
    const massBefore = state.totalMass();

    const events = resolveCollisions(state);

    expect(events).toHaveLength(3);
    expect(state.count).toBe(3);
    expect(state.totalMass()).toBeCloseTo(massBefore, 12);
    // Every surviving body must be a genuine merged pair.
    for (let i = 0; i < state.count; i++) expect(state.masses[i]).toBeCloseTo(2, 12);
  });

  it("leaves non-overlapping bodies untouched", () => {
    const state = SimState.fromBodies([
      body("A", 1, 0.1, [0, 0, 0], [0, 0, 0]),
      body("B", 1, 0.1, [5, 0, 0], [0, 0, 0]),
    ]);
    expect(resolveCollisions(state)).toHaveLength(0);
    expect(state.count).toBe(2);
  });

  it("lets massless test particles pass through massive bodies", () => {
    const state = SimState.fromBodies([
      { ...body("Sun", 1, 1, [0, 0, 0], [0, 0, 0]) },
      { ...body("tracer", 0, 1, [0, 0, 0], [0, 0, 0]), massless: true },
    ]);
    expect(resolveCollisions(state)).toHaveLength(0);
    expect(state.count).toBe(2);
  });
});
