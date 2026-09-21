/**
 * PEFRL — Position Extended Forest-Ruth Like.
 *
 * Coefficients from Omelyan, Mryglod & Folk, "Optimized Forest-Ruth- and
 * Suzuki-like algorithms for integration of motion in many-body systems",
 * Computer Physics Communications 146 (2002) 188-202.
 *
 * Fourth order and symplectic, at four force evaluations per step. The
 * position-extended form starts and ends with a drift, which is what allows
 * the higher order without the large negative coefficients of plain
 * Forest-Ruth.
 */
import type { SimState } from "../state";
import { computeAccelerations, type ForceOptions } from "../forces";
import type { Integrator } from "./types";

// Omelyan, Mryglod & Folk (2002), optimised PEFRL coefficients.
const XI = 0.1786178958448091;
const LAMBDA = -0.2123418310626054;
const CHI = -0.06626458266981849;

export class Pefrl implements Integrator {
  readonly name = "pefrl" as const;
  readonly symplectic = true;
  readonly forceEvaluationsPerStep = 4;

  reset(): void {
    /* stateless */
  }

  private drift(state: SimState, factor: number): void {
    const { positions, velocities, count } = state;
    const n = count * 3;
    for (let i = 0; i < n; i++) positions[i] += factor * velocities[i];
  }

  private kick(state: SimState, factor: number, force: ForceOptions): void {
    computeAccelerations(state, force);
    const { velocities, accelerations, count } = state;
    const n = count * 3;
    for (let i = 0; i < n; i++) velocities[i] += factor * accelerations[i];
  }

  step(state: SimState, dt: number, force: ForceOptions): void {
    const halfOneMinusTwoLambda = (1 - 2 * LAMBDA) * 0.5 * dt;
    const middleDrift = (1 - 2 * (CHI + XI)) * dt;

    this.drift(state, XI * dt);
    this.kick(state, halfOneMinusTwoLambda, force);
    this.drift(state, CHI * dt);
    this.kick(state, LAMBDA * dt, force);
    this.drift(state, middleDrift);
    this.kick(state, LAMBDA * dt, force);
    this.drift(state, CHI * dt);
    this.kick(state, halfOneMinusTwoLambda, force);
    this.drift(state, XI * dt);

    // Leave `accelerations` consistent with the final positions so diagnostics
    // and any subsequent integrator swap see a valid field.
    computeAccelerations(state, force);
  }
}
