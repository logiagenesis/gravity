/**
 * Guided experiments.
 *
 * The question comes BEFORE the button, deliberately. A learner who reads
 * "what happens if the Sun loses half its mass?", decides, and then presses
 * Run has learned something whichever way they guessed; one who presses first
 * and reads afterwards has watched an animation.
 *
 * The explanation is behind a disclosure for the same reason — it is there the
 * moment it is wanted and not before.
 */
import { useState } from "react";
import type { Experiment } from "../../experiments/catalogue";
import type { ScenarioEdit } from "../../sim/edits";

export interface ExperimentsProps {
  experiments: readonly Experiment[];
  /** Apply one edit. Rejects with the reason if it is refused. */
  applyEdit: (edit: ScenarioEdit) => Promise<void>;
  /** Start the simulation, since most experiments are only visible running. */
  onPlay: () => void;
  playing: boolean;
}

export function Experiments({
  experiments,
  applyEdit,
  onPlay,
  playing,
}: ExperimentsProps) {
  const [ran, setRan] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (experiments.length === 0) return null;

  const run = async (experiment: Experiment) => {
    setError(null);
    try {
      // In order, and one at a time: a later edit may depend on an earlier
      // one having landed, and the worker applies them in the order it is told.
      for (const edit of experiment.edits) await applyEdit(edit);
      setRan((current) => new Set(current).add(experiment.id));
      // An experiment nobody can see is not an experiment. Most of these only
      // mean anything once the system is moving.
      if (!playing) onPlay();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <section className="experiments" aria-labelledby="experiments-heading">
      <h3 id="experiments-heading">Try an experiment</h3>
      <p className="field-hint">
        Each one changes the system while it runs. Read the question, decide what you
        think will happen, then run it. Undo puts everything back.
      </p>

      {error !== null && (
        <p className="body-editor__error" role="alert">
          {error}
        </p>
      )}

      <ul className="experiments__list">
        {experiments.map((experiment) => (
          <li key={experiment.id} className="experiment">
            <h4>{experiment.title}</h4>
            <p className="experiment__question">{experiment.question}</p>
            <p className="field-hint">
              <strong>Watch: </strong>
              {experiment.watchFor}
            </p>
            <div className="experiments__actions">
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => void run(experiment)}
              >
                Run
              </button>
              {ran.has(experiment.id) && (
                <span className="field-hint" role="status">
                  Running — undo in the editor below to restore it.
                </span>
              )}
            </div>
            <details className="experiment__answer">
              <summary>What happens, and why</summary>
              <p>{experiment.explanation}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
