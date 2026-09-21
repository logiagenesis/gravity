/// <reference lib="webworker" />
/**
 * Simulation worker.
 *
 * Owns the Simulation and drives it from wall-clock time. Nothing here touches
 * the DOM, and the simulation core it uses has no dependencies, so this file is
 * a thin transport shell around already-tested code.
 */
import { Simulation } from "../sim/engine";
import { migrateAndParse } from "../schema/migrations";
import type { BodyMeta, MainToWorker, SnapshotMessage, WorkerToMain } from "./protocol";
import type { Scenario } from "../schema/scenario";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let simulation: Simulation | null = null;
let scenario: Scenario | null = null;
let playing = false;
let speed = 1;
let topologyVersion = 0;

let lastTickMs = 0;
let stepsSinceSnapshot = 0;
let workerStepMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Buffer pool. The renderer returns buffers via "recycle"; we reuse them rather
 * than allocating one per frame. Capped so a slow consumer cannot grow it
 * without bound.
 */
const bufferPool: ArrayBuffer[] = [];
const MAX_POOLED_BUFFERS = 4;

/** How often the worker steps and emits a snapshot. */
const TICK_MS = 16;

function post(message: WorkerToMain, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function fail(message: string, error?: unknown): void {
  post({
    type: "error",
    message,
    detail: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
}

function takeBuffer(byteLength: number): ArrayBuffer {
  const index = bufferPool.findIndex((b) => b.byteLength === byteLength);
  if (index !== -1) return bufferPool.splice(index, 1)[0];
  return new ArrayBuffer(byteLength);
}

function bodyMeta(sim: Simulation): BodyMeta[] {
  const out: BodyMeta[] = [];
  for (let i = 0; i < sim.state.count; i++) {
    out.push({
      id: sim.state.ids[i],
      name: sim.state.names[i],
      radius: sim.state.radii[i],
      mass: sim.state.masses[i],
      colour: sim.state.colours[i],
      massless: sim.state.isMassless(i),
    });
  }
  return out;
}

function sendSnapshot(): void {
  if (simulation === null) return;

  const count = simulation.state.count;
  // Float32 is ample for rendering positions and halves the transfer size.
  const byteLength = count * 3 * Float32Array.BYTES_PER_ELEMENT;
  const buffer = takeBuffer(byteLength);
  const view = new Float32Array(buffer);
  const source = simulation.state.positions;
  for (let i = 0; i < count * 3; i++) view[i] = source[i];

  const d = simulation.diagnostics();

  const message: SnapshotMessage = {
    type: "snapshot",
    positions: buffer,
    bodyCount: count,
    topologyVersion,
    playing,
    simTimeDays: simulation.simTime,
    stepCount: simulation.stepCount,
    stepsSinceLastSnapshot: stepsSinceSnapshot,
    workerStepMs,
    energy: d.totalEnergy,
    energyDrift: d.energyDrift,
    angularMomentum: d.angularMomentum,
    angularMomentumDrift: d.angularMomentumDrift,
    baselineResets: simulation.baselineResets,
    editCount: simulation.editCount,
    lastSubsteps: simulation.lastSubsteps,
    peakSubsteps: simulation.peakSubsteps,
    closestApproachAu: Number.isFinite(simulation.closestApproach)
      ? simulation.closestApproach
      : null,
    shortestPeriodDays: simulation.shortestPeriodDays,
    softening: simulation.softening,
    theta: simulation.forceMode === "barnes-hut" ? simulation.theta : null,
    kineticEnergy: d.kineticEnergy,
    potentialEnergy: d.potentialEnergy,
    integrator: simulation.integratorName,
    forceMode: simulation.forceMode,
    dt: simulation.dt,
  };

  stepsSinceSnapshot = 0;
  workerStepMs = 0;
  post(message, [buffer]);
}

function tick(): void {
  if (simulation === null) return;

  const now = performance.now();
  const elapsedSeconds = lastTickMs === 0 ? 0 : (now - lastTickMs) / 1000;
  lastTickMs = now;

  if (playing && elapsedSeconds > 0) {
    const started = performance.now();
    try {
      const { steps, events } = simulation.advance(elapsedSeconds, speed);
      stepsSinceSnapshot += steps;
      for (const event of events) {
        topologyVersion++;
        post({
          type: "collision",
          absorbed: event.absorbed,
          survivor: event.survivor,
          mass: event.mass,
        });
      }
      if (events.length > 0 && simulation !== null) {
        post({
          type: "loaded",
          scenarioId: scenario?.id ?? "",
          bodies: bodyMeta(simulation),
          topologyVersion,
        });
      }
    } catch (error) {
      playing = false;
      fail("The simulation stopped because a step failed.", error);
    }
    workerStepMs += performance.now() - started;
  }

  sendSnapshot();
}

function startTimer(): void {
  if (timer !== null) return;
  lastTickMs = 0;
  timer = setInterval(tick, TICK_MS);
}

function loadScenario(input: Scenario): void {
  // Re-validate inside the worker. The main thread validates too, but the
  // worker must not trust a message it is handed: defence in depth costs
  // nothing here and means a bug on the main thread cannot corrupt the core.
  const validated = migrateAndParse(input);
  scenario = validated;

  simulation = new Simulation({
    bodies: validated.bodies,
    g: validated.physics.g,
    softening: validated.physics.softening,
    integrator: validated.physics.integrator,
    dt: validated.physics.dt,
    forceMode: validated.physics.forceMode,
    theta: validated.physics.theta,
    collisionMode: validated.physics.collisionMode,
  });

  topologyVersion++;
  playing = false;
  speed = 1;
  stepsSinceSnapshot = 0;
  workerStepMs = 0;
  lastTickMs = 0;

  post({
    type: "loaded",
    scenarioId: validated.id,
    bodies: bodyMeta(simulation),
    topologyVersion,
  });
  sendSnapshot();
  startTimer();
}

scope.addEventListener("message", (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "load":
        loadScenario(message.scenario);
        break;

      case "play":
        if (simulation !== null) {
          playing = true;
          lastTickMs = 0; // do not count paused time as elapsed
        }
        break;

      case "pause":
        playing = false;
        break;

      case "reset":
        if (scenario !== null) loadScenario(scenario);
        break;

      case "step":
        if (simulation !== null) {
          playing = false;
          simulation.stepFixed(Math.max(1, Math.floor(message.steps)));
          stepsSinceSnapshot += Math.max(1, Math.floor(message.steps));
          sendSnapshot();
        }
        break;

      case "setSpeed":
        speed = Math.max(0, message.simDaysPerRealSecond);
        break;

      case "setIntegrator":
        simulation?.setIntegrator(message.integrator);
        break;

      case "setTimestep":
        simulation?.setTimestep(message.dt);
        break;

      case "setForceMode":
        simulation?.setForceMode(message.mode);
        break;

      case "setSoftening":
        simulation?.setSoftening(message.softening);
        break;

      case "setCollisionMode":
        if (simulation !== null) simulation.collisionMode = message.mode;
        break;

      case "applyEdit": {
        if (simulation === null) break;
        try {
          const { inverse, applied } = simulation.applyEdit(message.edit);
          // The body set may have changed, so the renderer needs new metadata
          // and a new topology version before the next snapshot arrives.
          topologyVersion++;
          post({
            type: "editApplied",
            requestId: message.requestId,
            bodies: bodyMeta(simulation),
            topologyVersion,
            inverse,
            applied,
          });
          sendSnapshot();
        } catch (error) {
          post({
            type: "editRejected",
            requestId: message.requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case "requestBodyDetail": {
        let body = null;
        if (simulation !== null) {
          const state = simulation.state;
          for (let i = 0; i < state.count; i++) {
            if (state.ids[i] !== message.id) continue;
            const k = i * 3;
            body = {
              id: state.ids[i],
              name: state.names[i],
              mass: state.masses[i],
              radius: state.radii[i],
              position: {
                x: state.positions[k],
                y: state.positions[k + 1],
                z: state.positions[k + 2],
              },
              velocity: {
                x: state.velocities[k],
                y: state.velocities[k + 1],
                z: state.velocities[k + 2],
              },
              massless: state.isMassless(i),
              colour: state.colours[i],
            };
            break;
          }
        }
        post({ type: "bodyDetail", requestId: message.requestId, body });
        break;
      }

      case "requestSnapshot":
        sendSnapshot();
        break;

      case "recycle":
        if (bufferPool.length < MAX_POOLED_BUFFERS) bufferPool.push(message.buffer);
        break;

      case "dispose":
        if (timer !== null) clearInterval(timer);
        timer = null;
        simulation = null;
        scenario = null;
        break;
    }
  } catch (error) {
    fail(`Could not handle "${message.type}".`, error);
  }
});

post({ type: "ready" });
