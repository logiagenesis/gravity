/**
 * Main-thread client for the simulation worker.
 *
 * Deliberately NOT a React hook holding per-frame state. Snapshots are pushed
 * to subscribers (the renderer, and a throttled HUD) rather than set into React
 * state, because setting sixty state updates per second is exactly the
 * anti-pattern that made the audited implementation slow
 * (artifacts/03-current-site-audit.md §5.1).
 */
import type { CollisionMode } from "../sim/collisions";
import type { EditResult, ScenarioEdit } from "../sim/edits";
import type { BodyInit } from "../sim/state";
import type { BodyMeta, MainToWorker, SnapshotMessage, WorkerToMain } from "./protocol";
import type { Scenario } from "../schema/scenario";

export interface SimulationClientEvents {
  onSnapshot?: (snapshot: SnapshotMessage) => void;
  onLoaded?: (scenarioId: string, bodies: BodyMeta[], topologyVersion: number) => void;
  onCollision?: (absorbed: string[], survivor: string) => void;
  onError?: (message: string, detail?: string) => void;
  onReady?: () => void;
}

export class SimulationClient {
  private worker: Worker;
  private events: SimulationClientEvents;
  private disposed = false;
  /** Correlates an applyEdit call with the worker's reply. */
  private editRequestId = 0;
  private pendingDetails = new Map<number, (body: BodyInit | null) => void>();
  private pendingEdits = new Map<
    number,
    { resolve: (result: EditResult) => void; reject: (error: Error) => void }
  >();

  constructor(events: SimulationClientEvents = {}) {
    this.events = events;
    this.worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
      type: "module",
      name: "gravity-simulation",
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", (event) => {
      this.events.onError?.("The simulation worker failed to start.", event.message);
    });
  }

  private handleMessage = (event: MessageEvent<WorkerToMain>): void => {
    const message = event.data;
    switch (message.type) {
      case "ready":
        this.events.onReady?.();
        break;
      case "snapshot":
        this.events.onSnapshot?.(message);
        break;
      case "loaded":
        this.events.onLoaded?.(
          message.scenarioId,
          message.bodies,
          message.topologyVersion,
        );
        break;
      case "collision":
        this.events.onCollision?.(message.absorbed, message.survivor);
        break;
      case "editApplied": {
        // The body set may have changed, so the renderer is told before the
        // promise resolves and the caller redraws anything.
        this.events.onLoaded?.("", message.bodies, message.topologyVersion);
        this.pendingEdits
          .get(message.requestId)
          ?.resolve({ inverse: message.inverse, applied: message.applied });
        this.pendingEdits.delete(message.requestId);
        break;
      }
      case "bodyDetail":
        this.pendingDetails.get(message.requestId)?.(message.body);
        this.pendingDetails.delete(message.requestId);
        break;
      case "editRejected":
        this.pendingEdits.get(message.requestId)?.reject(new Error(message.message));
        this.pendingEdits.delete(message.requestId);
        break;
      case "error":
        this.events.onError?.(message.message, message.detail);
        break;
    }
  };

  private send(message: MainToWorker, transfer: Transferable[] = []): void {
    if (this.disposed) return;
    this.worker.postMessage(message, transfer);
  }

  load(scenario: Scenario): void {
    this.send({ type: "load", scenario });
  }
  play(): void {
    this.send({ type: "play" });
  }
  pause(): void {
    this.send({ type: "pause" });
  }
  reset(): void {
    this.send({ type: "reset" });
  }
  step(steps = 1): void {
    this.send({ type: "step", steps });
  }
  setSpeed(simDaysPerRealSecond: number): void {
    this.send({ type: "setSpeed", simDaysPerRealSecond });
  }
  setIntegrator(integrator: SnapshotMessage["integrator"]): void {
    this.send({ type: "setIntegrator", integrator });
  }
  setTimestep(dt: number): void {
    this.send({ type: "setTimestep", dt });
  }
  setForceMode(mode: SnapshotMessage["forceMode"] | "auto"): void {
    this.send({ type: "setForceMode", mode });
  }
  /**
   * Apply an edit to the live simulation.
   *
   * Resolves with the edit that undoes it and the edit in resolved form, or
   * rejects with the reason it was refused. The worker validates before
   * writing anything, so a rejection means the simulation is exactly as it
   * was.
   */
  applyEdit(edit: ScenarioEdit): Promise<EditResult> {
    const requestId = ++this.editRequestId;
    return new Promise<EditResult>((resolve, reject) => {
      this.pendingEdits.set(requestId, { resolve, reject });
      this.send({ type: "applyEdit", edit, requestId });
    });
  }

  /** One body's full state, including its velocity. Null if it is gone. */
  requestBodyDetail(id: string): Promise<BodyInit | null> {
    const requestId = ++this.editRequestId;
    return new Promise<BodyInit | null>((resolve) => {
      this.pendingDetails.set(requestId, resolve);
      this.send({ type: "requestBodyDetail", id, requestId });
    });
  }

  setSoftening(softening: number): void {
    this.send({ type: "setSoftening", softening });
  }
  setCollisionMode(mode: CollisionMode): void {
    this.send({ type: "setCollisionMode", mode });
  }

  /** Return a snapshot buffer for reuse. Call once the renderer has read it. */
  recycle(buffer: ArrayBuffer): void {
    if (buffer.byteLength === 0) return; // already transferred away
    this.send({ type: "recycle", buffer }, [buffer]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.send({ type: "dispose" });
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.terminate();
  }
}
