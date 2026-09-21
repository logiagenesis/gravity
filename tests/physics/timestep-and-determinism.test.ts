/**
 * REGRESSION for the measured defect in a comparable implementation, where the
 * integrator ran exactly once per requestAnimationFrame callback, making
 * simulated time proportional to display refresh rate — a 144 Hz monitor ran
 * the physics 2.4× faster than a 60 Hz one
 * (artifacts/03-current-site-audit.md §4.3).
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../../src/sim/engine";
import type { BodyInit } from "../../src/sim/state";

function scenario(): BodyInit[] {
  return [
    {
      id: "star",
      name: "Star",
      mass: 1,
      radius: 1e-4,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    {
      id: "planet",
      name: "Planet",
      mass: 1e-3,
      radius: 1e-5,
      position: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 1, z: 0 },
    },
  ];
}

function make() {
  return new Simulation({
    bodies: scenario(),
    g: 1,
    dt: 1e-4,
    integrator: "verlet",
    collisionsEnabled: false,
  });
}

/** Run for `realSeconds` of wall-clock time at a given frame rate. */
function runAtFrameRate(
  sim: Simulation,
  hz: number,
  realSeconds: number,
  speed: number,
) {
  const frames = Math.round(hz * realSeconds);
  const perFrame = 1 / hz;
  for (let i = 0; i < frames; i++) sim.advance(perFrame, speed);
}

describe("timestep independence", () => {
  it("advances simulated time identically at 30, 60 and 144 Hz", () => {
    const speed = 1; // simulated days per real second
    const realSeconds = 2;
    const dt = 1e-4; // must match make()

    const results = [30, 60, 144].map((hz) => {
      const sim = make();
      runAtFrameRate(sim, hz, realSeconds, speed);
      return { hz, simTime: sim.simTime, steps: sim.stepCount };
    });

    const reference = results[0];
    for (const r of results) {
      // The guarantee is that simulated time tracks WALL-CLOCK time, not frame
      // count. It is stated as a relative tolerance rather than bit-equality
      // because the caller's own inputs differ between rates: summing 1/144 a
      // hundred and forty-four times does not give exactly the same double as
      // summing 1/60 sixty times. That residual is ~1e-16 relative and can
      // shift the final step across the threshold, so step counts may differ
      // by one. The defect this guards against is a 2.4x difference.
      // The exact, defensible bound is ONE TIMESTEP. Anything coarser would be
      // a magic number; anything finer is unachievable given the input residual.
      expect(Math.abs(r.simTime - reference.simTime)).toBeLessThanOrEqual(
        dt * 1.000001,
      );
      expect(Math.abs(r.steps - reference.steps)).toBeLessThanOrEqual(1);
    }

    // And it must be the physically expected amount: 2 real seconds at
    // 1 simulated day per second is 2 simulated days -- reached from below,
    // because a fixed-timestep scheme cannot advance a partial step. The
    // un-stepped remainder stays in the accumulator for the next frame, so
    // simTime lags the requested total by strictly less than one dt.
    const requested = realSeconds * speed;
    expect(reference.simTime).toBeLessThanOrEqual(requested);
    // The slack covers floating-point error accumulated in the caller's own
    // summed frame deltas (~1e-13 over 60 frames), which can push the measured
    // lag a few ulps past exactly one dt. The physical claim -- the lag is one
    // timestep, not a frame-rate-dependent multiple of one -- is unaffected.
    expect(requested - reference.simTime).toBeLessThan(dt + 1e-9);
  });

  it("produces the same trajectory at different frame rates", () => {
    const a = make();
    const b = make();
    runAtFrameRate(a, 60, 1, 0.5);
    runAtFrameRate(b, 144, 1, 0.5);

    // Within one step, per the note above.
    expect(Math.abs(a.stepCount - b.stepCount)).toBeLessThanOrEqual(1);

    // Step both to the SAME step count, then the trajectories must agree
    // bit-for-bit: that isolates frame-rate independence from the caller's
    // floating-point input differences.
    const target = Math.max(a.stepCount, b.stepCount);
    a.stepFixed(target - a.stepCount);
    b.stepFixed(target - b.stepCount);

    for (let i = 0; i < a.state.count * 3; i++) {
      expect(a.state.positions[i]).toBe(b.state.positions[i]);
    }
  });

  it("does not run away after a long stall", () => {
    const sim = make();
    // A ten-second stall must be clamped, not turned into 100,000 steps.
    sim.advance(10, 1);
    expect(sim.simTime).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  it("ignores non-finite or non-positive frame deltas", () => {
    const sim = make();
    expect(sim.advance(Number.NaN, 1).steps).toBe(0);
    expect(sim.advance(0, 1).steps).toBe(0);
    expect(sim.advance(-1, 1).steps).toBe(0);
    expect(sim.stepCount).toBe(0);
  });
});

describe("deterministic replay", () => {
  it("produces bit-identical state from identical inputs", () => {
    const a = make();
    const b = make();
    a.stepFixed(5000);
    b.stepFixed(5000);

    for (let i = 0; i < a.state.count * 3; i++) {
      expect(a.state.positions[i]).toBe(b.state.positions[i]);
      expect(a.state.velocities[i]).toBe(b.state.velocities[i]);
    }
    expect(a.simTime).toBe(b.simTime);
    expect(a.stepCount).toBe(b.stepCount);
  });

  it("reaches the same state whether stepped in one batch or many", () => {
    const one = make();
    const many = make();
    one.stepFixed(3000);
    for (let i = 0; i < 3000; i++) many.stepFixed(1);

    for (let i = 0; i < one.state.count * 3; i++) {
      expect(one.state.positions[i]).toBe(many.state.positions[i]);
    }
  });

  it("rejects an invalid timestep rather than silently misbehaving", () => {
    const sim = make();
    expect(() => sim.setTimestep(0)).toThrow(RangeError);
    expect(() => sim.setTimestep(-1)).toThrow(RangeError);
    expect(() => sim.setTimestep(Number.NaN)).toThrow(RangeError);
  });
});
