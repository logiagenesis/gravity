/**
 * Scenario schema migrations.
 *
 * A document older than the current version is upgraded step by step. A
 * document NEWER than this build understands is rejected with an explicit
 * message rather than partially read — silently dropping fields a newer build
 * wrote would be data loss disguised as success.
 */
import { CURRENT_SCHEMA_VERSION, parseScenario, type Scenario } from "./scenario";

/** One step from version n to n+1. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * v1 -> v2: `physics.collisions` (boolean) becomes `physics.collisionMode`.
 *
 * v1 could only express "merge on contact" or "do nothing". v2 adds an
 * elastic mode, which a boolean cannot carry. The mapping preserves every v1
 * document's behaviour exactly:
 *
 *   collisions: true   ->  collisionMode: "merge"         (the v1 behaviour)
 *   collisions: false  ->  collisionMode: "pass-through"  (the v1 behaviour)
 *   absent             ->  collisionMode: "merge"         (the v1 default)
 */
const v1ToV2: Migration = (doc) => {
  const physics = doc.physics;
  if (typeof physics !== "object" || physics === null) return doc;
  const next = { ...(physics as Record<string, unknown>) };
  const collisions = next.collisions;
  delete next.collisions;
  // Only supply a mode if the document does not already carry one, so a
  // hand-written hybrid is not silently overwritten.
  if (next.collisionMode === undefined) {
    next.collisionMode = collisions === false ? "pass-through" : "merge";
  }
  return { ...doc, physics: next };
};

/**
 * Keyed by the version being migrated FROM.
 *
 * The machinery was built at v1, before there was anything to migrate, so
 * that adding v2 would be a one-entry change rather than a retrofit. It was.
 */
export const migrations: Readonly<Record<number, Migration>> = { 1: v1ToV2 };

export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaVersionError";
  }
}

function readVersion(doc: unknown): number {
  if (typeof doc !== "object" || doc === null) {
    throw new SchemaVersionError("Scenario must be an object.");
  }
  const version = (doc as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SchemaVersionError(
      "Scenario is missing a valid integer schemaVersion. It may not be a scenario file.",
    );
  }
  return version;
}

/**
 * Bring any supported scenario document up to the current version, then
 * validate it. This is the ONLY supported entry point for untrusted documents.
 */
export function migrateAndParse(input: unknown): Scenario {
  const version = readVersion(input);

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(
      `This scenario uses schema version ${version}, but this version of the app ` +
        `understands up to version ${CURRENT_SCHEMA_VERSION}. Update the app to open it. ` +
        `The file has not been modified.`,
    );
  }

  let doc = { ...(input as Record<string, unknown>) };
  let current = version;

  while (current < CURRENT_SCHEMA_VERSION) {
    const migration = migrations[current];
    if (!migration) {
      throw new SchemaVersionError(
        `No migration is available from schema version ${current} to ${current + 1}. ` +
          `This scenario cannot be opened safely.`,
      );
    }
    doc = migration(doc);
    current += 1;
    doc.schemaVersion = current;
  }

  return parseScenario(doc);
}
