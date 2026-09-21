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
import { resolveCollisions, type CollisionEvent } from "./collisions";
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

/** Body count above which Barnes-Hut is chosen in "auto" mode. */
export const AUTO_BARNES_HUT_THRESHOLD = 512;

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
  collisionsEnabled?: boolean;
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
  collisionsEnabled: boolean;

  private accumulator = 0;
  private referenceEnergy = 0;
  private referenceAngularMomentum = 0;

  constructor(config: SimulationConfig) {
    this.state = SimState.fromBodies(config.bodies);
    this.dt = config.dt ?? 0.01;
    this.collisionsEnabled = config.collisionsEnabled ?? true;
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
      this.integratorImpl.step(this.state, this.dt, this.force);
      this.simTime += this.dt;
      this.stepCount++;

      if (this.collisionsEnabled) {
        const merged = resolveCollisions(this.state);
        if (merged.length > 0) {
          events.push(...merged);
          // Body count changed: the integrator's cached state and the force
          // mode choice are both stale.
          this.integratorImpl.reset();
          this.force.mode = this.resolveForceMode();
          computeAccelerations(this.state, this.force);
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

  /** Reset the conservation baseline to the current state. */
  rebaseline(): void {
    this.captureReference();
  }
}
