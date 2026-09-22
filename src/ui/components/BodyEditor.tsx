/**
 * Add, change and remove bodies in a running simulation.
 *
 * Edits apply IN PLACE rather than rebuilding from the scenario document,
 * because the point of editing a live simulation is to nudge something
 * mid-flight and watch what happens — remove Jupiter while the Trojans are
 * moving, double the Earth's mass at aphelion. Rebuilding would restart the
 * run and throw away the thing being studied.
 *
 * Every field is held as TEXT while being typed and parsed on submit. A
 * number input bound to a number cannot hold "-", "1e" or an empty box, so
 * binding directly makes the field fight the person using it.
 */
import { useEffect, useId, useState } from "react";
import type { BodyMeta } from "../../worker/protocol";
import type { BodyInit } from "../../sim/state";
import type { ScenarioEdit } from "../../sim/edits";

export interface BodyEditorProps {
  bodies: readonly BodyMeta[];
  /** Resolve one body's full state, including its velocity. */
  loadDetail: (id: string) => Promise<BodyInit | null>;
  /** Apply an edit. Rejects with the reason if it is refused. */
  applyEdit: (edit: ScenarioEdit) => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Edits applied so far, so an edited run can say that it is one. */
  editCount: number;
}

type Vector = { x: string; y: string; z: string };

interface Draft {
  id: string;
  name: string;
  mass: string;
  radius: string;
  position: Vector;
  velocity: Vector;
}

function toDraft(body: BodyInit): Draft {
  return {
    id: body.id,
    name: body.name,
    mass: String(body.mass),
    radius: String(body.radius),
    position: {
      x: String(body.position.x),
      y: String(body.position.y),
      z: String(body.position.z),
    },
    velocity: {
      x: String(body.velocity.x),
      y: String(body.velocity.y),
      z: String(body.velocity.z),
    },
  };
}

function parseVector(vector: Vector): { x: number; y: number; z: number } {
  return { x: Number(vector.x), y: Number(vector.y), z: Number(vector.z) };
}

/** Three number inputs, labelled, for one vector quantity. */
function VectorFields({
  legend,
  unit,
  value,
  onChange,
}: {
  legend: string;
  unit: string;
  value: Vector;
  onChange: (next: Vector) => void;
}) {
  const prefix = useId();
  return (
    <fieldset className="vector-fields">
      <legend>
        {legend} <span className="vector-fields__unit">{unit}</span>
      </legend>
      {(["x", "y", "z"] as const).map((axis) => (
        <div className="vector-fields__axis" key={axis}>
          <label htmlFor={`${prefix}-${axis}`}>{axis}</label>
          <input
            id={`${prefix}-${axis}`}
            type="text"
            inputMode="decimal"
            value={value[axis]}
            onChange={(event) => onChange({ ...value, [axis]: event.target.value })}
          />
        </div>
      ))}
    </fieldset>
  );
}

export function BodyEditor({
  bodies,
  loadDetail,
  applyEdit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  editCount,
}: BodyEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);
  const [orbitParent, setOrbitParent] = useState<string>("");
  const [orbitRadius, setOrbitRadius] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const addNameId = useId();
  const addMassId = useId();
  const addRadiusId = useId();
  const orbitParentId = useId();
  const orbitRadiusId = useId();

  // Load the body's real numbers when an edit is opened. The velocity is not
  // in the per-frame snapshot, so it has to be asked for.
  useEffect(() => {
    let cancelled = false;
    if (editingId === null) {
      setDraft(null);
      return;
    }
    void loadDetail(editingId).then((body) => {
      if (cancelled) return;
      setDraft(body === null ? null : toDraft(body));
    });
    return () => {
      cancelled = true;
    };
  }, [editingId, loadDetail]);

  const run = async (edit: ScenarioEdit, done: string) => {
    setError(null);
    try {
      await applyEdit(edit);
      setStatus(done);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  };

  const saveDraft = async () => {
    if (draft === null) return;
    const ok = await run(
      {
        kind: "update",
        id: draft.id,
        patch: {
          name: draft.name,
          mass: Number(draft.mass),
          radius: Number(draft.radius),
          position: parseVector(draft.position),
          velocity: parseVector(draft.velocity),
        },
      },
      `${draft.name} updated.`,
    );
    if (ok) setEditingId(null);
  };

  const addBody = async () => {
    if (draft === null) return;
    const base = {
      id: draft.id,
      name: draft.name,
      mass: Number(draft.mass),
      radius: Number(draft.radius),
    };
    // With a parent chosen the worker sizes the orbit, because that is where
    // the live positions and the scenario's own g are. Doing it here would
    // mean a second copy of the formula against a constant that a scenario is
    // allowed to override.
    const edit: ScenarioEdit =
      orbitParent === ""
        ? {
            kind: "add",
            body: {
              ...base,
              position: parseVector(draft.position),
              velocity: parseVector(draft.velocity),
            },
          }
        : {
            kind: "addOrbiting",
            body: base,
            parentId: orbitParent,
            radiusAu: Number(orbitRadius),
          };
    const ok = await run(edit, `${base.name} added.`);
    if (ok) {
      setAdding(false);
      setDraft(null);
    }
  };

  const startAdding = () => {
    setAdding(true);
    setEditingId(null);
    setError(null);
    setDraft({
      id: `body-${Date.now().toString(36)}`,
      name: "New body",
      mass: "0.000003",
      radius: "0.00005",
      position: { x: "1", y: "0", z: "0" },
      velocity: { x: "0", y: "0.0172", z: "0" },
    });
    setOrbitParent(bodies[0]?.id ?? "");
    setOrbitRadius("1");
  };

  /*
   * Feedback is rendered NEXT TO THE ACTION THAT CAUSED IT, not once at the
   * top of the panel. The panel scrolls, and a body's edit form is often well
   * below the fold: an error shown at the top was invisible at exactly the
   * moment it mattered, so pressing Save looked like it had done nothing.
   */
  const feedback =
    error !== null ? (
      <p className="body-editor__error" role="alert">
        {error}
      </p>
    ) : status !== null ? (
      <p className="field-hint" role="status">
        {status}
      </p>
    ) : null;

  return (
    <div className="body-editor">
      <div className="body-editor__actions">
        <button type="button" className="btn btn--small" onClick={startAdding}>
          Add a body
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={onUndo}
          disabled={!canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={onRedo}
          disabled={!canRedo}
        >
          Redo
        </button>
      </div>

      {editCount > 0 && (
        <p className="field-hint">
          {editCount} {editCount === 1 ? "edit has" : "edits have"} been applied. This
          is no longer the scenario its citation describes.
        </p>
      )}
      {!adding && editingId === null && feedback}

      {adding && draft !== null && (
        <form
          className="body-editor__form"
          onSubmit={(event) => {
            event.preventDefault();
            void addBody();
          }}
        >
          <h3>Add a body</h3>
          <div className="field">
            <label htmlFor={addNameId}>Name</label>
            <input
              id={addNameId}
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={addMassId}>Mass (solar masses)</label>
            <input
              id={addMassId}
              type="text"
              inputMode="decimal"
              value={draft.mass}
              onChange={(event) => setDraft({ ...draft, mass: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={addRadiusId}>Radius (AU)</label>
            <input
              id={addRadiusId}
              type="text"
              inputMode="decimal"
              value={draft.radius}
              onChange={(event) => setDraft({ ...draft, radius: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor={orbitParentId}>Place in a circular orbit around</label>
            <div className="select">
              <select
                id={orbitParentId}
                value={orbitParent}
                onChange={(event) => setOrbitParent(event.target.value)}
              >
                <option value="">Nothing — set position and velocity myself</option>
                {bodies.map((body) => (
                  <option key={body.id} value={body.id}>
                    {body.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {orbitParent !== "" ? (
            <div className="field">
              <label htmlFor={orbitRadiusId}>Orbit radius (AU)</label>
              <input
                id={orbitRadiusId}
                type="text"
                inputMode="decimal"
                value={orbitRadius}
                onChange={(event) => setOrbitRadius(event.target.value)}
              />
              <p className="field-hint">
                Circular speed is worked out from the parent alone, so in a system with
                other bodies the orbit is approximate — as every “circular orbit” in a
                multi-body system is.
              </p>
            </div>
          ) : (
            <>
              <VectorFields
                legend="Position"
                unit="AU"
                value={draft.position}
                onChange={(position) => setDraft({ ...draft, position })}
              />
              <VectorFields
                legend="Velocity"
                unit="AU/day"
                value={draft.velocity}
                onChange={(velocity) => setDraft({ ...draft, velocity })}
              />
            </>
          )}

          {feedback}
          <div className="body-editor__actions">
            <button type="submit" className="btn btn--primary btn--small">
              Add
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setAdding(false);
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="body-editor__list">
        {bodies.map((body) => (
          <li key={body.id}>
            <div className="body-editor__row">
              <span>{body.name}</span>
              <span className="body-editor__row-actions">
                {/*
                 * The visible label is short so the row stays readable at
                 * 393px, and the accessible name carries the body it acts on
                 * so a screen reader does not hear "Edit" five times. The
                 * accessible name starts with the visible one, which is what
                 * WCAG 2.2 SC 2.5.3 (Label in Name) requires.
                 */}
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  aria-label={`Edit ${body.name}`}
                  aria-expanded={editingId === body.id}
                  onClick={() => {
                    setAdding(false);
                    setError(null);
                    setEditingId(editingId === body.id ? null : body.id);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  aria-label={`Delete ${body.name}`}
                  onClick={() =>
                    void run({ kind: "remove", id: body.id }, `${body.name} removed.`)
                  }
                >
                  Delete
                </button>
              </span>
            </div>

            {editingId === body.id && draft !== null && (
              <form
                className="body-editor__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDraft();
                }}
              >
                <div className="field">
                  <label htmlFor={`${body.id}-mass`}>Mass (solar masses)</label>
                  <input
                    id={`${body.id}-mass`}
                    type="text"
                    inputMode="decimal"
                    value={draft.mass}
                    onChange={(event) =>
                      setDraft({ ...draft, mass: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${body.id}-radius`}>Radius (AU)</label>
                  <input
                    id={`${body.id}-radius`}
                    type="text"
                    inputMode="decimal"
                    value={draft.radius}
                    onChange={(event) =>
                      setDraft({ ...draft, radius: event.target.value })
                    }
                  />
                </div>
                <VectorFields
                  legend="Position"
                  unit="AU"
                  value={draft.position}
                  onChange={(position) => setDraft({ ...draft, position })}
                />
                <VectorFields
                  legend="Velocity"
                  unit="AU/day"
                  value={draft.velocity}
                  onChange={(velocity) => setDraft({ ...draft, velocity })}
                />
                {feedback}
                <div className="body-editor__actions">
                  <button type="submit" className="btn btn--primary btn--small">
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
