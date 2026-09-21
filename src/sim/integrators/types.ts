import type { SimState } from "../state";
import type { ForceOptions } from "../forces";

export const INTEGRATOR_NAMES = ["verlet", "pefrl", "rk4"] as const;
export type IntegratorName = (typeof INTEGRATOR_NAMES)[number];

export interface Integrator {
  readonly name: IntegratorName;
  /** Whether the method is symplectic (bounded energy error over long runs). */
  readonly symplectic: boolean;
  /** Force evaluations consumed per step. */
  readonly forceEvaluationsPerStep: number;
  /** Advance the state by exactly `dt`. */
  step(state: SimState, dt: number, force: ForceOptions): void;
  /** Discard cached state. Called when body count or scenario changes. */
  reset(): void;
}
