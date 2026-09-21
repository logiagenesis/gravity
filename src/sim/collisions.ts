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
 * Detect overlapping bodies and merge each overlapping cluster.
 * Returns one event per merge performed.
 */
export function resolveCollisions(state: SimState): CollisionEvent[] {
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
