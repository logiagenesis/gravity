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
  /** Number of slots allocated (active plus inactive). */
  readonly capacity: number;
  /** Number of slots in use. Merged bodies are compacted out, so this shrinks. */
  count: number;

  readonly positions: Float64Array;
  readonly velocities: Float64Array;
  readonly accelerations: Float64Array;
  readonly masses: Float64Array;
  readonly radii: Float64Array;
  readonly flags: Uint8Array;

  /** Parallel metadata. Not transferred to the renderer each frame. */
  readonly ids: string[];
  readonly names: string[];
  readonly colours: string[];

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

  addBody(body: BodyInit): number {
    if (this.count >= this.capacity) {
      throw new RangeError(
        `SimState capacity ${this.capacity} exceeded; cannot add "${body.name}".`,
      );
    }
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
    this.colours[i] = body.colour ?? "#ffffff";
    return i;
  }

  isMassless(i: number): boolean {
    return (this.flags[i] & FLAG_MASSLESS) !== 0;
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
