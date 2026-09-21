/**
 * Collision detection and momentum-conserving merge.
 *
 * Two properties are deliberate, because each is a defect measured in a
 * comparable implementation (artifacts/03-current-site-audit.md §4.2, where a
 * single merge was observed to destroy 100% of linear momentum):
 *
 *   1. THE MERGE CONSERVES MOMENTUM AND USES THE CENTRE OF MASS.
 *        M = m₁ + m₂
 *        v = (m₁v₁ + m₂v₂) / M      ← linear momentum is conserved exactly
 *        x = (m₁x₁ + m₂x₂) / M      ← the survivor sits at the centre of mass
 *        r = (r₁³ + r₂³)^(1/3)      ← volume conserved, so density is preserved
 *
 *      Kinetic energy DECREASES. That is correct: a merge is perfectly
 *      inelastic, and the lost kinetic energy is what would physically go into
 *      heat and deformation. Tests assert momentum conserved and kinetic energy
 *      non-increasing — asserting energy conservation here would be wrong.
 *
 *   2. DETECTION AND APPLICATION ARE SEPARATE PASSES. Pairs are collected
 *      first, then applied. Nothing ever splices the body array while a loop is
 *      iterating over it, so no body can be skipped or read after removal.
 *
 * Simultaneous multi-body collisions are handled by grouping colliding pairs
 * into clusters with union-find and merging each cluster in one operation, so
 * the result does not depend on pair ordering.
 */
import type { SimState } from "./state";

/**
 * What happens when two bodies touch.
 *
 *   merge         perfectly inelastic. Momentum conserved, kinetic energy
 *                 decreases — the loss is what physically becomes heat and
 *                 deformation.
 *   elastic       perfectly restituting. Momentum AND kinetic energy both
 *                 conserved; the bodies bounce and both survive.
 *   pass-through  no contact response at all. Gravity still acts, so bodies
 *                 fall through one another. Useful for point-mass questions,
 *                 and honest about being unphysical for real spheres.
 */
export const COLLISION_MODES = ["merge", "elastic", "pass-through"] as const;
export type CollisionMode = (typeof COLLISION_MODES)[number];

export interface CollisionModeInfo {
  readonly mode: CollisionMode;
  readonly label: string;
  /** What a reader should expect the conservation readouts to do. */
  readonly conserves: string;
}

export const COLLISION_MODE_INFO: readonly CollisionModeInfo[] = [
  {
    mode: "merge",
    label: "Merge",
    conserves:
      "Momentum is conserved exactly. Kinetic energy DROPS, because a merge is " +
      "perfectly inelastic — expect the energy readout to step down.",
  },
  {
    mode: "elastic",
    label: "Bounce",
    conserves:
      "Momentum and kinetic energy are both conserved. Bodies rebound and both " +
      "survive, so the body count never changes.",
  },
  {
    mode: "pass-through",
    label: "Pass through",
    conserves:
      "Nothing is applied on contact, so bodies fall through each other. " +
      "Gravity still acts, and at very close range it becomes enormous unless " +
      "softening is switched on.",
  },
];

export interface CollisionEvent {
  /** Names of every body absorbed into the survivor. */
  absorbed: string[];
  survivor: string;
  /** Mass of the merged body. */
  mass: number;
}

/** Union-find over body indices. */
function findRoot(parent: Int32Array, i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root];
  // Path compression.
  let node = i;
  while (parent[node] !== root) {
    const next = parent[node];
    parent[node] = root;
    node = next;
  }
  return root;
}

/**
 * Perfectly elastic response for every approaching overlapping pair.
 *
 * Along the line of centres, with n the unit vector from i to j:
 *
 *   J = -(1 + e) (v_rel . n) / (1/mi + 1/mj),   e = 1
 *   vi -= (J / mi) n        vj += (J / mj) n
 *
 * Momentum is conserved by construction: the impulses are equal and opposite.
 * At e = 1 kinetic energy is conserved too, which is the standard result and
 * is asserted in tests rather than assumed.
 *
 * A pair that is already SEPARATING is skipped. Without that, two bodies that
 * remain overlapped for several steps would have the impulse applied again
 * and again and gain energy from nothing.
 *
 * Multiple simultaneous contacts are resolved pairwise in index order. That is
 * an approximation — a true simultaneous three-body contact is not a sequence
 * of two-body ones — and it is the standard one; it conserves momentum
 * exactly either way.
 */
function resolveElastic(state: SimState): void {
  const { positions, velocities, masses, radii, count } = state;
  for (let i = 0; i < count; i++) {
    if (state.isMassless(i)) continue;
    const i3 = i * 3;
    for (let j = i + 1; j < count; j++) {
      if (state.isMassless(j)) continue;
      const j3 = j * 3;
      const dx = positions[j3] - positions[i3];
      const dy = positions[j3 + 1] - positions[i3 + 1];
      const dz = positions[j3 + 2] - positions[i3 + 2];
      const contact = radii[i] + radii[j];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared >= contact * contact || distanceSquared === 0) continue;

      const distance = Math.sqrt(distanceSquared);
      const nx = dx / distance;
      const ny = dy / distance;
      const nz = dz / distance;

      const rvx = velocities[j3] - velocities[i3];
      const rvy = velocities[j3 + 1] - velocities[i3 + 1];
      const rvz = velocities[j3 + 2] - velocities[i3 + 2];
      const approach = rvx * nx + rvy * ny + rvz * nz;
      if (approach >= 0) continue; // already separating

      const mi = masses[i];
      const mj = masses[j];
      const inverseMassSum = 1 / mi + 1 / mj;
      if (!Number.isFinite(inverseMassSum) || inverseMassSum === 0) continue;
      const impulse = (-2 * approach) / inverseMassSum;

      velocities[i3] -= (impulse / mi) * nx;
      velocities[i3 + 1] -= (impulse / mi) * ny;
      velocities[i3 + 2] -= (impulse / mi) * nz;
      velocities[j3] += (impulse / mj) * nx;
      velocities[j3 + 1] += (impulse / mj) * ny;
      velocities[j3 + 2] += (impulse / mj) * nz;
    }
  }
}

/**
 * Apply the contact response for `mode`.
 *
 * Returns one event per merge performed, which is empty for every mode but
 * "merge" — elastic collisions remove nothing, so there is nothing to report.
 */
export function resolveCollisions(
  state: SimState,
  mode: CollisionMode = "merge",
): CollisionEvent[] {
  if (mode === "pass-through") return [];
  if (mode === "elastic") {
    resolveElastic(state);
    return [];
  }

  const { positions, velocities, masses, radii, count } = state;
  if (count < 2) return [];

  // Pass 1: detect. Each unordered pair is examined exactly once.
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;

  let anyCollision = false;

  for (let i = 0; i < count; i++) {
    // Massless test particles pass through everything.
    if (state.isMassless(i)) continue;
    const i3 = i * 3;
    for (let j = i + 1; j < count; j++) {
      if (state.isMassless(j)) continue;
      const j3 = j * 3;
      const dx = positions[j3] - positions[i3];
      const dy = positions[j3 + 1] - positions[i3 + 1];
      const dz = positions[j3 + 2] - positions[i3 + 2];
      const contact = radii[i] + radii[j];
      if (dx * dx + dy * dy + dz * dz < contact * contact) {
        const ri = findRoot(parent, i);
        const rj = findRoot(parent, j);
        if (ri !== rj) {
          parent[Math.max(ri, rj)] = Math.min(ri, rj);
          anyCollision = true;
        }
      }
    }
  }

  if (!anyCollision) return [];

  // Pass 2: group by cluster root.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    if (state.isMassless(i)) continue;
    const root = findRoot(parent, i);
    const existing = clusters.get(root);
    if (existing) existing.push(i);
    else clusters.set(root, [i]);
  }

  const events: CollisionEvent[] = [];
  const toRemove: number[] = [];

  // Pass 3: apply. Only writes; no structural change yet.
  for (const members of clusters.values()) {
    if (members.length < 2) continue;

    // The most massive member survives, so the merged body keeps a stable
    // identity for labels and camera focus.
    let survivor = members[0];
    for (const m of members) if (masses[m] > masses[survivor]) survivor = m;

    let totalMass = 0;
    let px = 0;
    let py = 0;
    let pz = 0; // Σ m·x
    let mvx = 0;
    let mvy = 0;
    let mvz = 0; // Σ m·v
    let volume = 0;
    const absorbed: string[] = [];

    for (const m of members) {
      const k = m * 3;
      const mass = masses[m];
      totalMass += mass;
      px += mass * positions[k];
      py += mass * positions[k + 1];
      pz += mass * positions[k + 2];
      mvx += mass * velocities[k];
      mvy += mass * velocities[k + 1];
      mvz += mass * velocities[k + 2];
      volume += radii[m] * radii[m] * radii[m];
      if (m !== survivor) {
        absorbed.push(state.names[m]);
        toRemove.push(m);
      }
    }

    const s3 = survivor * 3;
    if (totalMass > 0) {
      positions[s3] = px / totalMass;
      positions[s3 + 1] = py / totalMass;
      positions[s3 + 2] = pz / totalMass;
      velocities[s3] = mvx / totalMass;
      velocities[s3 + 1] = mvy / totalMass;
      velocities[s3 + 2] = mvz / totalMass;
    }
    masses[survivor] = totalMass;
    radii[survivor] = Math.cbrt(volume);

    events.push({ absorbed, survivor: state.names[survivor], mass: totalMass });
  }

  // Pass 4: remove absorbed bodies, highest index first so that the
  // swap-with-last compaction never disturbs a still-pending lower index.
  toRemove.sort((a, b) => b - a);
  for (const index of toRemove) state.removeBody(index);

  return events;
}
