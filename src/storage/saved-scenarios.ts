/**
 * Local scenario storage, backed by IndexedDB.
 *
 * Saved documents are validated through `migrateAndParse` ON READ, not only on
 * write. A document written by an older build must still be readable by a newer
 * one, and a document that cannot be migrated is reported rather than silently
 * dropped — no silent data loss is a requirement, not a nicety.
 */
import { migrateAndParse } from "../schema/migrations";
import type { Scenario } from "../schema/scenario";

const DB_NAME = "gravity-simulator";
const DB_VERSION = 1;
const STORE = "scenarios";

export interface SavedScenarioRecord {
  id: string;
  savedAt: string;
  scenario: Scenario;
}

export interface SavedScenarioSummary {
  id: string;
  name: string;
  savedAt: string;
  bodyCount: number;
}

/** True when IndexedDB is usable. Private modes and locked-down browsers may not have it. */
export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the database."));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("Storage request failed."));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function saveScenario(scenario: Scenario): Promise<void> {
  const record: SavedScenarioRecord = {
    id: scenario.id,
    savedAt: new Date().toISOString(),
    scenario,
  };
  await tx("readwrite", (store) => store.put(record));
}

export async function deleteSavedScenario(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

export interface LoadAllResult {
  scenarios: SavedScenarioSummary[];
  /** Records that could not be migrated. Surfaced, never silently discarded. */
  unreadable: Array<{ id: string; reason: string }>;
}

export async function listSavedScenarios(): Promise<LoadAllResult> {
  const records = await tx<SavedScenarioRecord[]>("readonly", (store) =>
    store.getAll(),
  );
  const scenarios: SavedScenarioSummary[] = [];
  const unreadable: Array<{ id: string; reason: string }> = [];

  for (const record of records) {
    try {
      const scenario = migrateAndParse(record.scenario);
      scenarios.push({
        id: record.id,
        name: scenario.name,
        savedAt: record.savedAt,
        bodyCount: scenario.bodies.length,
      });
    } catch (error) {
      unreadable.push({
        id: record.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  scenarios.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return { scenarios, unreadable };
}

export async function getSavedScenario(id: string): Promise<Scenario> {
  const record = await tx<SavedScenarioRecord | undefined>("readonly", (store) =>
    store.get(id),
  );
  if (!record) throw new Error(`No saved scenario with id "${id}".`);
  return migrateAndParse(record.scenario);
}
