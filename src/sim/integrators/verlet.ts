/**
 * Velocity Verlet.
 *
 * Standard kick-drift-kick form (Swope et al., J. Chem. Phys. 76, 637, 1982):
 *
 *   v(t + dt/2) = v(t)        + (dt/2)·a(t)
 *   x(t + dt)   = x(t)        + dt·v(t + dt/2)
 *   a(t + dt)   = a(x(t + dt))
 *   v(t + dt)   = v(t + dt/2) + (dt/2)·a(t + dt)
 *
 * Second order, symplectic and time-reversible, at one force evaluation per
 * step. Energy error stays bounded rather than growing secularly, which is
 * what a long-running orbital integration needs — hence the default.
 *
 * The acceleration from the end of a step is reused as the start of the next,
 * so a step really does cost one force evaluation.
 */
import type { SimState } from "../state";
import { computeAccelerations, type ForceOptions } from "../forces";
import type { Integrator } from "./types";

export class VelocityVerlet implements Integrator {
  readonly name = "verlet" as const;
  readonly symplectic = true;
  readonly forceEvaluationsPerStep = 1;

  private primed = false;

  reset(): void {
    this.primed = false;
  }

  step(state: SimState, dt: number, force: ForceOptions): void {
    const { positions, velocities, accelerations, count } = state;
    const n = count * 3;

    // Acceleration at the current position must be valid before the first kick.
    if (!this.primed) {
      computeAccelerations(state, force);
      this.primed = true;
    }

    const halfDt = dt * 0.5;

    // Half kick, then drift.
    for (let i = 0; i < n; i++) {
      velocities[i] += halfDt * accelerations[i];
      positions[i] += dt * velocities[i];
    }

    // Recompute forces at the new positions.
    computeAccelerations(state, force);

    // Second half kick.
    for (let i = 0; i < n; i++) {
      velocities[i] += halfDt * accelerations[i];
    }
  }
}
