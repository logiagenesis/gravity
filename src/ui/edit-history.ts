/**
 * Undo and redo for live edits.
 *
 * Kept as plain functions over a plain value rather than as React state
 * updates, so the invariants can be tested without rendering anything. The
 * invariants are:
 *
 *   1. A NEW EDIT CLEARS REDO. Redoing after diverging would replay an edit
 *      against a state it was never computed for.
 *   2. A REJECTED EDIT CHANGES NOTHING. The worker validates before it writes,
 *      so a rejection leaves the simulation untouched — and the history has to
 *      stay untouched with it, or undo would try to reverse something that
 *      never happened.
 *   3. REDO REPLAYS THE RESOLVED EDIT. `addOrbiting` is sized against the
 *      parent's position at the time it ran; replaying the original request
 *      after the parent has moved would land somewhere else. The worker hands
 *      back a resolved `add`, and that is what redo uses.
 */
import type { EditResult, ScenarioEdit } from "../sim/edits";

export interface HistoryEntry {
  /** The edit in resolved form. Replayed by redo. */
  applied: ScenarioEdit;
  /** The edit that undoes it. */
  inverse: ScenarioEdit;
}

export interface EditHistory {
  /** Most recent last. */
  readonly past: readonly HistoryEntry[];
  /** Most recently undone last. */
  readonly future: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: EditHistory = { past: [], future: [] };

/** Depth beyond which the oldest entry is dropped. */
export const MAX_HISTORY = 100;

export function canUndo(history: EditHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditHistory): boolean {
  return history.future.length > 0;
}

/** Record an edit that has just been applied. Clears the redo stack. */
export function recordEdit(history: EditHistory, result: EditResult): EditHistory {
  const past = [...history.past, { applied: result.applied, inverse: result.inverse }];
  return { past: past.slice(-MAX_HISTORY), future: [] };
}

/**
 * The edit undo should apply, or null if there is nothing to undo.
 *
 * Deliberately split from `commitUndo`: the caller has to await the worker in
 * between, and a history that moved before the worker confirmed would be a
 * history that lies when the edit is refused.
 */
export function nextUndo(history: EditHistory): ScenarioEdit | null {
  const entry = history.past.at(-1);
  return entry === undefined ? null : entry.inverse;
}

export function nextRedo(history: EditHistory): ScenarioEdit | null {
  const entry = history.future.at(-1);
  return entry === undefined ? null : entry.applied;
}

/** Move the newest past entry onto the future stack. */
export function commitUndo(history: EditHistory): EditHistory {
  const entry = history.past.at(-1);
  if (entry === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    future: [...history.future, entry],
  };
}

/** Move the newest future entry back onto the past stack. */
export function commitRedo(history: EditHistory): EditHistory {
  const entry = history.future.at(-1);
  if (entry === undefined) return history;
  return {
    past: [...history.past, entry],
    future: history.future.slice(0, -1),
  };
}
