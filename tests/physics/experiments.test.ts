/**
 * Guided experiments.
 *
 * These are prose plus a body id, and a body id is exactly the kind of thing
 * that rots silently: rename `l4-greeks` and the "Remove Jupiter" button
 * quietly stops doing anything, with no type error and no failing test
 * anywhere else. So every experiment is applied to its real scenario here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EXPERIMENTS, experimentsFor } from "../../src/experiments/catalogue";
import { migrateAndParse } from "../../src/schema/migrations";
import { SimState } from "../../src/sim/state";
import { applyEdit } from "../../src/sim/edits";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";

const ROOT = join(import.meta.dirname, "../..");

function loadScenario(id: string) {
  const path = join(ROOT, "data/scenarios", `${id}.json`);
  if (!existsSync(path)) return null;
  return migrateAndParse(JSON.parse(readFileSync(path, "utf8")));
}

/** Everything that defines the state, for exact comparison. */
const snapshot = (state: SimState) => ({
  count: state.count,
  positions: [...state.positions.slice(0, state.count * 3)],
  velocities: [...state.velocities.slice(0, state.count * 3)],
  masses: [...state.masses.slice(0, state.count)],
  radii: [...state.radii.slice(0, state.count)],
  flags: [...state.flags.slice(0, state.count)],
  ids: state.ids.slice(0, state.count),
  names: state.names.slice(0, state.count),
  colours: state.colours.slice(0, state.count),
});

describe("the experiment catalogue", () => {
  it("offers at least the six the brief asks for", () => {
    expect(EXPERIMENTS.length).toBeGreaterThanOrEqual(6);
  });

  it("has unique ids", () => {
    const ids = EXPERIMENTS.map((experiment) => experiment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers more than one scenario, so it is not a single gimmick", () => {
    const scenarios = new Set(EXPERIMENTS.map((e) => e.scenarioId));
    expect(scenarios.size).toBeGreaterThanOrEqual(3);
  });

  it("finds them by scenario", () => {
    const found = experimentsFor("earth-and-moon");
    expect(found.length).toBeGreaterThan(0);
    for (const experiment of found) {
      expect(experiment.scenarioId).toBe("earth-and-moon");
    }
    expect(experimentsFor("no-such-scenario")).toEqual([]);
  });
});

describe.each(EXPERIMENTS)("$id", (experiment) => {
  const scenario = loadScenario(experiment.scenarioId);

  it("names a scenario that exists", () => {
    expect(scenario, `no data/scenarios/${experiment.scenarioId}.json`).not.toBeNull();
  });

  it("applies cleanly to that scenario, and changes it", () => {
    if (scenario === null) throw new Error("scenario missing");
    const state = SimState.fromBodies(scenario.bodies);
    const before = snapshot(state);
    for (const edit of experiment.edits) {
      applyEdit(state, edit, scenario.physics.g ?? G_AU3_PER_MSUN_DAY2);
    }
    // An experiment that changes nothing is a broken button, not an experiment.
    expect(snapshot(state)).not.toEqual(before);
  });

  it("undoes exactly, so the learner can get back to the published system", () => {
    if (scenario === null) throw new Error("scenario missing");
    const state = SimState.fromBodies(scenario.bodies);
    const before = snapshot(state);
    const g = scenario.physics.g ?? G_AU3_PER_MSUN_DAY2;
    const inverses = experiment.edits.map((edit) => applyEdit(state, edit, g).inverse);
    for (const inverse of inverses.reverse()) applyEdit(state, inverse, g);
    expect(snapshot(state)).toEqual(before);
  });

  it("says what it is for, what to watch, and why", () => {
    // Prose is the product here; an experiment without its explanation is a
    // button that changes numbers for no stated reason.
    expect(experiment.title.length).toBeGreaterThan(3);
    expect(experiment.question.length).toBeGreaterThan(40);
    expect(experiment.watchFor.length).toBeGreaterThan(20);
    expect(experiment.explanation.length).toBeGreaterThan(120);
  });
});
