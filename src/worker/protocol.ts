/**
 * Worker message protocol.
 *
 * The simulation runs in a worker and the main thread renders snapshots. Two
 * consequences drive the shape of this protocol:
 *
 *   1. Position data crosses the boundary as a TRANSFERABLE ArrayBuffer, so
 *      there is no structured-clone copy per frame.
 *   2. Buffers are RECYCLED. The renderer returns each buffer after drawing,
 *      so steady-state allocation is zero rather than one array per frame.
 *
 * The audited implementation instead deep-cloned the whole application state
 * every frame and dispatched all body state back into a store
 * (artifacts/03-current-site-audit.md §5.1).
 */
import type { Scenario } from "../schema/scenario";
import type { IntegratorName } from "../sim/integrators";
import type { CollisionMode } from "../sim/collisions";
import type { ScenarioEdit } from "../sim/edits";
import type { BodyInit } from "../sim/state";
import type { ForceMode } from "../sim/forces";

export type MainToWorker =
  | { type: "load"; scenario: Scenario }
  | { type: "play" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "step"; steps: number }
  | { type: "setSpeed"; simDaysPerRealSecond: number }
  | { type: "setIntegrator"; integrator: IntegratorName }
  | { type: "setTimestep"; dt: number }
  | { type: "setForceMode"; mode: ForceMode | "auto" }
  | { type: "setSoftening"; softening: number }
  | { type: "setCollisionMode"; mode: CollisionMode }
  /** Apply an edit to the live simulation. The worker replies with its inverse. */
  | { type: "applyEdit"; edit: ScenarioEdit; requestId: number }
  /**
   * Ask for one body's full state.
   *
   * Velocities are deliberately NOT in the per-frame snapshot: carrying them
   * would double the transfer every frame for a value only the editor reads,
   * and at 5,000 bodies that is 30 kB a frame of pure waste. Editing is rare,
   * so it asks.
   */
  | { type: "requestBodyDetail"; id: string; requestId: number }
  | { type: "requestSnapshot" }
  /** Hand a used buffer back so the worker can reuse it. */
  | { type: "recycle"; buffer: ArrayBuffer }
  | { type: "dispose" };

export interface BodyMeta {
  id: string;
  name: string;
  radius: number;
  mass: number;
  colour: string;
  massless: boolean;
}

export interface SnapshotMessage {
  type: "snapshot";
  /** Interleaved xyz positions for `bodyCount` bodies. Transferred. */
  positions: ArrayBuffer;
  bodyCount: number;
  /** Incremented whenever the body set changes, so the renderer knows to rebuild. */
  topologyVersion: number;
  playing: boolean;
  simTimeDays: number;
  stepCount: number;
  stepsSinceLastSnapshot: number;
  /** Milliseconds of worker time spent stepping since the last snapshot. */
  workerStepMs: number;
  energy: number;
  energyDrift: number;
  angularMomentum: number;
  angularMomentumDrift: number;
  /** Times the drift baseline was reset by a merge. */
  baselineResets: number;
  /** Edits applied to this run, so an edited run can say that it is one. */
  editCount: number;
  /**
   * Substeps used by the most recent outer step, and the most any step has
   * needed since the last reset. 1 means the fixed step was already fine.
   */
  lastSubsteps: number;
  peakSubsteps: number;
  /** Closest any two bodies have come since the last reset, AU. */
  closestApproachAu: number | null;
  /** Shortest two-body period present, days, or null if nothing is bound. */
  shortestPeriodDays: number | null;
  /** Plummer softening length, AU. */
  softening: number;
  /** Barnes-Hut opening angle, or null when the force method is direct. */
  theta: number | null;
  kineticEnergy: number;
  potentialEnergy: number;
  integrator: IntegratorName;
  forceMode: ForceMode;
  dt: number;
}

export type WorkerToMain =
  | SnapshotMessage
  | { type: "ready" }
  | {
      type: "loaded";
      scenarioId: string;
      bodies: BodyMeta[];
      topologyVersion: number;
    }
  | { type: "collision"; absorbed: string[]; survivor: string; mass: number }
  /**
   * The result of an `applyEdit`. `inverse` is the edit that undoes it, and
   * `applied` is the request in resolved form — an `addOrbiting` comes back
   * as a plain `add` with the position and velocity the worker computed, so
   * redo reproduces that orbit instead of sizing a new one against a parent
   * that has since moved. `editRejected` explains why nothing was changed;
   * an edit is validated before any write, so a rejected one leaves the
   * simulation untouched.
   */
  | {
      type: "editApplied";
      requestId: number;
      bodies: BodyMeta[];
      topologyVersion: number;
      inverse: ScenarioEdit;
      applied: ScenarioEdit;
    }
  | { type: "editRejected"; requestId: number; message: string }
  | { type: "bodyDetail"; requestId: number; body: BodyInit | null }
  | { type: "error"; message: string; detail?: string };
