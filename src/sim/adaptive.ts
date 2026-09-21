/**
 * Adaptive sub-stepping for close encounters.
 *
 * WHY THIS EXISTS, measured rather than assumed. The brief permits an adaptive
 * method "if justified"; artifacts/12-adaptive-integrator-decision.md is the
 * measurement that justified it. Integrated for 400 days at their shipped
 * timesteps, the relative energy error reached:
 *
 *   three-body chaos   verlet 1.2e+1   pefrl 3.1e+0   rk4 5.5e+1
 *   close flyby        verlet 1.1e+1
 *
 * Those are not drifts, they are failures: the bodies pass close enough that a
 * fixed step steps straight over the encounter and invents energy. Halving the
 * step repeatedly fixes it, which is the signature of a problem an adaptive
 * scheme removes.
 *
 * WHY SUB-STEPPING RATHER THAN A VARIABLE STEP. Two properties of this engine
 * are worth keeping:
 *
 *   - the OUTER timestep is fixed, so simulated time advances by exactly `dt`
 *     per step and the accumulator keeps speed independent of frame rate
 *   - replay is deterministic
 *
 * A variable step breaks both. Instead each outer step of length `dt` is
 * integrated as 2^k substeps of dt/2^k, with k chosen from the state at the
 * start of the step. Simulated time still advances by exactly `dt`, k is a
 * deterministic function of the state, and the symplectic integrators keep
 * their structure within the block. The cost rises only while an encounter is
 * actually happening.
 *
 * THE CRITERION is the standard N-body pairwise one: for every pair, the
 * shorter of the crossing time and the free-fall-like time,
 *
 *   tau_ij = min( r_ij / v_ij ,  sqrt( r_ij / a_ij ) )
 *
 * where r, v and a are the pair's relative separation, speed and
 * acceleration. The step must satisfy dt <= eta * tau_min.
 */
import type { SimState } from "./state";

/**
 * Accuracy parameter. Smaller is more accurate and more expensive.
 *
 * 0.01, chosen from the sweep in
 * artifacts/12-adaptive-integrator-decision.md. On three-body chaos over 400
 * days, relative energy error against cost (as a multiple of the fixed-step
 * work):
 *
 *   eta     PEFRL error / cost      Verlet error / cost
 *   0.03    2.3e-5  at  1.7x        1.0e-1  at    3.5x
 *   0.01    1.0e-6  at  3.6x        3.5e-1  at   11.9x
 *   0.003   5.5e-8  at 11.0x        2.4e-2  at   31.9x
 *   0.001   2.3e-7  at 31.4x        5.8e-3  at  248.4x
 *
 * 0.01 buys PEFRL a millionth-level error for under four times the work. The
 * second column is the more important finding and is why the simulator warns
 * about it: VERLET CANNOT REACH THAT ACCURACY AT ANY AFFORDABLE COST. Its
 * error is still 5.8e-3 at 248 times the work, because the limit is its
 * second-order truncation error and not the step-size criterion. For a
 * scenario with real close encounters the fix is a better method, not a
 * smaller step.
 */
export const DEFAULT_ETA = 0.01;

/**
 * Ceiling on the sub-step count for one outer step.
 *
 * Without it, two bodies heading for a true collision would demand an
 * unbounded number of substeps and the simulation would appear to freeze. With
 * it, an encounter that cannot be resolved is integrated as accurately as the
 * budget allows and the conservation readout shows the reader the cost — which
 * is the honest failure mode, because the error stays visible instead of being
 * hidden behind a stall.
 *
 * 1024 is not arbitrary: raising it to 16,384 was measured and changed the
 * final energy error by less than the run-to-run variation of a chaotic
 * system (3.52e-1 vs 3.60e-1 for Verlet at eta = 0.01), so the extra work
 * bought nothing. The clamp is not the limiting term.
 */
export const MAX_SUBSTEPS = 1024;

export interface SubstepDecision {
  /** How many substeps this outer step needs. A power of two, at least 1. */
  substeps: number;
  /**
   * Closest pair separation seen in this pass, AU, or Infinity if there is
   * no pair. Returned because this pass already computes every pairwise
   * distance, so taking the minimum here costs nothing, and a second O(n^2)
   * loop elsewhere to find the same number would cost plenty.
   */
  minSeparation: number;
}

/**
 * Decide how finely to cut this outer step.
 *
 * `accelerations` must already hold the accelerations for the current
 * positions; the engine computes them as part of the previous step, so this
 * costs no extra force evaluation.
 */
export function chooseSubsteps(
  state: SimState,
  dt: number,
  eta: number = DEFAULT_ETA,
  maxSubsteps: number = MAX_SUBSTEPS,
): SubstepDecision {
  const { positions, velocities, accelerations, count } = state;
  if (count < 2 || dt <= 0) return { substeps: 1, minSeparation: Infinity };

  let shortest = Infinity;
  let minSeparation = Infinity;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    for (let j = i + 1; j < count; j++) {
      const j3 = j * 3;
      const dx = positions[j3] - positions[i3];
      const dy = positions[j3 + 1] - positions[i3 + 1];
      const dz = positions[j3 + 2] - positions[i3 + 2];
      const r = Math.hypot(dx, dy, dz);
      if (r === 0 || !Number.isFinite(r)) continue;
      if (r < minSeparation) minSeparation = r;

      const dvx = velocities[j3] - velocities[i3];
      const dvy = velocities[j3 + 1] - velocities[i3 + 1];
      const dvz = velocities[j3 + 2] - velocities[i3 + 2];
      const v = Math.hypot(dvx, dvy, dvz);

      const dax = accelerations[j3] - accelerations[i3];
      const day = accelerations[j3 + 1] - accelerations[i3 + 1];
      const daz = accelerations[j3 + 2] - accelerations[i3 + 2];
      const a = Math.hypot(dax, day, daz);

      // Crossing time: how long until the pair's separation changes a lot.
      if (v > 0) shortest = Math.min(shortest, r / v);
      // Acceleration time: how long until the relative velocity changes a lot.
      if (a > 0) shortest = Math.min(shortest, Math.sqrt(r / a));
    }
  }

  if (!Number.isFinite(shortest) || shortest <= 0) {
    return { substeps: 1, minSeparation };
  }

  const allowed = eta * shortest;
  if (dt <= allowed) return { substeps: 1, minSeparation };

  // Round the ratio UP to a power of two, so the substep length only ever
  // halves. Powers of two keep the substep an exact binary fraction of dt,
  // which means no accumulated rounding in the simulated clock.
  const needed = dt / allowed;
  const exponent = Math.ceil(Math.log2(needed));
  const substeps = Math.pow(2, Math.min(exponent, Math.log2(maxSubsteps)));
  return {
    substeps: Math.min(maxSubsteps, Math.max(1, substeps)),
    minSeparation,
  };
}
