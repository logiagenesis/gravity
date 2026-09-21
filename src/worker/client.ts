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
