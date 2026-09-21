/**
 * Schema migrations.
 *
 * The rule these enforce: a document written by an older build must keep the
 * behaviour it had, and a document written by a NEWER build must be refused
 * rather than partially read. Silently dropping a field a newer build wrote
 * is data loss dressed up as success.
 */
import { describe, it, expect } from "vitest";
import { migrateAndParse, SchemaVersionError } from "../../src/schema/migrations";
import { CURRENT_SCHEMA_VERSION } from "../../src/schema/scenario";

/** A minimal, valid v1 scenario — the shape this project actually shipped. */
function v1Scenario(collisions?: boolean): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "two-body",
    name: "Two Body",
    summary: "A test scenario.",
    category: "what-if",
    tags: ["test"],
    difficulty: "beginner",
    source: {
      provider: "Test",
      reference: "Unit test",
      retrievedAt: "2026-09-21",
    },
    physics: {
      softening: 0,
      integrator: "verlet",
      dt: 0.5,
      forceMode: "direct",
      theta: 0.5,
      ...(collisions === undefined ? {} : { collisions }),
    },
    bodies: [
      {
        id: "a",
        name: "A",
        mass: 1,
        radius: 0.1,
        position: { x: -1, y: 0, z: 0 },
        velocity: { x: 0, y: 0.5, z: 0 },
      },
      {
        id: "b",
        name: "B",
        mass: 1,
        radius: 0.1,
        position: { x: 1, y: 0, z: 0 },
        velocity: { x: 0, y: -0.5, z: 0 },
      },
    ],
  };
}

describe("v1 to v2: collisions becomes collisionMode", () => {
  it("maps collisions: true to merge, which is what v1 did", () => {
    const scenario = migrateAndParse(v1Scenario(true));
    expect(scenario.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(scenario.physics.collisionMode).toBe("merge");
  });

  it("maps collisions: false to pass-through, which is what v1 did", () => {
    expect(migrateAndParse(v1Scenario(false)).physics.collisionMode).toBe(
      "pass-through",
    );
  });

  it("maps an absent collisions field to merge, which was the v1 default", () => {
    expect(migrateAndParse(v1Scenario()).physics.collisionMode).toBe("merge");
  });

  it("removes the old field rather than leaving both", () => {
    const scenario = migrateAndParse(v1Scenario(false));
    expect(scenario.physics).not.toHaveProperty("collisions");
  });

  it("changes nothing else about the document", () => {
    const scenario = migrateAndParse(v1Scenario(true));
    expect(scenario.id).toBe("two-body");
    expect(scenario.physics.dt).toBe(0.5);
    expect(scenario.physics.integrator).toBe("verlet");
    expect(scenario.bodies).toHaveLength(2);
    expect(scenario.bodies[0].velocity.y).toBe(0.5);
  });

  it("does not overwrite a mode the document already carries", () => {
    const doc = v1Scenario(true);
    (doc.physics as Record<string, unknown>).collisionMode = "elastic";
    expect(migrateAndParse(doc).physics.collisionMode).toBe("elastic");
  });
});

describe("version handling", () => {
  it("accepts a current-version document unchanged", () => {
    const doc = v1Scenario(true);
    doc.schemaVersion = CURRENT_SCHEMA_VERSION;
    (doc.physics as Record<string, unknown>).collisionMode = "elastic";
    delete (doc.physics as Record<string, unknown>).collisions;
    expect(migrateAndParse(doc).physics.collisionMode).toBe("elastic");
  });

  it("refuses a document from the future rather than dropping its fields", () => {
    const doc = v1Scenario(true);
    doc.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
    expect(() => migrateAndParse(doc)).toThrow(SchemaVersionError);
    expect(() => migrateAndParse(doc)).toThrow(/has not been modified/);
  });

  it("refuses a document with no version at all", () => {
    const doc = v1Scenario(true);
    delete doc.schemaVersion;
    expect(() => migrateAndParse(doc)).toThrow(/missing a valid integer schemaVersion/);
  });

  it("refuses a non-object", () => {
    expect(() => migrateAndParse("not a scenario")).toThrow(SchemaVersionError);
    expect(() => migrateAndParse(null)).toThrow(SchemaVersionError);
  });
});
