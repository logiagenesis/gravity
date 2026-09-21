/**
 * Structure-of-arrays body state.
 *
 * Every per-body quantity lives in one contiguous Float64Array, so:
 *   - memory access in the force loop is sequential and cache-friendly,
 *   - stepping allocates nothing,
 *   - buffers transfer to and from the worker with zero copying.
 *
 * Vectors are interleaved: index i occupies [3i, 3i+1, 3i+2].
 */
import { FLAG_ACTIVE, FLAG_MASSLESS } from "./constants";

export interface BodyInit {
  id: string;
  name: string;
  mass: number;
  radius: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  massless?: boolean;
  colour?: string;
}

export class SimState {
  /**
   * Number of slots allocated (active plus inactive).
   *
   * Not readonly, because adding a body past the allocation GROWS the arrays
   * rather than throwing. Editing a scenario is a first-class operation, and
   * a simulator that refuses to add a body because of how it allocated its
   * buffers would be exposing an implementation detail as a limit.
   */
  capacity: number;
  /** Number of slots in use. Merged bodies are compacted out, so this shrinks. */
  count: number;

  /*
   * Re-assigned on growth, so not readonly. Nothing outside this class holds
   * a long-lived reference to them: snapshots COPY into a pooled transfer
   * buffer rather than handing these out (src/worker/simulation.worker.ts),
   * which is what makes growing them safe.
   */
  positions: Float64Array;
  velocities: Float64Array;
  accelerations: Float64Array;
  masses: Float64Array;
  radii: Float64Array;
  flags: Uint8Array;

  /** Parallel metadata. Not transferred to the renderer each frame. */
  ids: string[];
  names: string[];
  colours: string[];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.count = 0;
    this.positions = new Float64Array(capacity * 3);
    this.velocities = new Float64Array(capacity * 3);
    this.accelerations = new Float64Array(capacity * 3);
    this.masses = new Float64Array(capacity);
    this.radii = new Float64Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.ids = new Array<string>(capacity).fill("");
    this.names = new Array<string>(capacity).fill("");
    this.colours = new Array<string>(capacity).fill("");
  }

  static fromBodies(bodies: readonly BodyInit[]): SimState {
    const state = new SimState(bodies.length);
    for (const body of bodies) state.addBody(body);
    return state;
  }

  /**
   * Reallocate to at least `needed` slots, preserving every value.
   *
   * Growth is geometric so that adding bodies one at a time is amortised
   * linear rather than quadratic.
   */
  private grow(needed: number): void {
    if (needed <= this.capacity) return;
    const capacity = Math.max(needed, Math.ceil(this.capacity * 1.5) + 8);

    const copyFloat = (source: Float64Array, stride: number) => {
      const next = new Float64Array(capacity * stride);
      next.set(source.subarray(0, this.count * stride));
      return next;
    };

    this.positions = copyFloat(this.positions, 3);
    this.velocities = copyFloat(this.velocities, 3);
    this.accelerations = copyFloat(this.accelerations, 3);
    this.masses = copyFloat(this.masses, 1);
    this.radii = copyFloat(this.radii, 1);

    const flags = new Uint8Array(capacity);
    flags.set(this.flags.subarray(0, this.count));
    this.flags = flags;

    const pad = (source: string[]) => {
      const next = new Array<string>(capacity).fill("");
      for (let i = 0; i < this.count; i++) next[i] = source[i];
      return next;
    };
    this.ids = pad(this.ids);
    this.names = pad(this.names);
    this.colours = pad(this.colours);

    this.capacity = capacity;
  }

  addBody(body: BodyInit): number {
    this.grow(this.count + 1);
    const i = this.count++;
    const k = i * 3;
    this.positions[k] = body.position.x;
    this.positions[k + 1] = body.position.y;
    this.positions[k + 2] = body.position.z;
    this.velocities[k] = body.velocity.x;
    this.velocities[k + 1] = body.velocity.y;
    this.velocities[k + 2] = body.velocity.z;
    this.masses[i] = body.mass;
    this.radii[i] = body.radius;
    // A body is massless if flagged, or if its mass is genuinely zero.
    const massless = body.massless === true || body.mass === 0;
    this.flags[i] = FLAG_ACTIVE | (massless ? FLAG_MASSLESS : 0);
    this.ids[i] = body.id;
    this.names[i] = body.name;
    // Empty means "the scenario did not say", which is different from white.
    // The renderer decides what an unspecified body should look like, because
    // that depends on whether it is a star (src/render/scene.ts).
    this.colours[i] = body.colour ?? "";
    return i;
  }

  isMassless(i: number): boolean {
    return (this.flags[i] & FLAG_MASSLESS) !== 0;
  }

  /**
   * Mark a body as a test particle, or stop it being one.
   *
   * Kept in step with the mass by the edit layer: a body edited to zero mass
   * becomes massless, and one given mass stops being massless. Without that,
   * a "massless" body could silently gravitate, or a massive one could
   * silently stop.
   */
  setMassless(i: number, massless: boolean): void {
    this.flags[i] = massless
      ? this.flags[i] | FLAG_MASSLESS
      : this.flags[i] & ~FLAG_MASSLESS;
  }

  /**
   * Remove a body by swapping the last element into its slot.
   *
   * Callers must not hold indices across this call. The collision system
   * deliberately collects every pair first and only then applies removals,
   * so no loop is ever iterating over a mutating array.
   */
  removeBody(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      const a = i * 3;
      const b = last * 3;
      for (let c = 0; c < 3; c++) {
        this.positions[a + c] = this.positions[b + c];
        this.velocities[a + c] = this.velocities[b + c];
        this.accelerations[a + c] = this.accelerations[b + c];
      }
      this.masses[i] = this.masses[last];
      this.radii[i] = this.radii[last];
      this.flags[i] = this.flags[last];
      this.ids[i] = this.ids[last];
      this.names[i] = this.names[last];
      this.colours[i] = this.colours[last];
    }
    this.count = last;
  }

  /**
   * Add a body at a specific position in the order.
   *
   * This exists so that undoing a removal is exact. Appending the body back
   * restores the physics but not the arrangement: delete Venus from the middle
   * of the inner solar system, press undo, and it reappears after Mars. The
   * index travels in the inverse edit, so undo puts it back where it was.
   */
  insertBody(body: BodyInit, index: number): void {
    this.addBody(body);
    const last = this.count - 1;
    const target = Math.max(0, Math.min(index, last));
    if (target === last) return;

    const k = last * 3;
    const position = [this.positions[k], this.positions[k + 1], this.positions[k + 2]];
    const velocity = [
      this.velocities[k],
      this.velocities[k + 1],
      this.velocities[k + 2],
    ];
    const acceleration = [
      this.accelerations[k],
      this.accelerations[k + 1],
      this.accelerations[k + 2],
    ];
    const mass = this.masses[last];
    const radius = this.radii[last];
    const flag = this.flags[last];
    const id = this.ids[last];
    const name = this.names[last];
    const colour = this.colours[last];

    for (let j = last; j > target; j--) {
      const a = j * 3;
      const b = (j - 1) * 3;
      for (let c = 0; c < 3; c++) {
        this.positions[a + c] = this.positions[b + c];
        this.velocities[a + c] = this.velocities[b + c];
        this.accelerations[a + c] = this.accelerations[b + c];
      }
      this.masses[j] = this.masses[j - 1];
      this.radii[j] = this.radii[j - 1];
      this.flags[j] = this.flags[j - 1];
      this.ids[j] = this.ids[j - 1];
      this.names[j] = this.names[j - 1];
      this.colours[j] = this.colours[j - 1];
    }

    const t = target * 3;
    for (let c = 0; c < 3; c++) {
      this.positions[t + c] = position[c];
      this.velocities[t + c] = velocity[c];
      this.accelerations[t + c] = acceleration[c];
    }
    this.masses[target] = mass;
    this.radii[target] = radius;
    this.flags[target] = flag;
    this.ids[target] = id;
    this.names[target] = name;
    this.colours[target] = colour;
  }

  /**
   * Remove a body, keeping the order of the rest.
   *
   * `removeBody` swaps the last body into the hole, which is O(1) and right
   * for collisions: merges happen inside the step loop, possibly many per
   * frame, and nothing about the physics depends on the order.
   *
   * An EDIT is different. It is a user action with an undo, and undo has to
   * restore what the person was looking at. With the swap, deleting Mars and
   * undoing gave back the same physics in a different order, so the body list
   * and table reshuffled under them for no reason they could see. Editing is
   * rare and this is one pass over the arrays, so the cost is nothing.
   */
  removeBodyPreservingOrder(i: number): void {
    for (let j = i; j < this.count - 1; j++) {
      const a = j * 3;
      const b = (j + 1) * 3;
      for (let c = 0; c < 3; c++) {
        this.positions[a + c] = this.positions[b + c];
        this.velocities[a + c] = this.velocities[b + c];
        this.accelerations[a + c] = this.accelerations[b + c];
      }
      this.masses[j] = this.masses[j + 1];
      this.radii[j] = this.radii[j + 1];
      this.flags[j] = this.flags[j + 1];
      this.ids[j] = this.ids[j + 1];
      this.names[j] = this.names[j + 1];
      this.colours[j] = this.colours[j + 1];
    }
    this.count -= 1;
  }

  /** Deep copy. Used by tests and by deterministic-replay checks. */
  clone(): SimState {
    const copy = new SimState(this.capacity);
    copy.count = this.count;
    copy.positions.set(this.positions);
    copy.velocities.set(this.velocities);
    copy.accelerations.set(this.accelerations);
    copy.masses.set(this.masses);
    copy.radii.set(this.radii);
    copy.flags.set(this.flags);
    for (let i = 0; i < this.capacity; i++) {
      copy.ids[i] = this.ids[i];
      copy.names[i] = this.names[i];
      copy.colours[i] = this.colours[i];
    }
    return copy;
  }

  /** Total mass of active bodies. */
  totalMass(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) m += this.masses[i];
    return m;
  }
}
