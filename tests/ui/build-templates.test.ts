/**
 * The build templates.
 *
 * Each one is a hand-written scenario document, which is exactly the kind of
 * thing that passes review and then fails validation in front of a learner.
 * These build every template and check both that it parses and that the
 * physics in it is what the description promises.
 */
import { describe, it, expect } from "vitest";
import { BUILD_TEMPLATES } from "../../src/ui/BuildPage";
import { SimState } from "../../src/sim/state";
import { computeConservation } from "../../src/sim/conservation";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";

describe("every template", () => {
  it("offers more than one starting point", () => {
    expect(BUILD_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const ids = BUILD_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BUILD_TEMPLATES)("$id validates against the schema", (template) => {
    // build() runs parseScenario, so this throws if the document is wrong.
    expect(() => template.build()).not.toThrow();
  });

  it.each(BUILD_TEMPLATES)("$id says what it is", (template) => {
    expect(template.title.length).toBeGreaterThan(3);
    expect(template.description.length).toBeGreaterThan(60);
  });

  it.each(BUILD_TEMPLATES)("$id is honest about where it came from", (template) => {
    // A constructed system that named a provider would be the unsourced claim
    // the rest of this project exists to avoid.
    const scenario = template.build();
    expect(scenario.source.provider).toBe("Constructed");
    expect(scenario.source.notes ?? "").toMatch(/not a real system/i);
  });

  it.each(BUILD_TEMPLATES)("$id gives every body a unique id", (template) => {
    const ids = template.build().bodies.map((body) => body.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the physics each template promises", () => {
  /** Total momentum, which says whether the system drifts out of frame. */
  function momentum(scenario: ReturnType<(typeof BUILD_TEMPLATES)[0]["build"]>) {
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const body of scenario.bodies) {
      px += body.mass * body.velocity.x;
      py += body.mass * body.velocity.y;
      pz += body.mass * body.velocity.z;
    }
    return Math.hypot(px, py, pz);
  }

  it("the star and planet is on a circular orbit", () => {
    const scenario = BUILD_TEMPLATES.find((t) => t.id === "star-and-planet")?.build();
    if (!scenario) throw new Error("template missing");
    const [star, planet] = scenario.bodies;
    const radius = Math.hypot(
      planet.position.x - star.position.x,
      planet.position.y - star.position.y,
      planet.position.z - star.position.z,
    );
    const speed = Math.hypot(planet.velocity.x, planet.velocity.y, planet.velocity.z);
    const circular = Math.sqrt(
      (G_AU3_PER_MSUN_DAY2 * (star.mass + planet.mass)) / radius,
    );
    expect(speed / circular).toBeCloseTo(1, 5);
  });

  it("the pair of stars has no net momentum, so it stays put", () => {
    // A binary built by giving one star a velocity and leaving the other at
    // rest drifts off screen, which is the commonest way to get this wrong.
    const scenario = BUILD_TEMPLATES.find((t) => t.id === "binary-pair")?.build();
    if (!scenario) throw new Error("template missing");
    expect(momentum(scenario)).toBeLessThan(1e-15);
  });

  it("the pair of stars is bound, not flying apart", () => {
    const scenario = BUILD_TEMPLATES.find((t) => t.id === "binary-pair")?.build();
    if (!scenario) throw new Error("template missing");
    const state = SimState.fromBodies(scenario.bodies);
    const { totalEnergy } = computeConservation(state, G_AU3_PER_MSUN_DAY2, 0);
    expect(totalEnergy).toBeLessThan(0);
  });

  it("the dropped pair really is at rest, and really will fall together", () => {
    const scenario = BUILD_TEMPLATES.find((t) => t.id === "dropped-from-rest")?.build();
    if (!scenario) throw new Error("template missing");
    for (const body of scenario.bodies) {
      expect(Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z)).toBe(0);
    }
    const state = SimState.fromBodies(scenario.bodies);
    const { totalEnergy, kineticEnergy } = computeConservation(
      state,
      G_AU3_PER_MSUN_DAY2,
      0,
    );
    expect(kineticEnergy).toBe(0);
    expect(totalEnergy).toBeLessThan(0);
  });
});
