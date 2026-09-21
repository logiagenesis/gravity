/**
 * Classical fourth-order Runge-Kutta, applied to the first-order system
 * (x, v)' = (v, a(x)).
 *
 * Offered for familiarity and for comparison against the symplectic methods.
 *
 * RK4 is NOT symplectic. Its energy error grows secularly rather than staying
 * bounded, so over many orbits it drifts in a way Verlet and PEFRL do not.
 * That is a property of the method, not a defect in this implementation — the
 * UI says so at the point of selection, and the regression tests assert the
 * bounded-drift requirement only for the symplectic methods.
 */
import type { SimState } from "../state";
import { computeAccelerations, type ForceOptions } from "../forces";
import type { Integrator } from "./types";

export class Rk4 implements Integrator {
  readonly name = "rk4" as const;
  readonly symplectic = false;
  readonly forceEvaluationsPerStep = 4;

  private scratch: Float64Array | null = null;
  private capacity = 0;

  reset(): void {
    this.scratch = null;
    this.capacity = 0;
  }

  /** Nine xyz buffers: x0, v0, and k1..k4 for both position and velocity. */
  private ensure(n: number): Float64Array {
    if (this.scratch === null || this.capacity < n) {
      this.capacity = n;
      this.scratch = new Float64Array(n * 10);
    }
    return this.scratch;
  }

  step(state: SimState, dt: number, force: ForceOptions): void {
    const { positions, velocities, accelerations, count } = state;
    const n = count * 3;
    const s = this.ensure(n);

    const x0 = 0;
    const v0 = n;
    const k1v = 2 * n;
    const k2x = 3 * n;
    const k2v = 4 * n;
    const k3x = 5 * n;
    const k3v = 6 * n;
    const k4x = 7 * n;
    const k4v = 8 * n;

    for (let i = 0; i < n; i++) {
      s[x0 + i] = positions[i];
      s[v0 + i] = velocities[i];
    }

    // k1: derivative at the current state. k1x is just v0.
    computeAccelerations(state, force);
    for (let i = 0; i < n; i++) s[k1v + i] = accelerations[i];

    // k2 at midpoint using k1.
    const half = dt * 0.5;
    for (let i = 0; i < n; i++) {
      s[k2x + i] = s[v0 + i] + half * s[k1v + i];
      positions[i] = s[x0 + i] + half * s[v0 + i];
    }
    computeAccelerations(state, force);
    for (let i = 0; i < n; i++) s[k2v + i] = accelerations[i];

    // k3 at midpoint using k2.
    for (let i = 0; i < n; i++) {
      s[k3x + i] = s[v0 + i] + half * s[k2v + i];
      positions[i] = s[x0 + i] + half * s[k2x + i];
    }
    computeAccelerations(state, force);
    for (let i = 0; i < n; i++) s[k3v + i] = accelerations[i];

    // k4 at the endpoint using k3.
    for (let i = 0; i < n; i++) {
      s[k4x + i] = s[v0 + i] + dt * s[k3v + i];
      positions[i] = s[x0 + i] + dt * s[k3x + i];
    }
    computeAccelerations(state, force);
    for (let i = 0; i < n; i++) s[k4v + i] = accelerations[i];

    // Weighted combination.
    const sixth = dt / 6;
    for (let i = 0; i < n; i++) {
      positions[i] =
        s[x0 + i] + sixth * (s[v0 + i] + 2 * s[k2x + i] + 2 * s[k3x + i] + s[k4x + i]);
      velocities[i] =
        s[v0 + i] + sixth * (s[k1v + i] + 2 * s[k2v + i] + 2 * s[k3v + i] + s[k4v + i]);
    }

    // Leave the acceleration field consistent with the final positions.
    computeAccelerations(state, force);
  }
}
