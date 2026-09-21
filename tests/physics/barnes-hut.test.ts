/**
 * Barnes-Hut correctness, including explicit regressions for the defects
 * measured in a comparable implementation (artifacts/03-current-site-audit.md
 * §4.1, §4.4, §4.5).
 */
import { describe, it, expect } from "vitest";
import { SimState, type BodyInit } from "../../src/sim/state";
import {
  computeAccelerationsDirect,
  computeAccelerationsBarnesHut,
} from "../../src/sim/forces";
import { buildOctree } from "../../src/sim/barnes-hut";

const body = (
  id: string,
  mass: number,
  p: [number, number, number],
  massless = false,
): BodyInit => ({
  id,
  name: id,
  mass,
  radius: 1e-9,
  position: { x: p[0], y: p[1], z: p[2] },
  velocity: { x: 0, y: 0, z: 0 },
  massless,
});

/** Deterministic pseudo-random cloud, so the test is reproducible. */
function cloud(n: number, extent: number): BodyInit[] {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  return Array.from({ length: n }, (_, i) =>
    body(`b${i}`, 0.5 + next(), [
      (next() - 0.5) * extent,
      (next() - 0.5) * extent,
      (next() - 0.5) * extent,
    ]),
  );
}

/**
 * Largest per-body relative error of the acceleration VECTOR:
 *   max_i |a_approx,i − a_exact,i| / |a_exact,i|
 *
 * Deliberately not a per-component measure. In a roughly isotropic cloud an
 * individual component can be near zero through cancellation, so its relative
 * error blows up while the vector itself is accurate. That would measure the
 * metric, not the algorithm.
 */
function maxRelativeError(
  exact: Float64Array,
  approx: Float64Array,
  n: number,
): number {
  let worst = 0;
  for (let i = 0; i < n; i += 3) {
    const ex = exact[i];
    const ey = exact[i + 1];
    const ez = exact[i + 2];
    const dx = approx[i] - ex;
    const dy = approx[i + 1] - ey;
    const dz = approx[i + 2] - ez;
    const magnitude = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (magnitude < 1e-300) continue;
    const e = Math.sqrt(dx * dx + dy * dy + dz * dz) / magnitude;
    if (e > worst) worst = e;
  }
  return worst;
}

describe("Barnes-Hut vs direct force", () => {
  it("agrees with the direct sum to within the opening-angle tolerance", () => {
    const bodies = cloud(400, 20);
    const state = SimState.fromBodies(bodies);

    computeAccelerationsDirect(state, 1, 0);
    const exact = state.accelerations.slice(0, state.count * 3);

    computeAccelerationsBarnesHut(state, 1, 0, 0.3);
    const approx = state.accelerations.slice(0, state.count * 3);

    expect(maxRelativeError(exact, approx, state.count * 3)).toBeLessThan(0.05);
  });

  it("converges to the direct sum as theta approaches zero", () => {
    const bodies = cloud(200, 10);
    const state = SimState.fromBodies(bodies);

    computeAccelerationsDirect(state, 1, 0);
    const exact = state.accelerations.slice(0, state.count * 3);

    const errorAt = (theta: number) => {
      computeAccelerationsBarnesHut(state, 1, 0, theta);
      return maxRelativeError(exact, state.accelerations, state.count * 3);
    };

    // theta = 0 forces full traversal, so the result must be essentially exact.
    expect(errorAt(0)).toBeLessThan(1e-12);
    expect(errorAt(0.2)).toBeLessThan(errorAt(0.8));
  });

  /**
   * REGRESSION for the measured defect: a fixed root box makes bodies beyond it
   * contribute EXACTLY ZERO force. Our root bounds are recomputed from the
   * bodies' actual extent, so distance must not matter.
   */
  it("does not drop distant bodies at any scale", () => {
    for (const separation of [1, 100, 600, 1e3, 1e4, 1e6]) {
      const state = SimState.fromBodies([
        body("a", 1, [0, 0, 0]),
        body("b", 1, [separation, 0, 0]),
      ]);

      computeAccelerationsBarnesHut(state, 1, 0, 0.5);
      const ax = state.accelerations[0];
      const analytic = 1 / (separation * separation);

      expect(ax).not.toBe(0);
      expect(Math.abs(ax - analytic) / analytic).toBeLessThan(1e-12);
    }
  });

  it("puts the root centre of mass in the right place", () => {
    // Two equal masses at ±1 on x: the centre of mass must be the origin.
    // Seeding the accumulator with anything non-zero leaves a residual offset.
    const state = SimState.fromBodies([
      body("a", 1, [-1, 0, 0]),
      body("b", 1, [1, 0, 0]),
    ]);
    const tree = buildOctree(state);
    expect(tree).not.toBeNull();
    expect(Math.abs(tree!.com[0])).toBeLessThan(1e-15);
    expect(Math.abs(tree!.com[1])).toBeLessThan(1e-15);
    expect(Math.abs(tree!.com[2])).toBeLessThan(1e-15);
    expect(tree!.mass[0]).toBeCloseTo(2, 12);

    // Asymmetric case: 3:1 mass ratio puts the CoM a quarter of the way along.
    const skewed = SimState.fromBodies([
      body("a", 3, [0, 0, 0]),
      body("b", 1, [4, 0, 0]),
    ]);
    const tree2 = buildOctree(skewed);
    expect(tree2!.com[0]).toBeCloseTo(1, 12);
  });

  /** REGRESSION: unbounded recursion on near-coincident bodies overflows the stack. */
  it("survives many near-coincident bodies without overflowing the stack", () => {
    const bodies: BodyInit[] = [];
    for (let i = 0; i < 300; i++) {
      // Separations far below any sane resolution, forcing maximum subdivision.
      bodies.push(body(`c${i}`, 1, [i * 1e-15, 0, 0]));
    }
    const state = SimState.fromBodies(bodies);

    expect(() => computeAccelerationsBarnesHut(state, 1, 1e-6, 0.5)).not.toThrow();
    for (let i = 0; i < state.count * 3; i++) {
      expect(Number.isFinite(state.accelerations[i])).toBe(true);
    }
  });

  it("handles exactly coincident bodies without producing NaN", () => {
    const state = SimState.fromBodies([
      body("a", 1, [0, 0, 0]),
      body("b", 1, [0, 0, 0]),
      body("c", 1, [5, 0, 0]),
    ]);
    computeAccelerationsBarnesHut(state, 1, 0, 0.5);
    for (let i = 0; i < state.count * 3; i++) {
      expect(Number.isFinite(state.accelerations[i])).toBe(true);
    }
  });

  it("excludes massless test particles from the tree entirely", () => {
    // One massive body and many massless tracers: the tracers must not
    // influence the massive body at all.
    const withTracers = SimState.fromBodies([
      body("sun", 1, [0, 0, 0]),
      body("t1", 0, [1, 0, 0], true),
      body("t2", 0, [2, 0, 0], true),
      body("t3", 0, [-3, 0, 0], true),
    ]);
    computeAccelerationsBarnesHut(withTracers, 1, 0, 0.5);

    expect(withTracers.accelerations[0]).toBe(0);
    expect(withTracers.accelerations[1]).toBe(0);
    expect(withTracers.accelerations[2]).toBe(0);

    // But the tracers themselves must feel the massive body.
    expect(withTracers.accelerations[3]).toBeCloseTo(-1, 12);
  });
});
