/**
 * Editing a live simulation.
 *
 * The property that matters most is that every edit is EXACTLY invertible:
 * undo has to restore the previous state bit for bit, not something close to
 * it, or a long edit history drifts away from where it started.
 */
import { describe, it, expect } from "vitest";
import { SimState, type BodyInit } from "../../src/sim/state";
import {
  applyEdit as applyEditWithG,
  circularOrbitBody,
  EditError,
  type ScenarioEdit,
} from "../../src/sim/edits";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";

/**
 * Most of these tests do not care about g, so they get the standard one. The
 * ones that DO care pass their own to applyEditWithG directly.
 */
const applyEdit = (state: SimState, edit: ScenarioEdit) =>
  applyEditWithG(state, edit, G_AU3_PER_MSUN_DAY2).inverse;

const body = (overrides: Partial<BodyInit> = {}): BodyInit => ({
  id: "b",
  name: "B",
  mass: 1e-6,
  radius: 1e-4,
  position: { x: 1, y: 0, z: 0 },
  velocity: { x: 0, y: 0.017, z: 0 },
  ...overrides,
});

const start = () =>
  SimState.fromBodies([
    body({
      id: "sun",
      name: "Sun",
      mass: 1,
      radius: 0.005,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    }),
    body({ id: "earth", name: "Earth" }),
  ]);

/** Everything that defines the state, for exact comparison. */
const snapshot = (state: SimState) => ({
  count: state.count,
  positions: [...state.positions.slice(0, state.count * 3)],
  velocities: [...state.velocities.slice(0, state.count * 3)],
  masses: [...state.masses.slice(0, state.count)],
  radii: [...state.radii.slice(0, state.count)],
  flags: [...state.flags.slice(0, state.count)],
  ids: state.ids.slice(0, state.count),
  names: state.names.slice(0, state.count),
  colours: state.colours.slice(0, state.count),
});

describe("add", () => {
  it("adds a body and grows past the original allocation", () => {
    const state = start();
    expect(state.capacity).toBe(2);
    applyEdit(state, { kind: "add", body: body({ id: "mars", name: "Mars" }) });
    expect(state.count).toBe(3);
    expect(state.names[2]).toBe("Mars");
  });

  it("refuses a duplicate id, because ids key labels, focus and undo", () => {
    const state = start();
    expect(() =>
      applyEdit(state, { kind: "add", body: body({ id: "earth" }) }),
    ).toThrow(/already a body with id/);
    expect(state.count).toBe(2);
  });

  it("refuses a body the integrator could not represent", () => {
    const state = start();
    for (const bad of [
      body({ id: "x", mass: Number.NaN }),
      body({ id: "x", mass: -1 }),
      body({ id: "x", radius: 0 }),
      body({ id: "x", position: { x: Infinity, y: 0, z: 0 } }),
      body({ id: "x", velocity: { x: 1e30, y: 0, z: 0 } }),
    ]) {
      expect(() => applyEdit(state, { kind: "add", body: bad })).toThrow(EditError);
    }
    // Nothing was half-applied.
    expect(state.count).toBe(2);
  });
});

describe("remove", () => {
  it("removes a body", () => {
    const state = start();
    applyEdit(state, { kind: "add", body: body({ id: "mars", name: "Mars" }) });
    applyEdit(state, { kind: "remove", id: "earth" });
    expect(state.count).toBe(2);
    expect(state.ids.slice(0, 2)).not.toContain("earth");
  });

  it("refuses to leave fewer than two bodies", () => {
    const state = start();
    expect(() => applyEdit(state, { kind: "remove", id: "earth" })).toThrow(
      /at least two bodies/,
    );
    expect(state.count).toBe(2);
  });

  it("refuses an id that is not there", () => {
    const state = start();
    expect(() => applyEdit(state, { kind: "remove", id: "pluto" })).toThrow(
      /No body with id/,
    );
  });
});

describe("update", () => {
  it("changes only what the patch names", () => {
    const state = start();
    applyEdit(state, { kind: "update", id: "earth", patch: { mass: 5e-6 } });
    expect(state.masses[1]).toBe(5e-6);
    expect(state.radii[1]).toBe(1e-4);
    expect(state.positions[3]).toBe(1);
  });

  it("validates the RESULT, so a partial edit cannot sneak past the checks", () => {
    const state = start();
    expect(() =>
      applyEdit(state, { kind: "update", id: "earth", patch: { radius: -1 } }),
    ).toThrow(/Radius must be greater than zero/);
    expect(state.radii[1]).toBe(1e-4);
  });

  it("turns a body into a test particle when its mass is edited to zero", () => {
    const state = start();
    expect(state.isMassless(1)).toBe(false);
    applyEdit(state, { kind: "update", id: "earth", patch: { mass: 0 } });
    expect(state.isMassless(1)).toBe(true);
  });

  it("stops a test particle being one when it is given mass", () => {
    const state = SimState.fromBodies([
      body({ id: "sun", mass: 1, position: { x: 0, y: 0, z: 0 } }),
      body({ id: "probe", mass: 0, massless: true }),
    ]);
    expect(state.isMassless(1)).toBe(true);
    applyEdit(state, { kind: "update", id: "probe", patch: { mass: 1e-9 } });
    expect(state.isMassless(1)).toBe(false);
  });
});

describe("every edit is exactly invertible", () => {
  const cases: { label: string; edit: ScenarioEdit }[] = [
    { label: "add", edit: { kind: "add", body: body({ id: "mars", name: "Mars" }) } },
    {
      label: "update mass",
      edit: { kind: "update", id: "earth", patch: { mass: 9e-6 } },
    },
    {
      label: "update everything",
      edit: {
        kind: "update",
        id: "earth",
        patch: {
          mass: 2e-6,
          radius: 3e-4,
          position: { x: 1.5, y: -0.2, z: 0.01 },
          velocity: { x: 0.001, y: 0.014, z: -0.0002 },
          name: "Renamed",
          colour: "#ff0000",
        },
      },
    },
  ];

  for (const { label, edit } of cases) {
    it(`${label} then undo restores the state bit for bit`, () => {
      const state = start();
      const before = snapshot(state);
      const inverse = applyEdit(state, edit);
      expect(snapshot(state)).not.toEqual(before);
      applyEdit(state, inverse);
      expect(snapshot(state)).toEqual(before);
    });
  }

  it("remove then undo restores the body, including its flags and colour", () => {
    const state = start();
    applyEdit(state, {
      kind: "add",
      body: body({ id: "probe", name: "Probe", mass: 0, colour: "#7ee787" }),
    });
    const before = snapshot(state);
    const inverse = applyEdit(state, { kind: "remove", id: "probe" });
    applyEdit(state, inverse);
    // removeBody swaps with the last slot, so compare as sets of bodies.
    const sorted = (s: ReturnType<typeof snapshot>) =>
      s.ids
        .map((id, i) => ({
          id,
          name: s.names[i],
          mass: s.masses[i],
          colour: s.colours[i],
          flag: s.flags[i],
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted(snapshot(state))).toEqual(sorted(before));
  });

  it("survives a long chain of edits and undos", () => {
    const state = start();
    const before = snapshot(state);
    const inverses: ScenarioEdit[] = [];
    for (let i = 0; i < 20; i++) {
      inverses.push(
        applyEdit(state, {
          kind: "update",
          id: "earth",
          patch: { mass: 1e-6 * (i + 2) },
        }),
      );
    }
    while (inverses.length > 0) applyEdit(state, inverses.pop() as ScenarioEdit);
    expect(snapshot(state)).toEqual(before);
  });
});

describe("the circular-orbit helper", () => {
  it("produces a body whose speed is the circular speed at that radius", () => {
    const state = start();
    const made = circularOrbitBody(state, "sun", 4, G_AU3_PER_MSUN_DAY2, {
      id: "new",
      name: "New",
      mass: 1e-9,
      radius: 1e-5,
    });
    const expected = Math.sqrt((G_AU3_PER_MSUN_DAY2 * (1 + 1e-9)) / 4);
    expect(made.position.x).toBeCloseTo(4, 12);
    expect(made.velocity.y).toBeCloseTo(expected, 12);
  });

  it("is relative to the parent, not the origin", () => {
    const state = SimState.fromBodies([
      body({
        id: "sun",
        mass: 1,
        position: { x: 10, y: -3, z: 0 },
        velocity: { x: 0.5, y: 0, z: 0 },
      }),
      body({ id: "earth" }),
    ]);
    const made = circularOrbitBody(state, "sun", 2, G_AU3_PER_MSUN_DAY2, {
      id: "new",
      name: "New",
      mass: 0,
      radius: 1e-5,
    });
    expect(made.position.x).toBeCloseTo(12, 12);
    expect(made.position.y).toBeCloseTo(-3, 12);
    // It inherits the parent's motion, or it would be launched sideways.
    expect(made.velocity.x).toBeCloseTo(0.5, 12);
  });

  it("refuses a parent with no mass", () => {
    const state = SimState.fromBodies([
      body({ id: "ghost", mass: 0, position: { x: 0, y: 0, z: 0 } }),
      body({ id: "earth" }),
    ]);
    expect(() =>
      circularOrbitBody(state, "ghost", 1, G_AU3_PER_MSUN_DAY2, {
        id: "new",
        name: "New",
        mass: 1,
        radius: 1,
      }),
    ).toThrow(/nothing to orbit/);
  });

  it("refuses a nonsense radius", () => {
    const state = start();
    for (const radius of [0, -1, Number.NaN]) {
      expect(() =>
        circularOrbitBody(state, "sun", radius, G_AU3_PER_MSUN_DAY2, {
          id: "new",
          name: "New",
          mass: 1e-9,
          radius: 1e-5,
        }),
      ).toThrow(/positive number of AU/);
    }
  });
});

describe("addOrbiting", () => {
  /** A Sun and an Earth, with the Sun displaced so "moved since" is visible. */
  const moving = () => {
    const state = start();
    state.positions[0] = 3;
    state.velocities[1] = 0.005;
    return state;
  };

  it("sizes the orbit against the simulation's own g, not a hardcoded one", () => {
    // A scenario that overrides g is the case a UI-side copy of the formula
    // gets wrong: it would compute the same speed whatever g the run uses.
    const doubled = G_AU3_PER_MSUN_DAY2 * 4;
    const state = start();
    applyEditWithG(
      state,
      {
        kind: "addOrbiting",
        parentId: "sun",
        radiusAu: 4,
        body: { id: "new", name: "New", mass: 1e-9, radius: 1e-5 },
      },
      doubled,
    );
    const i = state.ids.indexOf("new");
    const speed = Math.hypot(
      state.velocities[i * 3],
      state.velocities[i * 3 + 1],
      state.velocities[i * 3 + 2],
    );
    // Twice the standard circular speed, because g is four times as large.
    expect(speed).toBeCloseTo(Math.sqrt((doubled * (1 + 1e-9)) / 4), 12);
  });

  it("places the body relative to the parent wherever the parent now is", () => {
    const state = moving();
    applyEdit(state, {
      kind: "addOrbiting",
      parentId: "sun",
      radiusAu: 2,
      body: { id: "new", name: "New", mass: 1e-9, radius: 1e-5 },
    });
    const i = state.ids.indexOf("new");
    expect(state.positions[i * 3]).toBeCloseTo(5, 12); // parent at x=3, plus 2
    // And it inherits the parent's motion, so the orbit is about the parent
    // rather than about the origin.
    expect(state.velocities[i * 3 + 1]).toBeGreaterThan(0.005);
  });

  it("comes back as a resolved `add`, so redo reproduces the same orbit", () => {
    // This is the whole reason the resolved form is reported. Replaying the
    // ORIGINAL request after the parent has moved would put the body
    // somewhere else; replaying `applied` puts it back exactly.
    const state = moving();
    const request: ScenarioEdit = {
      kind: "addOrbiting",
      parentId: "sun",
      radiusAu: 2,
      body: { id: "new", name: "New", mass: 1e-9, radius: 1e-5 },
    };
    /** The added body's own numbers — the parent is moved, so it will differ. */
    const added = (s: SimState) => {
      const i = s.ids.indexOf("new");
      return [
        ...s.positions.slice(i * 3, i * 3 + 3),
        ...s.velocities.slice(i * 3, i * 3 + 3),
      ];
    };

    const first = applyEditWithG(state, request, G_AU3_PER_MSUN_DAY2);
    expect(first.applied.kind).toBe("add");
    const afterAdd = added(state);

    // Undo, move the parent, then redo the RESOLVED edit.
    applyEdit(state, first.inverse);
    state.positions[0] = 47;
    applyEdit(state, first.applied);
    expect(added(state)).toEqual(afterAdd);

    // And to show the test would catch the bug it exists for: replaying the
    // ORIGINAL request now lands somewhere else entirely.
    applyEdit(state, { kind: "remove", id: "new" });
    applyEdit(state, request);
    expect(added(state)).not.toEqual(afterAdd);
  });

  it("refuses a duplicate id before computing anything", () => {
    const state = start();
    expect(() =>
      applyEdit(state, {
        kind: "addOrbiting",
        parentId: "sun",
        radiusAu: 2,
        body: { id: "earth", name: "Clash", mass: 1e-9, radius: 1e-5 },
      }),
    ).toThrow(/already a body with id/);
    expect(state.count).toBe(2);
  });

  it("refuses an unknown parent, a massless one, and a bad radius", () => {
    const state = start();
    const add = (parentId: string, radiusAu: number) =>
      applyEdit(state, {
        kind: "addOrbiting",
        parentId,
        radiusAu,
        body: { id: "new", name: "New", mass: 1e-9, radius: 1e-5 },
      });
    expect(() => add("nobody", 2)).toThrow(EditError);
    expect(() => add("sun", 0)).toThrow(/positive number of AU/);
    expect(() => add("sun", Number.NaN)).toThrow(/positive number of AU/);
    expect(state.count).toBe(2);
  });
});

describe("scale", () => {
  /** Earth at x = 1 moving at 0.017, about a Sun at the origin. */
  const system = () => start();

  it("doubles a mass and leaves everything else exactly alone", () => {
    const state = system();
    const before = snapshot(state);
    applyEdit(state, { kind: "scale", id: "earth", mass: 2 });
    expect(state.masses[1]).toBe(before.masses[1] * 2);
    expect([...state.positions.slice(0, 6)]).toEqual(before.positions);
    expect([...state.velocities.slice(0, 6)]).toEqual(before.velocities);
  });

  it("halves the separation FROM THE PARENT, not from the origin", () => {
    // The distinction that makes this edit worth having: in a frame where the
    // parent is not at the origin, scaling about the origin would move the
    // body somewhere with no physical meaning.
    const state = system();
    state.positions[0] = 10; // Sun at x = 10
    state.positions[3] = 11; // Earth at x = 11, so 1 AU out
    applyEdit(state, {
      kind: "scale",
      id: "earth",
      relativeTo: "sun",
      separation: 0.5,
    });
    expect(state.positions[3]).toBeCloseTo(10.5, 12);
  });

  it("scales speed relative to the parent, so a shared drift is kept", () => {
    const state = system();
    state.velocities[1] = 0.003; // the Sun drifts
    state.velocities[4] = 0.02; // the Earth: 0.017 relative to it
    applyEdit(state, {
      kind: "scale",
      id: "earth",
      relativeTo: "sun",
      speed: 2,
    });
    // 0.003 + 2 * (0.02 - 0.003)
    expect(state.velocities[4]).toBeCloseTo(0.037, 12);
  });

  it("is exactly invertible, like every other edit", () => {
    const state = system();
    const before = snapshot(state);
    const inverse = applyEdit(state, {
      kind: "scale",
      id: "earth",
      relativeTo: "sun",
      mass: 3,
      separation: 0.5,
      speed: 1.4142135623730951,
    });
    expect(snapshot(state)).not.toEqual(before);
    applyEdit(state, inverse);
    expect(snapshot(state)).toEqual(before);
  });

  it("resolves to an absolute update, so redo does not compound", () => {
    // Applying "half the distance" twice would quarter it. Redo must replay
    // the resolved absolute position instead.
    const state = system();
    const first = applyEditWithG(
      state,
      { kind: "scale", id: "earth", relativeTo: "sun", separation: 0.5 },
      G_AU3_PER_MSUN_DAY2,
    );
    expect(first.applied.kind).toBe("update");
    const afterScale = state.positions[3];

    applyEdit(state, first.inverse);
    applyEdit(state, first.applied);
    expect(state.positions[3]).toBe(afterScale);
  });

  it("refuses a factor that is not a finite number", () => {
    const state = system();
    expect(() =>
      applyEdit(state, { kind: "scale", id: "earth", mass: Number.NaN }),
    ).toThrow(/finite number/);
    // And a factor that would produce an invalid body is caught by the same
    // validation an ordinary update faces.
    expect(() => applyEdit(state, { kind: "scale", id: "earth", mass: -1 })).toThrow(
      /negative/,
    );
  });

  it("refuses an unknown body, and an unknown parent", () => {
    const state = system();
    expect(() => applyEdit(state, { kind: "scale", id: "pluto", mass: 2 })).toThrow(
      /No body with id/,
    );
    expect(() =>
      applyEdit(state, {
        kind: "scale",
        id: "earth",
        relativeTo: "pluto",
        separation: 2,
      }),
    ).toThrow(/No body with id/);
  });
});

describe("order", () => {
  /** Five bodies, so there is a genuine middle to remove from. */
  const five = () =>
    SimState.fromBodies(
      ["a", "b", "c", "d", "e"].map((id, i) =>
        body({ id, name: id.toUpperCase(), position: { x: i, y: 0, z: 0 } }),
      ),
    );

  it("removing from the middle does not reshuffle the rest", () => {
    // The engine's collision path swaps the last body into the hole, which is
    // right there and wrong here: an edit has an undo, and a list that
    // rearranges itself under the person is not an undo.
    const state = five();
    applyEdit(state, { kind: "remove", id: "c" });
    expect(state.ids.slice(0, state.count)).toEqual(["a", "b", "d", "e"]);
  });

  it("undoing a removal puts the body back where it was", () => {
    const state = five();
    const inverse = applyEdit(state, { kind: "remove", id: "b" });
    applyEdit(state, inverse);
    expect(state.ids.slice(0, state.count)).toEqual(["a", "b", "c", "d", "e"]);
    expect([...state.positions.slice(0, 15)]).toEqual([
      0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0,
    ]);
  });

  it("restores the first and the last correctly too", () => {
    for (const id of ["a", "e"]) {
      const state = five();
      const before = snapshot(state);
      applyEdit(state, applyEdit(state, { kind: "remove", id }));
      expect(snapshot(state)).toEqual(before);
    }
  });

  it("a plain add still appends", () => {
    const state = five();
    applyEdit(state, { kind: "add", body: body({ id: "f", name: "F" }) });
    expect(state.ids.slice(0, state.count)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("an index beyond the end appends rather than throwing", () => {
    const state = five();
    applyEdit(state, { kind: "add", body: body({ id: "f", name: "F" }), index: 99 });
    expect(state.ids[state.count - 1]).toBe("f");
  });
});
