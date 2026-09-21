/**
 * Undo and redo bookkeeping.
 *
 * The interesting cases are the ones where the worker says no, and the one
 * where a new edit arrives after an undo.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_HISTORY,
  MAX_HISTORY,
  canRedo,
  canUndo,
  commitRedo,
  commitUndo,
  nextRedo,
  nextUndo,
  recordEdit,
  type EditHistory,
} from "../../src/ui/edit-history";
import type { EditResult, ScenarioEdit } from "../../src/sim/edits";

const remove = (id: string): ScenarioEdit => ({ kind: "remove", id });
const add = (id: string): ScenarioEdit => ({
  kind: "add",
  body: {
    id,
    name: id,
    mass: 1e-6,
    radius: 1e-4,
    position: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0.017, z: 0 },
  },
});
const result = (id: string): EditResult => ({
  applied: add(id),
  inverse: remove(id),
});

describe("recording edits", () => {
  it("starts with nothing to undo or redo", () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_HISTORY)).toBe(false);
    expect(nextUndo(EMPTY_HISTORY)).toBeNull();
    expect(nextRedo(EMPTY_HISTORY)).toBeNull();
  });

  it("offers the newest edit's inverse first", () => {
    let history = recordEdit(EMPTY_HISTORY, result("a"));
    history = recordEdit(history, result("b"));
    expect(nextUndo(history)).toEqual(remove("b"));
  });

  it("drops the oldest entry past the depth limit", () => {
    let history: EditHistory = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      history = recordEdit(history, result(`b${i}`));
    }
    expect(history.past).toHaveLength(MAX_HISTORY);
    expect(history.past[0].applied).toEqual(add("b10"));
  });
});

describe("undo and redo", () => {
  it("moves an entry to the future stack and back", () => {
    const one = recordEdit(EMPTY_HISTORY, result("a"));
    const undone = commitUndo(one);
    expect(canUndo(undone)).toBe(false);
    expect(canRedo(undone)).toBe(true);
    // Redo replays the RESOLVED edit, not the original request.
    expect(nextRedo(undone)).toEqual(add("a"));

    const redone = commitRedo(undone);
    expect(redone).toEqual(one);
  });

  it("clears the redo stack when a new edit diverges from it", () => {
    // Replaying a redo after diverging would apply an edit against a state it
    // was never computed for.
    let history = recordEdit(EMPTY_HISTORY, result("a"));
    history = commitUndo(history);
    expect(canRedo(history)).toBe(true);
    history = recordEdit(history, result("b"));
    expect(canRedo(history)).toBe(false);
    expect(nextUndo(history)).toEqual(remove("b"));
  });

  it("is unchanged when there is nothing to move", () => {
    // The guard that matters when a keyboard shortcut fires on an empty stack.
    expect(commitUndo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
    expect(commitRedo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
  });

  it("leaves the history alone when the caller never commits", () => {
    // This is what a rejected edit looks like: the inverse was read, the
    // worker refused, and nothing was committed.
    const one = recordEdit(EMPTY_HISTORY, result("a"));
    expect(nextUndo(one)).toEqual(remove("a"));
    expect(one.past).toHaveLength(1);
    expect(one.future).toHaveLength(0);
  });

  it("round-trips a long chain without losing order", () => {
    let history: EditHistory = EMPTY_HISTORY;
    const ids = ["a", "b", "c", "d", "e"];
    for (const id of ids) history = recordEdit(history, result(id));

    const undoOrder: ScenarioEdit[] = [];
    while (canUndo(history)) {
      undoOrder.push(nextUndo(history) as ScenarioEdit);
      history = commitUndo(history);
    }
    expect(undoOrder).toEqual([...ids].reverse().map(remove));

    const redoOrder: ScenarioEdit[] = [];
    while (canRedo(history)) {
      redoOrder.push(nextRedo(history) as ScenarioEdit);
      history = commitRedo(history);
    }
    expect(redoOrder).toEqual(ids.map(add));
  });
});
