/**
 * Edits to a running simulation, and their exact inverses.
 *
 * WHY INVERTIBLE EDITS RATHER THAN SNAPSHOTS. Undo could be done by keeping a
 * copy of the whole state before each change, but the state is typed arrays
 * that grow to thousands of bodies, so a deep history would be megabytes. An
 * edit and its inverse are a handful of numbers, and the inverse is EXACT:
 * undoing a mass change restores the previous mass bit for bit rather than
 * something close to it.
 *
 * WHY EDITS APPLY IN PLACE. The point of editing a live simulation is to nudge
 * something mid-flight and watch what happens — remove Jupiter while the
 * asteroids are in motion, double the Earth's mass at aphelion. Rebuilding
 * from a document would restart the run and throw away exactly the thing
 * being studied.
 *
 * Every edit LEGITIMATELY changes the conserved quantities: adding a body adds
 * its energy, changing a mass changes the potential. The engine rebaselines
 * after each one, so the drift readout keeps measuring integration error
 * rather than reporting the edit as if it were one.
 */
import type { SimState, BodyInit } from "./state";

export interface BodyPatch {
  mass?: number;
  radius?: number;
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  name?: string;
  colour?: string;
}

export type ScenarioEdit =
  | { kind: "add"; body: BodyInit }
  /**
   * Add a body on a circular orbit about another, sized in the worker.
   *
   * This exists so the orbit maths happens where the live state and the
   * scenario's own `g` are, rather than being duplicated in the UI against a
   * hardcoded constant. A scenario may override `g`; a UI copy of the formula
   * would silently ignore that.
   */
  | {
      kind: "addOrbiting";
      body: Omit<BodyInit, "position" | "velocity">;
      parentId: string;
      radiusAu: number;
    }
  | { kind: "update"; id: string; patch: BodyPatch }
  | { kind: "remove"; id: string };

/**
 * What an edit did.
 *
 * `inverse` undoes it. `applied` is the edit in fully resolved form, which
 * matters for redo: an `addOrbiting` resolves against the parent's position AT
 * THE TIME IT RAN, so replaying the original request after the parent has
 * moved would put the body somewhere else. Redo replays `applied` instead and
 * lands exactly where it did the first time.
 */
export interface EditResult {
  inverse: ScenarioEdit;
  applied: ScenarioEdit;
}

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/** Limits that keep an edit inside what the integrator can represent. */
const MAX_MASS_SOLAR = 1e12;
const MAX_RADIUS_AU = 1e6;
const MAX_COORDINATE_AU = 1e12;
const MAX_SPEED_AU_PER_DAY = 1e6;

function checkFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new EditError(`${label} must be a finite number.`);
  }
}

function checkVector(
  label: string,
  vector: { x: number; y: number; z: number },
  limit: number,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    const value = vector[axis];
    checkFinite(`${label}.${axis}`, value);
    if (Math.abs(value) > limit) {
      throw new EditError(
        `${label}.${axis} is ${value}, beyond the limit of ${limit.toExponential(0)}. ` +
          `Values this large do not survive double-precision arithmetic in a ` +
          `simulation that also has to resolve close encounters.`,
      );
    }
  }
}

function validateBody(body: BodyInit): void {
  if (body.id.trim() === "") throw new EditError("A body needs an id.");
  if (body.name.trim() === "") throw new EditError("A body needs a name.");
  checkFinite("mass", body.mass);
  if (body.mass < 0) throw new EditError("Mass cannot be negative.");
  if (body.mass > MAX_MASS_SOLAR) {
    throw new EditError(
      `Mass ${body.mass} is beyond the limit of ${MAX_MASS_SOLAR.toExponential(0)} ` +
        `solar masses.`,
    );
  }
  checkFinite("radius", body.radius);
  if (body.radius <= 0) throw new EditError("Radius must be greater than zero.");
  if (body.radius > MAX_RADIUS_AU) {
    throw new EditError(
      `Radius ${body.radius} is beyond the limit of ${MAX_RADIUS_AU.toExponential(0)} AU.`,
    );
  }
  checkVector("position", body.position, MAX_COORDINATE_AU);
  checkVector("velocity", body.velocity, MAX_SPEED_AU_PER_DAY);
}

function requireUniqueId(state: SimState, id: string): void {
  for (let i = 0; i < state.count; i++) {
    if (state.ids[i] === id) {
      throw new EditError(
        `There is already a body with id "${id}". Ids key labels, camera focus ` +
          `and undo, so they have to be unique.`,
      );
    }
  }
}

function indexOfId(state: SimState, id: string): number {
  for (let i = 0; i < state.count; i++) if (state.ids[i] === id) return i;
  throw new EditError(`No body with id "${id}".`);
}

function readBody(state: SimState, i: number): BodyInit {
  const k = i * 3;
  return {
    id: state.ids[i],
    name: state.names[i],
    mass: state.masses[i],
    radius: state.radii[i],
    position: {
      x: state.positions[k],
      y: state.positions[k + 1],
      z: state.positions[k + 2],
    },
    velocity: {
      x: state.velocities[k],
      y: state.velocities[k + 1],
      z: state.velocities[k + 2],
    },
    massless: state.isMassless(i),
    colour: state.colours[i],
  };
}

/**
 * Apply an edit and return both its exact inverse and its resolved form.
 *
 * `g` is the gravitational constant the SIMULATION is running with, not a
 * constant imported here, because a scenario may override it and an orbit
 * sized against the wrong one is not circular.
 *
 * Throws EditError, without having changed anything, if the edit is invalid.
 * Validation happens before any write for exactly that reason: a half-applied
 * edit is worse than a rejected one.
 */
export function applyEdit(state: SimState, edit: ScenarioEdit, g: number): EditResult {
  switch (edit.kind) {
    case "add": {
      validateBody(edit.body);
      requireUniqueId(state, edit.body.id);
      state.addBody(edit.body);
      return { inverse: { kind: "remove", id: edit.body.id }, applied: edit };
    }

    case "addOrbiting": {
      requireUniqueId(state, edit.body.id);
      const body = circularOrbitBody(state, edit.parentId, edit.radiusAu, g, edit.body);
      validateBody(body);
      state.addBody(body);
      // The resolved `add` is what redo replays, so redo reproduces this
      // orbit rather than a new one about a parent that has since moved.
      return {
        inverse: { kind: "remove", id: body.id },
        applied: { kind: "add", body },
      };
    }

    case "remove": {
      const i = indexOfId(state, edit.id);
      if (state.count <= 2) {
        throw new EditError(
          "A simulation needs at least two bodies. Removing this one would leave " +
            "nothing to fall towards.",
        );
      }
      const previous = readBody(state, i);
      state.removeBody(i);
      return { inverse: { kind: "add", body: previous }, applied: edit };
    }

    case "update": {
      const i = indexOfId(state, edit.id);
      const before = readBody(state, i);

      // Validate the RESULT, not the patch, so a partial edit cannot sneak an
      // invalid body past the same checks a whole one faces.
      const after: BodyInit = {
        ...before,
        ...(edit.patch.name === undefined ? {} : { name: edit.patch.name }),
        ...(edit.patch.colour === undefined ? {} : { colour: edit.patch.colour }),
        ...(edit.patch.mass === undefined ? {} : { mass: edit.patch.mass }),
        ...(edit.patch.radius === undefined ? {} : { radius: edit.patch.radius }),
        ...(edit.patch.position === undefined ? {} : { position: edit.patch.position }),
        ...(edit.patch.velocity === undefined ? {} : { velocity: edit.patch.velocity }),
      };
      validateBody(after);

      const k = i * 3;
      state.masses[i] = after.mass;
      state.radii[i] = after.radius;
      state.positions[k] = after.position.x;
      state.positions[k + 1] = after.position.y;
      state.positions[k + 2] = after.position.z;
      state.velocities[k] = after.velocity.x;
      state.velocities[k + 1] = after.velocity.y;
      state.velocities[k + 2] = after.velocity.z;
      state.names[i] = after.name;
      state.colours[i] = after.colour ?? "";
      // A body whose mass is edited to zero becomes a test particle, and one
      // given mass stops being one. Keeping the flag in step with the mass is
      // what stops a "massless" body from silently gravitating.
      state.setMassless(i, after.mass === 0);

      return {
        inverse: {
          kind: "update",
          id: edit.id,
          patch: {
            mass: before.mass,
            radius: before.radius,
            position: before.position,
            velocity: before.velocity,
            name: before.name,
            colour: before.colour ?? "",
          },
        },
        applied: edit,
      };
    }
  }
}

/**
 * Place a body on a circular orbit of radius `r` about `parentId`.
 *
 * The helper the brief asks for. Circular speed is sqrt(G M / r) about the
 * parent alone, so in a multi-body system the orbit is approximate — which is
 * true of every "circular orbit" in a system with more than two bodies, and
 * the UI says so rather than implying otherwise.
 */
export function circularOrbitBody(
  state: SimState,
  parentId: string,
  radiusAu: number,
  g: number,
  body: Omit<BodyInit, "position" | "velocity">,
): BodyInit {
  const parent = indexOfId(state, parentId);
  if (!(radiusAu > 0) || !Number.isFinite(radiusAu)) {
    throw new EditError("Orbit radius must be a positive number of AU.");
  }
  const parentMass = state.masses[parent];
  if (parentMass <= 0) {
    throw new EditError(
      `"${state.names[parent]}" has no mass, so there is nothing to orbit.`,
    );
  }
  const speed = Math.sqrt((g * (parentMass + body.mass)) / radiusAu);
  const k = parent * 3;
  return {
    ...body,
    position: {
      x: state.positions[k] + radiusAu,
      y: state.positions[k + 1],
      z: state.positions[k + 2],
    },
    velocity: {
      x: state.velocities[k],
      y: state.velocities[k + 1] + speed,
      z: state.velocities[k + 2],
    },
  };
}
