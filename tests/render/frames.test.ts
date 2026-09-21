/**
 * Reference-frame transform tests.
 *
 * The rotating-frame requirement is specific and testable: in a frame
 * co-rotating with a pair, the secondary body must STAND STILL. If it drifts,
 * the frame is wrong and every Lagrange/Trojan view built on it is wrong too.
 */
import { describe, it, expect } from "vitest";
import { applyFrame, describeFrame, type FrameSpec } from "../../src/render/frames";
import { Simulation } from "../../src/sim/engine";
import type { BodyInit } from "../../src/sim/state";

const body = (
  id: string,
  mass: number,
  p: [number, number, number],
  v: [number, number, number],
): BodyInit => ({
  id,
  name: id,
  mass,
  radius: 1e-6,
  position: { x: p[0], y: p[1], z: p[2] },
  velocity: { x: v[0], y: v[1], z: v[2] },
});

function run(spec: FrameSpec, steps: number, sampleEvery: number) {
  // Sun + Jupiter on a circular orbit, G = 1.
  const m1 = 1;
  const m2 = 1e-3;
  const a = 5.2;
  const omega = Math.sqrt((m1 + m2) / (a * a * a));
  const r1 = (a * m2) / (m1 + m2);
  const r2 = (a * m1) / (m1 + m2);

  const sim = new Simulation({
    bodies: [
      body("Sun", m1, [-r1, 0, 0], [0, -omega * r1, 0]),
      body("Jupiter", m2, [r2, 0, 0], [0, omega * r2, 0]),
    ],
    g: 1,
    dt: 1e-3,
    integrator: "verlet",
    collisionMode: "pass-through",
  });

  const out = new Float32Array(sim.state.count * 3);
  const samples: Array<{ x: number; y: number; z: number }> = [];

  for (let i = 0; i < steps; i++) {
    sim.stepFixed(1);
    if (i % sampleEvery === 0) {
      applyFrame(sim.state.positions, sim.state.masses, sim.state.count, spec, out);
      samples.push({ x: out[3], y: out[4], z: out[5] }); // Jupiter
    }
  }
  return samples;
}

describe("rotating reference frame", () => {
  it("holds the secondary body stationary over a full orbit", () => {
    const samples = run(
      { kind: "rotating", primaryIndex: 0, secondaryIndex: 1 },
      20_000,
      200,
    );
    expect(samples.length).toBeGreaterThan(50);

    // Jupiter must sit on +x at a fixed distance, with no y or z excursion.
    const xs = samples.map((s) => s.x);
    const maxY = Math.max(...samples.map((s) => Math.abs(s.y)));
    const maxZ = Math.max(...samples.map((s) => Math.abs(s.z)));

    expect(maxY).toBeLessThan(1e-9);
    expect(maxZ).toBeLessThan(1e-9);
    // Separation is essentially constant on a circular orbit.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-4);
    // And it is on the POSITIVE x axis by construction.
    expect(Math.min(...xs)).toBeGreaterThan(0);
  });

  it("does NOT hold it stationary in the inertial frame", () => {
    // Guards against the transform being a no-op that trivially "passes".
    const samples = run({ kind: "inertial" }, 20_000, 200);
    const maxY = Math.max(...samples.map((s) => Math.abs(s.y)));
    expect(maxY).toBeGreaterThan(1);
  });
});

describe("barycentric frame", () => {
  it("puts the centre of mass at the origin", () => {
    const positions = new Float64Array([-1, 0, 0, 1, 0, 0]);
    const masses = new Float64Array([3, 1]);
    const out = new Float32Array(6);
    applyFrame(positions, masses, 2, { kind: "barycentric" }, out);

    // CoM is at (3·-1 + 1·1)/4 = -0.5, so bodies land at -0.5 and +1.5.
    expect(out[0]).toBeCloseTo(-0.5, 6);
    expect(out[3]).toBeCloseTo(1.5, 6);

    const com = (3 * out[0] + 1 * out[3]) / 4;
    expect(Math.abs(com)).toBeLessThan(1e-6);
  });
});

describe("body-centred frame", () => {
  it("puts the chosen body at the origin", () => {
    const positions = new Float64Array([2, 3, 4, 10, 10, 10]);
    const masses = new Float64Array([1, 1]);
    const out = new Float32Array(6);
    applyFrame(positions, masses, 2, { kind: "body", primaryIndex: 1 }, out);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(0);
    expect(out[0]).toBeCloseTo(-8, 6);
  });
});

describe("degenerate inputs", () => {
  it("never emits NaN", () => {
    const positions = new Float64Array([0, 0, 0, 0, 0, 0]);
    const masses = new Float64Array([0, 0]);
    const out = new Float32Array(6);
    for (const spec of [
      { kind: "inertial" } as const,
      { kind: "barycentric" } as const,
      { kind: "body", primaryIndex: 0 } as const,
      { kind: "rotating", primaryIndex: 0, secondaryIndex: 1 } as const,
      { kind: "rotating", primaryIndex: 0, secondaryIndex: 0 } as const,
      { kind: "rotating", primaryIndex: 0, secondaryIndex: 99 } as const,
    ]) {
      applyFrame(positions, masses, 2, spec, out);
      for (let i = 0; i < 6; i++) expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("describes each frame for the UI", () => {
    const names = ["Sun", "Jupiter"];
    expect(describeFrame({ kind: "inertial" }, names)).toBe("Inertial");
    expect(describeFrame({ kind: "barycentric" }, names)).toBe("Barycentric");
    expect(describeFrame({ kind: "body", primaryIndex: 1 }, names)).toContain(
      "Jupiter",
    );
    expect(
      describeFrame({ kind: "rotating", primaryIndex: 0, secondaryIndex: 1 }, names),
    ).toContain("Sun");
  });
});
