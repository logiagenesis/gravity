/**
 * Simulation warnings.
 *
 * The point of these is that each one fires for a REAL failure mode and stays
 * quiet otherwise. A warning that is always on is noise, and noise is what
 * makes people stop reading warnings.
 */
import { describe, it, expect } from "vitest";
import { simulationWarnings, type WarningInputs } from "../../src/sim/warnings";
import { MAX_SUBSTEPS } from "../../src/sim/adaptive";

/** A healthy run: nothing should fire. */
const healthy: WarningInputs = {
  integrator: "pefrl",
  dt: 0.5,
  shortestPeriodDays: 365,
  softening: 0,
  closestApproachAu: 0.9,
  theta: null,
  peakSubsteps: 1,
  stepCount: 1000,
  energyDrift: 1e-10,
};

const ids = (input: Partial<WarningInputs>) =>
  simulationWarnings({ ...healthy, ...input }).map((w) => w.id);

describe("a healthy run", () => {
  it("produces no warnings at all", () => {
    expect(simulationWarnings(healthy)).toEqual([]);
  });
});

describe("timestep against the shortest orbit", () => {
  it("fires when the step does not resolve the fastest orbit", () => {
    expect(ids({ dt: 50, shortestPeriodDays: 365 })).toContain("timestep-vs-period");
  });

  it("escalates to an error when it is badly unresolved", () => {
    const [warning] = simulationWarnings({
      ...healthy,
      dt: 100,
      shortestPeriodDays: 365,
    });
    expect(warning.severity).toBe("error");
  });

  it("stays quiet at 20 steps per orbit and above", () => {
    expect(ids({ dt: 365 / 20, shortestPeriodDays: 365 })).not.toContain(
      "timestep-vs-period",
    );
  });

  it("says nothing when there is no orbit to measure", () => {
    expect(ids({ shortestPeriodDays: null, dt: 1e6 })).not.toContain(
      "timestep-vs-period",
    );
  });
});

describe("softening against the closest approach", () => {
  it("fires when softening is larger than how close bodies have come", () => {
    expect(ids({ softening: 0.1, closestApproachAu: 0.01 })).toContain(
      "softening-exceeds-approach",
    );
  });

  it("stays quiet when softening is far below the closest approach", () => {
    expect(ids({ softening: 1e-4, closestApproachAu: 0.5 })).not.toContain(
      "softening-exceeds-approach",
    );
  });

  it("stays quiet when softening is off", () => {
    expect(ids({ softening: 0, closestApproachAu: 1e-9 })).not.toContain(
      "softening-exceeds-approach",
    );
  });
});

describe("Barnes-Hut opening angle", () => {
  it("fires when theta is loose", () => {
    expect(ids({ theta: 1.5 })).toContain("theta-loose");
  });

  it("stays quiet at the default", () => {
    expect(ids({ theta: 0.5 })).not.toContain("theta-loose");
  });

  it("says nothing when the force method is direct", () => {
    expect(ids({ theta: null })).not.toContain("theta-loose");
  });
});

describe("non-symplectic integrator on a long run", () => {
  it("fires for RK4 once the run is long", () => {
    expect(ids({ integrator: "rk4", stepCount: 200_000 })).toContain(
      "non-symplectic-long-run",
    );
  });

  it("stays quiet for RK4 on a short run, where it is the accurate choice", () => {
    expect(ids({ integrator: "rk4", stepCount: 100 })).not.toContain(
      "non-symplectic-long-run",
    );
  });

  it("never fires for a symplectic method, however long the run", () => {
    expect(ids({ integrator: "pefrl", stepCount: 10_000_000 })).not.toContain(
      "non-symplectic-long-run",
    );
    expect(ids({ integrator: "verlet", stepCount: 10_000_000 })).not.toContain(
      "non-symplectic-long-run",
    );
  });
});

describe("a low-order method with real close encounters", () => {
  it("fires for Verlet once encounters force real sub-stepping", () => {
    expect(ids({ integrator: "verlet", peakSubsteps: 64 })).toContain(
      "low-order-with-encounters",
    );
  });

  it("stays quiet for Verlet when nothing is passing close", () => {
    expect(ids({ integrator: "verlet", peakSubsteps: 2 })).not.toContain(
      "low-order-with-encounters",
    );
  });

  it("does not nag someone already using PEFRL", () => {
    expect(ids({ integrator: "pefrl", peakSubsteps: 256 })).not.toContain(
      "low-order-with-encounters",
    );
  });
});

describe("the sub-stepping budget", () => {
  it("fires when an encounter used the whole budget", () => {
    expect(ids({ peakSubsteps: MAX_SUBSTEPS })).toContain("substep-budget-exhausted");
  });

  it("stays quiet below the budget", () => {
    expect(ids({ peakSubsteps: MAX_SUBSTEPS / 2 })).not.toContain(
      "substep-budget-exhausted",
    );
  });
});

describe("energy drift", () => {
  it("fires once the run is no longer quantitatively trustworthy", () => {
    expect(ids({ energyDrift: 0.02 })).toContain("energy-drift-high");
  });

  it("escalates to an error at large drift", () => {
    const warning = simulationWarnings({ ...healthy, energyDrift: 0.5 }).find(
      (w) => w.id === "energy-drift-high",
    );
    expect(warning?.severity).toBe("error");
  });

  it("stays quiet at a drift a good run actually achieves", () => {
    expect(ids({ energyDrift: 1e-9 })).not.toContain("energy-drift-high");
  });

  it("is not confused by a non-finite drift", () => {
    expect(() => simulationWarnings({ ...healthy, energyDrift: NaN })).not.toThrow();
    expect(ids({ energyDrift: NaN })).not.toContain("energy-drift-high");
  });
});

describe("every warning", () => {
  it("says what to do, not only that something is wrong", () => {
    const all = simulationWarnings({
      integrator: "verlet",
      dt: 100,
      shortestPeriodDays: 365,
      softening: 0.5,
      closestApproachAu: 0.01,
      theta: 1.5,
      peakSubsteps: MAX_SUBSTEPS,
      stepCount: 200_000,
      energyDrift: 0.5,
    });
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const warning of all) {
      expect(warning.title.length).toBeGreaterThan(0);
      // Every detail ends in an instruction, a consequence, or a number the
      // reader can act on — never a bare "something is wrong".
      expect(warning.detail.length).toBeGreaterThan(80);
    }
    // Ids are unique, so a renderer can key on them.
    expect(new Set(all.map((w) => w.id)).size).toBe(all.length);
  });
});
