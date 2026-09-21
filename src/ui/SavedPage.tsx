/**
 * Locally saved scenarios and file import.
 *
 * Records that cannot be migrated are LISTED, not hidden. Silently dropping a
 * user's saved work would be data loss disguised as a clean list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSavedScenarios,
  deleteSavedScenario,
  storageAvailable,
  type SavedScenarioSummary,
} from "../storage/saved-scenarios";
import { importScenarioFile } from "../share/link";
import type { Scenario } from "../schema/scenario";

interface SavedPageProps {
  onOpen: (id: string) => void;
  onOpenImported: (scenario: Scenario) => void;
}

export function SavedPage({ onOpen, onOpenImported }: SavedPageProps) {
  const [saved, setSaved] = useState<SavedScenarioSummary[]>([]);
  const [unreadable, setUnreadable] = useState<Array<{ id: string; reason: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    if (!storageAvailable()) {
      setError(
        "This browser does not allow local storage here, so saved scenarios are unavailable. You can still import and export files.",
      );
      return;
    }
    listSavedScenarios()
      .then((result) => {
        setSaved(result.scenarios);
        setUnreadable(result.unreadable);
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "Could not read saved scenarios.",
        ),
      );
  }, []);

  useEffect(refresh, [refresh]);

  const handleImport = async (file: File) => {
    try {
      const scenario = await importScenarioFile(file);
      setStatus(`Imported “${scenario.name}”.`);
      onOpenImported(scenario);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That file could not be imported.",
      );
    }
  };

  return (
    <div>
      <h1>Saved scenarios</h1>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <section className="panel" aria-labelledby="import-heading">
        <h2 id="import-heading">Import a scenario file</h2>
        <p className="field-hint">
          Imported files are fully validated before anything is loaded. A file that does
          not match the scenario schema is rejected with an explanation.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Choose a scenario JSON file to import"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
        <p role="status" aria-live="polite">
          {status}
        </p>
      </section>

      {unreadable.length > 0 && (
        <div className="notice notice--warn" role="status">
          <p>
            <strong>
              {unreadable.length} saved scenario{unreadable.length === 1 ? "" : "s"}{" "}
              could not be opened.
            </strong>{" "}
            They have not been deleted.
          </p>
          <ul>
            {unreadable.map((item) => (
              <li key={item.id}>
                <code>{item.id}</code>: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saved.length === 0 ? (
        <p>
          Nothing saved yet. Open a scenario and choose “Save locally” to keep it in
          this browser.
        </p>
      ) : (
        <ul className="card-grid">
          {saved.map((entry) => (
            <li key={entry.id}>
              <article className="card">
                <h3>{entry.name}</h3>
                <p>
                  {entry.bodyCount} bodies · saved{" "}
                  {new Date(entry.savedAt).toLocaleString("en-GB")}
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onOpen(entry.id)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      void deleteSavedScenario(entry.id).then(refresh);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
