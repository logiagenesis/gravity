/**
 * Warnings about a running simulation's own trustworthiness.
 *
 * A simulator that quietly returns a smooth, wrong answer is worse than one
 * that says it is struggling. Each warning here corresponds to a specific way
 * this engine can be wrong, and each says what to DO about it rather than only
 * that something is amiss.
 *
 * Pure: takes numbers, returns descriptions. No DOM, no engine state, so it is
 * testable without either.
 */
import { MAX_SUBSTEPS } from "./adaptive";

export type WarningSeverity = "info" | "warn" | "error";

export interface SimulationWarning {
  id: string;
  severity: WarningSeverity;
  title: string;
  /** What is wrong, and what to do about it. */
  detail: string;
}

export interface WarningInputs {
  integrator: "verlet" | "pefrl" | "rk4";
  /** Simulation timestep, days. */
  dt: number;
  /** Shortest orbital period currently present, days, or null if none. */
  shortestPeriodDays: number | null;
  /** Plummer softening length, AU. */
  softening: number;
  /** Closest approach between any pair so far, AU. */
  closestApproachAu: number | null;
  /** Barnes-Hut opening angle, or null when the force mode is direct. */
  theta: number | null;
  /** Substeps the most demanding outer step has needed. */
  peakSubsteps: number;
  /** Outer steps taken so far. */
  stepCount: number;
  /** Relative energy drift. */
  energyDrift: number;
}

/**
 * Steps per orbit below which the picture stops being a picture of the data.
 *
 * A symplectic integrator is STABLE, not accurate, at a coarse step: it will
 * happily return a smooth, wrong orbit indefinitely, which is precisely the
 * failure a reader cannot see. 20 is the floor the catalogue pipeline also
 * enforces on generated scenarios.
 */
const MIN_STEPS_PER_ORBIT = 20;

/**
 * Steps after which a non-symplectic method's secular drift is worth saying
 * out loud. RK4's energy error grows without bound; over a few thousand steps
 * that is invisible, and over a long run it dominates.
 */
const LONG_RUN_STEPS = 50_000;

/** Above this, the Barnes-Hut approximation is no longer a small correction. */
const THETA_LOOSE = 1.0;

/** Energy drift above which the run should not be trusted quantitatively. */
const DRIFT_UNTRUSTWORTHY = 1e-3;

export function simulationWarnings(input: WarningInputs): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];

  // --- the timestep does not resolve the fastest orbit --------------------
  if (input.shortestPeriodDays !== null && input.shortestPeriodDays > 0) {
    const stepsPerOrbit = input.shortestPeriodDays / input.dt;
    if (stepsPerOrbit < MIN_STEPS_PER_ORBIT) {
      warnings.push({
        id: "timestep-vs-period",
        severity: stepsPerOrbit < 8 ? "error" : "warn",
        title: `Only ${stepsPerOrbit.toFixed(1)} steps per orbit`,
        detail:
          `The fastest orbit here takes ${input.shortestPeriodDays.toPrecision(3)} days ` +
          `and the timestep is ${input.dt.toPrecision(3)} days. Below about ` +
          `${MIN_STEPS_PER_ORBIT} steps per orbit the shape of the orbit is not ` +
          `resolved, and a symplectic integrator will keep returning a smooth, ` +
          `wrong answer rather than falling apart. Reduce the timestep.`,
      });
    }
  }

  // --- softening is doing more than smoothing a singularity ---------------
  if (
    input.softening > 0 &&
    input.closestApproachAu !== null &&
    input.closestApproachAu > 0 &&
    input.softening > input.closestApproachAu
  ) {
    warnings.push({
      id: "softening-exceeds-approach",
      severity: "warn",
      title: "Softening is larger than the closest approach",
      detail:
        `The softening length is ${input.softening.toPrecision(3)} AU but bodies have ` +
        `come within ${input.closestApproachAu.toPrecision(3)} AU. Softening replaces ` +
        `the true force at short range with a weaker one, so at this separation the ` +
        `attraction being simulated is substantially less than Newton's. That is a ` +
        `deliberate approximation for avoiding singularities, not a small correction ` +
        `here. Reduce the softening, or read the close passes as illustrative only.`,
    });
  }

  // --- Barnes-Hut opened too wide -----------------------------------------
  if (input.theta !== null && input.theta > THETA_LOOSE) {
    warnings.push({
      id: "theta-loose",
      severity: "warn",
      title: `Opening angle ${input.theta.toPrecision(2)} is loose`,
      detail:
        `Barnes-Hut replaces a distant group of bodies with a single point at their ` +
        `centre of mass whenever the group's angular size is below the opening angle. ` +
        `Above about ${THETA_LOOSE.toFixed(1)} that substitution is no longer a small ` +
        `correction and individual forces can be wrong by percent-level amounts. ` +
        `Reduce it towards 0.5, or switch the force method to direct.`,
    });
  }

  // --- a non-symplectic method left running ------------------------------
  if (input.integrator === "rk4" && input.stepCount > LONG_RUN_STEPS) {
    warnings.push({
      id: "non-symplectic-long-run",
      severity: "warn",
      title: "RK4 is not symplectic, and this is a long run",
      detail:
        `Runge-Kutta 4 is more accurate than Verlet over a few steps and its energy ` +
        `error grows without bound over many. After ` +
        `${input.stepCount.toLocaleString("en-GB")} steps that growth, not the local ` +
        `truncation error, is what the energy readout is showing. For a long run use ` +
        `Verlet or PEFRL, whose energy error stays bounded.`,
    });
  }

  /*
   * --- a low-order method in a system with real close encounters ---------
   *
   * Measured, not guessed (artifacts/12-adaptive-integrator-decision.md):
   * where encounters are tight, PEFRL reaches a relative energy error of
   * 1.0e-6 at 3.6x the fixed-step cost while Verlet is still at 5.8e-3 with
   * 248x the work. The limit is Verlet's second-order truncation error, so a
   * smaller step is not the answer; a better method is.
   */
  if (input.integrator === "verlet" && input.peakSubsteps >= 16) {
    warnings.push({
      id: "low-order-with-encounters",
      severity: "info",
      title: "Close encounters here need a higher-order method",
      detail:
        `An outer step has had to be cut into ${input.peakSubsteps} substeps, which ` +
        `means bodies are passing close. Velocity Verlet is second order, and in ` +
        `measured tests it does not reach PEFRL's accuracy on encounters like these ` +
        `even at 250 times the computational cost — the limit is the method, not the ` +
        `step size. Switch the integrator to PEFRL.`,
    });
  }

  // --- the sub-stepping budget ran out ------------------------------------
  if (input.peakSubsteps >= MAX_SUBSTEPS) {
    warnings.push({
      id: "substep-budget-exhausted",
      severity: "warn",
      title: "An encounter was too close to resolve",
      detail:
        `An outer step needed the full budget of ${MAX_SUBSTEPS.toLocaleString("en-GB")} ` +
        `substeps, so the step was taken at the finest resolution allowed rather than ` +
        `the one the encounter asked for. The cap exists so a near-collision cannot ` +
        `freeze the simulation; the cost is that this particular encounter is less ` +
        `accurate than the rest of the run. The energy drift below tells you by how much.`,
    });
  }

  // --- the run is no longer quantitatively trustworthy --------------------
  if (Number.isFinite(input.energyDrift) && input.energyDrift > DRIFT_UNTRUSTWORTHY) {
    warnings.push({
      id: "energy-drift-high",
      severity: input.energyDrift > 0.1 ? "error" : "warn",
      title: `Energy has drifted by ${(input.energyDrift * 100).toPrecision(3)}%`,
      detail:
        `Total energy should be conserved. It is not being conserved here, so numbers ` +
        `read off this run are not reliable — the trajectory has left the one the ` +
        `initial conditions describe. A smaller timestep or a higher-order integrator ` +
        `will usually fix it. A merge also legitimately changes the total energy; if ` +
        `bodies have merged, the baseline has been reset and this figure is measured ` +
        `from that reset.`,
    });
  }

  return warnings;
}
