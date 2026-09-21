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
 * Keyed by the version being migrated FROM.
 *
 * Empty at v1 because v1 is the first published version. The machinery is here
 * from the start so that adding v2 is a one-entry change rather than a
 * retrofit — and so the "document from the future" path is tested today.
 */
export const migrations: Readonly<Record<number, Migration>> = {};

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
