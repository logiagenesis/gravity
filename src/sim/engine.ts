/**
 * Simulation engine: fixed-timestep accumulator over the physics core.
 *
 * THE POINT OF THIS FILE. In a comparable implementation the integrator was
 * called exactly once per requestAnimationFrame callback, so simulated time
 * advanced once per *displayed frame*. A 144 Hz display therefore ran the
 * physics 2.4× faster than a 60 Hz one, and a throttled background tab ran
 * slower still (artifacts/03-current-site-audit.md §4.3).
 *
 * Here, wall-clock time drives an accumulator and the integrator runs a whole
 * number of fixed `dt` steps. Over a given span of real time the same number
 * of steps is taken regardless of frame cadence, so the trajectory is identical
 * at 30, 60 or 144 Hz. `tests/physics/timestep-independence.test.ts` asserts it.
 */
import { SimState, type BodyInit } from "./state";
import { computeAccelerations, type ForceMode, type ForceOptions } from "./forces";
import { createIntegrator, type Integrator, type IntegratorName } from "./integrators";
import { chooseSubsteps, DEFAULT_ETA } from "./adaptive";
import {
  resolveCollisions,
  type CollisionEvent,
  type CollisionMode,
} from "./collisions";
import { computeConservation, relativeDrift, type Conservation } from "./conservation";
import { G_AU3_PER_MSUN_DAY2 } from "./constants";

/**
 * Longest real-time span honoured in a single advance, in seconds.
 * Without this clamp, one long stall would queue a huge number of steps, each
 * of which takes time, which queues more — the classic spiral of death.
 */
export const MAX_FRAME_SECONDS = 0.25;

/** Hard ceiling on steps per advance, so one call can never block the worker. */
export const MAX_STEPS_PER_ADVANCE = 20_000;

/**
 * Body count above which Barnes-Hut is chosen in "auto" mode.
 *
 * MEASURED, not assumed. `scripts/benchmark-forces.ts` on Node v22.22.2,
 * Intel Xeon @ 2.10 GHz, theta = 0.5:
 *
 *   n=256   direct 0.327 ms   BH 0.721 ms   0.45x
 *   n=512   direct 1.584 ms   BH 1.932 ms   0.82x   <- BH still SLOWER
 *   n=1024  direct 5.118 ms   BH 5.035 ms   1.02x   <- crossover
 *   n=2048  direct 19.94 ms   BH 13.13 ms   1.52x
 *   n=4096  direct 80.01 ms   BH 32.31 ms   2.48x
 *
 * An earlier guess of 512 would have selected Barnes-Hut where it is 22%
 * slower AND approximate — worse on both counts. Re-run the benchmark if the
 * force or tree code changes materially.
 */
export const AUTO_BARNES_HUT_THRESHOLD = 1024;

export interface SimulationConfig {
  bodies: readonly BodyInit[];
  /** Gravitational constant. Defaults to the exact AU/M☉/day value. */
  g?: number;
  /** Plummer softening length ε, in AU. */
  softening?: number;
  integrator?: IntegratorName;
  /** Simulation timestep, in days. */
  dt?: number;
  forceMode?: ForceMode | "auto";
  theta?: number;
  collisionMode?: CollisionMode;
  /**
   * Sub-divide an outer step when a close encounter needs it.
   *
   * On by default, because at the shipped timesteps a fixed step reaches a
   * relative energy error above 1 — a failure, not a drift — the first time
   * two bodies pass close (artifacts/12-adaptive-integrator-decision.md).
   */
  adaptive?: boolean;
  /** Accuracy parameter for the sub-stepping criterion. Smaller is finer. */
  eta?: number;
}

export interface Diagnostics extends Conservation {
  energyDrift: number;
  angularMomentumDrift: number;
}

export class Simulation {
  state: SimState;
  private integratorImpl: Integrator;
  private force: ForceOptions;
  private requestedForceMode: ForceMode | "auto";

  /** Simulation timestep, in days. */
  dt: number;
  /** Simulated days elapsed. */
  simTime = 0;
  /** Total fixed steps taken. The authoritative clock for replay. */
  stepCount = 0;
  collisionMode: CollisionMode;
  /** Sub-divide an outer step when a close encounter needs it. */
  adaptive: boolean;
  /** Accuracy parameter for the sub-stepping criterion. */
  eta: number;
  /**
   * Substeps used by the most recent outer step. 1 means the fixed step was
   * already fine enough. Surfaced in the HUD so the cost of an encounter is
   * visible rather than felt only as a frame-rate drop.
   */
  lastSubsteps = 1;
  /** Highest substep count used since the last reset. */
  peakSubsteps = 1;
  /**
   * Closest any two bodies have come since the last reset, AU.
   *
   * Taken from the pairwise pass the sub-stepping criterion already makes, so
   * it costs nothing. Infinity until two bodies have been compared, which is
   * also the value for a single body.
   */
  closestApproach = Infinity;
  /** Shortest two-body period present, days, or null if nothing is bound. */
  shortestPeriodDays: number | null = null;

  private accumulator = 0;
  private referenceEnergy = 0;
  private referenceAngularMomentum = 0;
  /**
   * How many times the conservation baseline has been reset by a merge. Shown
   * in the HUD so a small drift figure after a collision is not mistaken for
   * an integration that has been accurate the whole way through.
   */
  baselineResets = 0;

  constructor(config: SimulationConfig) {
    this.state = SimState.fromBodies(config.bodies);
    this.dt = config.dt ?? 0.01;
    this.collisionMode = config.collisionMode ?? "merge";
    this.adaptive = config.adaptive ?? true;
    this.eta = config.eta ?? DEFAULT_ETA;
    this.requestedForceMode = config.forceMode ?? "auto";
    this.force = {
      g: config.g ?? G_AU3_PER_MSUN_DAY2,
      softening: config.softening ?? 0,
      mode: this.resolveForceMode(),
      theta: config.theta ?? 0.5,
    };
    this.integratorImpl = createIntegrator(config.integrator ?? "verlet");

    // Prime the acceleration field and capture the conservation baseline.
    computeAccelerations(this.state, this.force);
    this.captureReference();
  }

  private resolveForceMode(): ForceMode {
    if (this.requestedForceMode !== "auto") return this.requestedForceMode;
    return this.state.count > AUTO_BARNES_HUT_THRESHOLD ? "barnes-hut" : "direct";
  }

  private captureReference(): void {
    const c = computeConservation(this.state, this.force.g, this.force.softening);
    this.referenceEnergy = c.totalEnergy;
    this.referenceAngularMomentum = c.angularMomentum;
    this.shortestPeriodDays = this.measureShortestPeriod();
  }

  /**
   * Shortest two-body period currently in the system, days, or null if
   * nothing is on a bound orbit.
   *
   * Computed at the same moments as the conservation baseline — on load, on
   * rebaseline, and after a merge — rather than every step or every frame,
   * because it is O(n^2) and at 5,000 bodies that is 25 million operations
   * that would buy nothing: the shortest period does not change materially
   * except when the body set does, and that is exactly when this reruns.
   */
  private measureShortestPeriod(): number | null {
    const { positions, velocities, masses, count } = this.state;
    if (count < 2) return null;
    let shortest = Infinity;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const heavier = masses[i] >= masses[j] ? i : j;
        const lighter = heavier === i ? j : i;
        const h3 = heavier * 3;
        const l3 = lighter * 3;
        const r = Math.hypot(
          positions[l3] - positions[h3],
          positions[l3 + 1] - positions[h3 + 1],
          positions[l3 + 2] - positions[h3 + 2],
        );
        if (r === 0) continue;
        const v2 =
          (velocities[l3] - velocities[h3]) ** 2 +
          (velocities[l3 + 1] - velocities[h3 + 1]) ** 2 +
          (velocities[l3 + 2] - velocities[h3 + 2]) ** 2;
        const mu = this.force.g * (masses[heavier] + masses[lighter]);
        if (mu <= 0) continue;
        const energy = v2 / 2 - mu / r;
        if (energy >= 0) continue; // unbound: no period
        const a = -mu / (2 * energy);
        const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
        if (Number.isFinite(period) && period > 0 && period < shortest) {
          shortest = period;
        }
      }
    }
    return Number.isFinite(shortest) ? shortest : null;
  }

  get integratorName(): IntegratorName {
    return this.integratorImpl.name;
  }

  get forceMode(): ForceMode {
    return this.force.mode;
  }

  get bodyCount(): number {
    return this.state.count;
  }

  /** Plummer softening length, AU. */
  get softening(): number {
    return this.force.softening;
  }

  /** Barnes-Hut opening angle. Only meaningful when forceMode is barnes-hut. */
  get theta(): number {
    // ForceOptions.theta is optional; the engine always supplies one in its
    // constructor, so this default is a type formality rather than a fallback.
    return this.force.theta ?? 0.5;
  }

  setIntegrator(name: IntegratorName): void {
    if (name === this.integratorImpl.name) return;
    this.integratorImpl = createIntegrator(name);
    computeAccelerations(this.state, this.force);
  }

  setTimestep(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new RangeError(
        `Timestep must be a positive finite number, received ${dt}.`,
      );
    }
    this.dt = dt;
    // A partial accumulation measured against the old dt is meaningless.
    this.accumulator = 0;
  }

  setForceMode(mode: ForceMode | "auto"): void {
    this.requestedForceMode = mode;
    this.force.mode = this.resolveForceMode();
    computeAccelerations(this.state, this.force);
  }

  setSoftening(softening: number): void {
    this.force.softening = Math.max(0, softening);
    computeAccelerations(this.state, this.force);
    this.captureReference();
  }

  /**
   * Take exactly `n` fixed steps. Deterministic and independent of wall-clock
   * time — this is what tests and deterministic replay use.
   */
  stepFixed(n = 1): CollisionEvent[] {
    const events: CollisionEvent[] = [];
    for (let i = 0; i < n; i++) {
      /*
       * The outer step is always exactly `this.dt`, so simulated time stays
       * refresh-rate independent and replay stays deterministic. What changes
       * is how finely it is cut up, and only while an encounter needs it.
       */
      const decision = this.adaptive
        ? chooseSubsteps(this.state, this.dt, this.eta)
        : null;
      const substeps = decision?.substeps ?? 1;
      if (decision !== null && decision.minSeparation < this.closestApproach) {
        this.closestApproach = decision.minSeparation;
      }
      this.lastSubsteps = substeps;
      if (substeps > this.peakSubsteps) this.peakSubsteps = substeps;

      if (substeps === 1) {
        this.integratorImpl.step(this.state, this.dt, this.force);
      } else {
        const h = this.dt / substeps;
        for (let k = 0; k < substeps; k++) {
          this.integratorImpl.step(this.state, h, this.force);
        }
      }
      this.simTime += this.dt;
      this.stepCount++;

      if (this.collisionMode !== "pass-through") {
        const merged = resolveCollisions(this.state, this.collisionMode);
        if (merged.length > 0) {
          events.push(...merged);
          // Body count changed: the integrator's cached state and the force
          // mode choice are both stale.
          this.integratorImpl.reset();
          this.force.mode = this.resolveForceMode();
          computeAccelerations(this.state, this.force);

          // A merge is perfectly inelastic, so it LEGITIMATELY changes total
          // energy. Measuring drift against a pre-merge reference would report
          // a physical event as numerical failure — a baseline run of the
          // three-body scenario showed 100% "drift" that was entirely a merge.
          // Re-baseline, and record that we did, so the HUD can say why.
          this.captureReference();
          this.baselineResets++;
        }
      }
    }
    return events;
  }

  /**
   * Advance by a span of real time.
   *
   * @param realSeconds wall-clock seconds since the previous advance
   * @param simDaysPerRealSecond playback speed
   * @returns the steps actually taken
   */
  advance(
    realSeconds: number,
    simDaysPerRealSecond: number,
  ): {
    steps: number;
    events: CollisionEvent[];
  } {
    if (!Number.isFinite(realSeconds) || realSeconds <= 0) {
      return { steps: 0, events: [] };
    }

    const clamped = Math.min(realSeconds, MAX_FRAME_SECONDS);
    this.accumulator += clamped * simDaysPerRealSecond;

    // Compute the whole number of steps owed in ONE division and settle the
    // accumulator with ONE subtraction. Repeatedly subtracting dt inside the
    // loop would accumulate rounding error on every step, and over a long
    // session that residual becomes a systematic drift in playback rate.
    let steps = Math.floor(this.accumulator / this.dt);
    if (steps <= 0) return { steps: 0, events: [] };

    let budgetExhausted = false;
    if (steps > MAX_STEPS_PER_ADVANCE) {
      steps = MAX_STEPS_PER_ADVANCE;
      budgetExhausted = true;
    }

    const events = this.stepFixed(steps);

    // If the budget was exhausted, drop the backlog rather than carry it into
    // the next frame and fall further behind every frame.
    this.accumulator = budgetExhausted ? 0 : this.accumulator - steps * this.dt;

    return { steps, events };
  }

  diagnostics(): Diagnostics {
    const c = computeConservation(this.state, this.force.g, this.force.softening);
    return {
      ...c,
      energyDrift: relativeDrift(c.totalEnergy, this.referenceEnergy),
      angularMomentumDrift: relativeDrift(
        c.angularMomentum,
        this.referenceAngularMomentum,
      ),
    };
  }

  /**
   * Reset the conservation baseline to the current state.
   *
   * The substep peak is cleared with it: both answer "how has it gone since
   * the last time we started counting", and leaving a stale peak behind would
   * report an encounter that is no longer part of the measurement.
   */
  rebaseline(): void {
    this.captureReference();
    this.peakSubsteps = 1;
    this.closestApproach = Infinity;
  }
}
