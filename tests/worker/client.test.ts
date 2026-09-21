/**
 * Worker protocol tests.
 *
 * The real worker is exercised end-to-end by the Playwright suite (play,
 * pause, step, reset, integrator switching and collisions all cross the worker
 * boundary). These tests cover the protocol itself in isolation: that every
 * command is serialised correctly, that every inbound message reaches the right
 * handler, that snapshot buffers are TRANSFERRED rather than copied, and that
 * a disposed client goes quiet.
 *
 * A fake Worker is used so this runs in Node without a DOM.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  MainToWorker,
  SnapshotMessage,
  WorkerToMain,
} from "../../src/worker/protocol";

interface Posted {
  message: MainToWorker;
  transfer: Transferable[];
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: Posted[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(
    public url: URL | string,
    public options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: MainToWorker, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate the worker sending a message to the main thread. */
  emit(data: WorkerToMain): void {
    for (const handler of this.listeners.get("message") ?? []) handler({ data });
  }

  emitError(message: string): void {
    for (const handler of this.listeners.get("error") ?? []) handler({ message });
  }

  get lastMessage(): MainToWorker | undefined {
    return this.posted.at(-1)?.message;
  }
}

// Stand in for the browser Worker before the client module is imported.
vi.stubGlobal("Worker", FakeWorker);

const { SimulationClient } = await import("../../src/worker/client");

function snapshot(overrides: Partial<SnapshotMessage> = {}): SnapshotMessage {
  return {
    type: "snapshot",
    positions: new ArrayBuffer(24),
    bodyCount: 2,
    topologyVersion: 1,
    playing: true,
    simTimeDays: 1.5,
    stepCount: 150,
    stepsSinceLastSnapshot: 10,
    workerStepMs: 0.4,
    energy: -1,
    energyDrift: 1e-9,
    angularMomentum: 2,
    angularMomentumDrift: 1e-12,
    baselineResets: 0,
    lastSubsteps: 1,
    peakSubsteps: 1,
    kineticEnergy: 1,
    potentialEnergy: -2,
    integrator: "verlet",
    forceMode: "direct",
    dt: 0.01,
    ...overrides,
  };
}

beforeEach(() => {
  FakeWorker.instances = [];
});

describe("worker construction", () => {
  it("starts a module worker", () => {
    new SimulationClient();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    expect(worker.options?.type).toBe("module");
  });
});

describe("outbound commands", () => {
  const cases: Array<
    [string, (c: InstanceType<typeof SimulationClient>) => void, MainToWorker]
  > = [
    ["play", (c) => c.play(), { type: "play" }],
    ["pause", (c) => c.pause(), { type: "pause" }],
    ["reset", (c) => c.reset(), { type: "reset" }],
    ["step", (c) => c.step(5), { type: "step", steps: 5 }],
    [
      "setSpeed",
      (c) => c.setSpeed(100),
      { type: "setSpeed", simDaysPerRealSecond: 100 },
    ],
    [
      "setIntegrator",
      (c) => c.setIntegrator("pefrl"),
      { type: "setIntegrator", integrator: "pefrl" },
    ],
    ["setTimestep", (c) => c.setTimestep(0.25), { type: "setTimestep", dt: 0.25 }],
    [
      "setForceMode",
      (c) => c.setForceMode("barnes-hut"),
      { type: "setForceMode", mode: "barnes-hut" },
    ],
    [
      "setCollisionMode",
      (c) => c.setCollisionMode("elastic"),
      { type: "setCollisionMode", mode: "elastic" },
    ],
  ];

  for (const [label, act, expected] of cases) {
    it(`sends ${label} exactly as declared`, () => {
      const client = new SimulationClient();
      act(client);
      expect(FakeWorker.instances[0].lastMessage).toEqual(expected);
    });
  }

  it("defaults step to a single step", () => {
    const client = new SimulationClient();
    client.step();
    expect(FakeWorker.instances[0].lastMessage).toEqual({ type: "step", steps: 1 });
  });
});

describe("inbound messages", () => {
  it("routes each message type to its handler", () => {
    const onSnapshot = vi.fn();
    const onLoaded = vi.fn();
    const onCollision = vi.fn();
    const onError = vi.fn();
    const onReady = vi.fn();

    new SimulationClient({ onSnapshot, onLoaded, onCollision, onError, onReady });
    const worker = FakeWorker.instances[0];

    worker.emit({ type: "ready" });
    expect(onReady).toHaveBeenCalledOnce();

    const snap = snapshot();
    worker.emit(snap);
    expect(onSnapshot).toHaveBeenCalledWith(snap);

    worker.emit({ type: "loaded", scenarioId: "x", bodies: [], topologyVersion: 3 });
    expect(onLoaded).toHaveBeenCalledWith("x", [], 3);

    worker.emit({ type: "collision", absorbed: ["B"], survivor: "A", mass: 3 });
    expect(onCollision).toHaveBeenCalledWith(["B"], "A");

    worker.emit({ type: "error", message: "boom", detail: "why" });
    expect(onError).toHaveBeenCalledWith("boom", "why");
  });

  it("surfaces a worker that fails to start", () => {
    const onError = vi.fn();
    new SimulationClient({ onError });
    FakeWorker.instances[0].emitError("module not found");
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("failed to start"),
      "module not found",
    );
  });

  it("tolerates a client constructed with no handlers", () => {
    new SimulationClient();
    expect(() => FakeWorker.instances[0].emit(snapshot())).not.toThrow();
  });
});

describe("buffer recycling", () => {
  it("transfers the buffer back rather than copying it", () => {
    const client = new SimulationClient();
    const buffer = new ArrayBuffer(24);
    client.recycle(buffer);

    const posted = FakeWorker.instances[0].posted.at(-1)!;
    expect(posted.message).toEqual({ type: "recycle", buffer });
    // Zero-copy: the buffer must be in the transfer list.
    expect(posted.transfer).toContain(buffer);
  });

  it("ignores an already-detached buffer", () => {
    const client = new SimulationClient();
    // A transferred buffer has byteLength 0; posting it again would throw.
    client.recycle(new ArrayBuffer(0));
    expect(FakeWorker.instances[0].posted).toHaveLength(0);
  });
});

describe("disposal", () => {
  it("terminates the worker and stops sending", () => {
    const client = new SimulationClient();
    const worker = FakeWorker.instances[0];

    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(worker.lastMessage).toEqual({ type: "dispose" });

    const countAfterDispose = worker.posted.length;
    client.play();
    client.setSpeed(10);
    // A disposed client must go quiet, not throw and not post.
    expect(worker.posted).toHaveLength(countAfterDispose);
  });

  it("is safe to dispose twice", () => {
    const client = new SimulationClient();
    client.dispose();
    expect(() => client.dispose()).not.toThrow();
  });
});
