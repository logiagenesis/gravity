import { VelocityVerlet } from "./verlet";
import { Pefrl } from "./pefrl";
import { Rk4 } from "./rk4";
import type { Integrator, IntegratorName } from "./types";

export { INTEGRATOR_NAMES } from "./types";
export type { Integrator, IntegratorName } from "./types";
export { VelocityVerlet, Pefrl, Rk4 };

export function createIntegrator(name: IntegratorName): Integrator {
  switch (name) {
    case "verlet":
      return new VelocityVerlet();
    case "pefrl":
      return new Pefrl();
    case "rk4":
      return new Rk4();
  }
}

export interface IntegratorInfo {
  name: IntegratorName;
  label: string;
  order: number;
  symplectic: boolean;
  forceEvaluationsPerStep: number;
  /** Shown in the picker so the trade-off is explicit rather than folklore. */
  guidance: string;
}

export const INTEGRATOR_INFO: readonly IntegratorInfo[] = [
  {
    name: "verlet",
    label: "Velocity Verlet",
    order: 2,
    symplectic: true,
    forceEvaluationsPerStep: 1,
    guidance:
      "Recommended default. Symplectic, so energy error stays bounded over long runs. Cheapest per step.",
  },
  {
    name: "pefrl",
    label: "PEFRL",
    order: 4,
    symplectic: true,
    forceEvaluationsPerStep: 4,
    guidance:
      "Fourth order and still symplectic. Four times the cost per step; use when you need accuracy over many orbits.",
  },
  {
    name: "rk4",
    label: "Runge-Kutta 4",
    order: 4,
    symplectic: false,
    forceEvaluationsPerStep: 4,
    guidance:
      "Familiar and accurate over short spans, but NOT symplectic: energy drifts steadily over long runs. Good for comparison, poor for long integrations.",
  },
];
