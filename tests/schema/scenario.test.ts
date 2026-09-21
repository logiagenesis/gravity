/**
 * Schema validation and migration tests.
 *
 * REGRESSION: a comparable implementation performed no runtime validation at
 * all and spread parsed JSON straight into state
 * (artifacts/03-current-site-audit.md §12.3).
 */
import { describe, it, expect } from "vitest";
import {
  parseScenario,
  safeParseScenario,
  ScenarioValidationError,
  CURRENT_SCHEMA_VERSION,
} from "../../src/schema/scenario";
import { migrateAndParse, SchemaVersionError } from "../../src/schema/migrations";

/**
 * A deliberately loose view of the fixture. These tests exist to set INVALID
 * values, so the mutators need a type that permits them. Typing every field as
 * `unknown` and making them optional lets the mutators do their job without
 * reaching for `any`, which the lint config rejects for good reason.
 */
type Draft = {
  [key: string]: unknown;
  source?: Record<string, unknown>;
  physics?: Record<string, unknown>;
  bodies?: Array<Record<string, unknown>>;
  camera?: Record<string, unknown>;
};

const valid = () => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "test-scenario",
  name: "Test Scenario",
  summary: "A minimal valid scenario.",
  category: "test",
  tags: ["test"],
  difficulty: "beginner",
  source: {
    provider: "Constructed for this project",
    reference: "unit test fixture",
    retrievedAt: "2026-09-21",
  },
  physics: {
    softening: 0,
    integrator: "verlet",
    dt: 0.01,
    forceMode: "direct",
    theta: 0.5,
    collisionMode: "merge",
  },
  bodies: [
    {
      id: "a",
      name: "A",
      mass: 1,
      radius: 0.1,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    {
      id: "b",
      name: "B",
      mass: 1,
      radius: 0.1,
      position: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 1, z: 0 },
    },
  ],
});

describe("scenario validation", () => {
  it("accepts a well-formed scenario", () => {
    expect(() => parseScenario(valid())).not.toThrow();
  });

  it("applies documented defaults", () => {
    const minimal = valid() as unknown as Draft;
    minimal.physics = { dt: 0.01 };
    delete minimal.tags;
    delete minimal.difficulty;
    const parsed = parseScenario(minimal);
    expect(parsed.physics.integrator).toBe("verlet");
    expect(parsed.physics.softening).toBe(0);
    expect(parsed.physics.forceMode).toBe("auto");
    expect(parsed.difficulty).toBe("beginner");
    expect(parsed.tags).toEqual([]);
  });

  describe("rejects invalid scenarios", () => {
    const cases: Array<[string, (s: Draft) => void]> = [
      ["missing source", (s) => delete s.source],
      ["source without a provider", (s) => (s.source!.provider = "")],
      ["source with a malformed date", (s) => (s.source!.retrievedAt = "21/09/2026")],
      ["fewer than two bodies", (s) => (s.bodies = [s.bodies![0]])],
      ["no body with mass", (s) => s.bodies!.forEach((b) => (b.mass = 0))],
      ["a negative mass", (s) => (s.bodies![0].mass = -1)],
      ["a zero radius", (s) => (s.bodies![0].radius = 0)],
      [
        "NaN in a position",
        (s) => ((s.bodies![0].position as Record<string, unknown>).x = Number.NaN),
      ],
      [
        "Infinity in a velocity",
        (s) =>
          ((s.bodies![0].velocity as Record<string, unknown>).y =
            Number.POSITIVE_INFINITY),
      ],
      ["duplicate body ids", (s) => (s.bodies![1].id = s.bodies![0].id)],
      ["a non-positive timestep", (s) => (s.physics!.dt = 0)],
      ["an unknown integrator", (s) => (s.physics!.integrator = "leapfrog-9000")],
      ["an id that is not kebab-case", (s) => (s.id = "Not Kebab Case")],
      ["an empty summary", (s) => (s.summary = "")],
      [
        "a camera target naming no body",
        (s) => (s.camera = { distance: 5, target: "ghost" }),
      ],
      ["a malformed colour", (s) => (s.bodies![0].colour = "red")],
    ];

    for (const [label, mutate] of cases) {
      it(label, () => {
        const doc = valid() as unknown as Draft;
        mutate(doc);
        expect(() => parseScenario(doc)).toThrow(ScenarioValidationError);
      });
    }
  });

  it("reports every problem at once, not just the first", () => {
    const doc = valid() as unknown as Draft;
    doc.bodies![0].mass = -1;
    doc.bodies![0].radius = -5;
    doc.physics!.dt = -1;
    const result = safeParseScenario(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects values that are not objects at all", () => {
    for (const bad of [null, undefined, 42, "scenario", [], true]) {
      expect(() => parseScenario(bad)).toThrow(ScenarioValidationError);
    }
  });
});

describe("schema migration", () => {
  it("passes a current-version document straight through", () => {
    expect(() => migrateAndParse(valid())).not.toThrow();
  });

  it("refuses a document from a newer schema version without modifying it", () => {
    const future = { ...valid(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrateAndParse(future)).toThrow(SchemaVersionError);
    // No silent data loss: the caller's object is untouched.
    expect(future.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
  });

  it("explains itself when the version is missing or nonsense", () => {
    expect(() => migrateAndParse({ id: "x" })).toThrow(/schemaVersion/);
    expect(() => migrateAndParse({ schemaVersion: "one" })).toThrow(SchemaVersionError);
    expect(() => migrateAndParse({ schemaVersion: 0 })).toThrow(SchemaVersionError);
    expect(() => migrateAndParse(null)).toThrow(SchemaVersionError);
  });

  it("round-trips a scenario through JSON without loss", () => {
    const original = parseScenario(valid());
    const round = migrateAndParse(JSON.parse(JSON.stringify(original)));
    expect(round).toEqual(original);
  });
});
