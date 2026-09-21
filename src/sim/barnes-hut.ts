/**
 * Barnes-Hut octree (Barnes & Hut, "A hierarchical O(N log N) force-calculation
 * algorithm", Nature 324, 446-449, 1986).
 *
 * Three properties are deliberate, because each is a defect measured in a
 * comparable implementation (artifacts/03-current-site-audit.md §4):
 *
 *   1. ROOT BOUNDS ARE DYNAMIC. The root cell is recomputed from the bodies'
 *      actual extent on every build, then padded. A body can therefore never
 *      fall outside the tree and be silently dropped. A fixed root box makes
 *      distant bodies contribute *exactly zero* force, which is far worse than
 *      an approximation error because nothing about the output looks wrong.
 *
 *   2. CENTRE-OF-MASS ACCUMULATORS START AT ZERO. Seeding them with anything
 *      else (for instance a cell's corner) leaves a spurious offset that the
 *      final divide by total mass cannot remove.
 *
 *   3. RECURSION IS DEPTH-LIMITED. At MAX_DEPTH a cell stops subdividing and
 *      becomes a bucket holding however many bodies it contains. Without this,
 *      two near-coincident bodies subdivide until the stack overflows.
 *
 * Layout is a flat node pool with an in-place index permutation, so a steady
 * state rebuild allocates nothing.
 */
import type { SimState } from "./state";

/** Deepest subdivision level. 2^-24 of the root span is far below any useful resolution. */
export const MAX_DEPTH = 24;

/** Fractional padding applied to the root cell so boundary bodies sit strictly inside. */
const ROOT_PADDING = 1e-6;

const CHILDREN_PER_NODE = 8;

export interface Octree {
  /** Number of nodes in use. */
  nodeCount: number;
  /** Centre of mass per node, interleaved xyz. */
  com: Float64Array;
  /** Total mass per node. */
  mass: Float64Array;
  /** Cell half-width per node (cells are cubic). */
  half: Float64Array;
  /** Index of the first child; -1 for a leaf. Children are contiguous. */
  firstChild: Int32Array;
  /** For a leaf: offset into `order`. */
  bodyStart: Int32Array;
  /** For a leaf: number of bodies. */
  bodyCount: Int32Array;
  /** Permutation of body indices, partitioned by cell. */
  order: Int32Array;
}

interface Pool extends Octree {
  capacityNodes: number;
  centre: Float64Array;
  scratch: Int32Array;
}

let pool: Pool | null = null;

function ensurePool(bodyCount: number): Pool {
  // A depth-limited octree over n bodies needs O(n) nodes; this bound is ample
  // and the pool is reused across builds.
  const wantNodes = Math.max(64, bodyCount * 8 + 64);
  if (
    pool === null ||
    pool.capacityNodes < wantNodes ||
    pool.order.length < bodyCount
  ) {
    pool = {
      capacityNodes: wantNodes,
      nodeCount: 0,
      com: new Float64Array(wantNodes * 3),
      mass: new Float64Array(wantNodes),
      half: new Float64Array(wantNodes),
      centre: new Float64Array(wantNodes * 3),
      firstChild: new Int32Array(wantNodes),
      bodyStart: new Int32Array(wantNodes),
      bodyCount: new Int32Array(wantNodes),
      order: new Int32Array(Math.max(1, bodyCount)),
      scratch: new Int32Array(Math.max(1, bodyCount)),
    };
  }
  return pool;
}

function allocNode(p: Pool): number {
  if (p.nodeCount >= p.capacityNodes) {
    // Grow. Rare: only if a pathological distribution needs more nodes.
    const bigger = p.capacityNodes * 2;
    const grow = (a: Float64Array, stride: number) => {
      const next = new Float64Array(bigger * stride);
      next.set(a);
      return next;
    };
    const growI = (a: Int32Array) => {
      const next = new Int32Array(bigger);
      next.set(a);
      return next;
    };
    const grown: Pool = {
      ...p,
      capacityNodes: bigger,
      com: grow(p.com, 3),
      centre: grow(p.centre, 3),
      mass: grow(p.mass, 1),
      half: grow(p.half, 1),
      firstChild: growI(p.firstChild),
      bodyStart: growI(p.bodyStart),
      bodyCount: growI(p.bodyCount),
    };
    Object.assign(p, grown);
  }
  const n = p.nodeCount++;
  p.com[n * 3] = 0;
  p.com[n * 3 + 1] = 0;
  p.com[n * 3 + 2] = 0; // rule 2: accumulators start at zero
  p.mass[n] = 0;
  p.firstChild[n] = -1;
  p.bodyStart[n] = 0;
  p.bodyCount[n] = 0;
  return n;
}

/**
 * Build an octree over the massive bodies of `state`.
 * Returns null when there is no mass to build from.
 *
 * IMPORTANT: the returned tree is backed by a SHARED, REUSED node pool. It is
 * valid only until the next `buildOctree` call. Do not hold two trees at once
 * and do not retain one across a step — read what you need and discard it.
 * This is the price of rebuilding every step without allocating, and the
 * force loop (which builds then immediately traverses) is the intended use.
 */
export function buildOctree(state: SimState): Octree | null {
  const { positions, masses, count } = state;

  const p = ensurePool(count);
  p.nodeCount = 0;

  // Collect massive bodies only. Massless test particles are targets of gravity,
  // never sources, so they must not enter the tree at all.
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (state.isMassless(i) || masses[i] <= 0) continue;
    p.order[n++] = i;
  }
  if (n === 0) return null;

  // Rule 1: root bounds from the bodies' actual extent.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const i3 = p.order[k] * 3;
    const x = positions[i3];
    const y = positions[i3 + 1];
    const z = positions[i3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  // Guard against non-finite coordinates producing a non-finite tree.
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  // Cubic root cell, padded so bodies on the boundary sit strictly inside.
  // The floor keeps a single body or a set of coincident bodies well-defined.
  const half = Math.max(span * 0.5 * (1 + ROOT_PADDING), 1e-12);

  const root = allocNode(p);
  p.centre[root * 3] = cx;
  p.centre[root * 3 + 1] = cy;
  p.centre[root * 3 + 2] = cz;
  p.half[root] = half;
  p.bodyStart[root] = 0;
  p.bodyCount[root] = n;

  subdivide(p, root, 0, state);
  computeMassDistribution(p, root, state);

  return p;
}

/** Octant index from a body's position relative to a cell centre. */
function octantOf(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  return (x >= cx ? 1 : 0) | (y >= cy ? 2 : 0) | (z >= cz ? 4 : 0);
}

/**
 * Partition this node's slice of `order` into eight contiguous octant groups
 * and recurse. Partitioning is a counting sort through the scratch buffer, so
 * it allocates nothing.
 */
function subdivide(p: Pool, node: number, depth: number, state: SimState): void {
  const n = p.bodyCount[node];

  // Rule 3: stop at the depth limit and keep the bodies as a bucket leaf.
  if (n <= 1 || depth >= MAX_DEPTH) return;

  const start = p.bodyStart[node];
  const cx = p.centre[node * 3];
  const cy = p.centre[node * 3 + 1];
  const cz = p.centre[node * 3 + 2];
  const { positions } = state;

  const counts = new Int32Array(CHILDREN_PER_NODE);
  for (let k = 0; k < n; k++) {
    const i3 = p.order[start + k] * 3;
    counts[octantOf(positions[i3], positions[i3 + 1], positions[i3 + 2], cx, cy, cz)]++;
  }

  // If every body lands in the same octant we would recurse without splitting.
  // That is safe because the depth limit terminates it, and it is the correct
  // behaviour: the cell genuinely does contain them all.
  const offsets = new Int32Array(CHILDREN_PER_NODE);
  let running = 0;
  for (let o = 0; o < CHILDREN_PER_NODE; o++) {
    offsets[o] = running;
    running += counts[o];
  }

  const cursor = offsets.slice();
  for (let k = 0; k < n; k++) {
    const body = p.order[start + k];
    const i3 = body * 3;
    const o = octantOf(positions[i3], positions[i3 + 1], positions[i3 + 2], cx, cy, cz);
    p.scratch[cursor[o]++] = body;
  }
  for (let k = 0; k < n; k++) p.order[start + k] = p.scratch[k];

  const childHalf = p.half[node] * 0.5;
  const first = p.nodeCount;
  for (let o = 0; o < CHILDREN_PER_NODE; o++) allocNode(p);
  p.firstChild[node] = first;

  for (let o = 0; o < CHILDREN_PER_NODE; o++) {
    const child = first + o;
    p.half[child] = childHalf;
    p.centre[child * 3] = cx + (o & 1 ? childHalf : -childHalf);
    p.centre[child * 3 + 1] = cy + (o & 2 ? childHalf : -childHalf);
    p.centre[child * 3 + 2] = cz + (o & 4 ? childHalf : -childHalf);
    p.bodyStart[child] = start + offsets[o];
    p.bodyCount[child] = counts[o];
  }

  for (let o = 0; o < CHILDREN_PER_NODE; o++) {
    const child = first + o;
    if (p.bodyCount[child] > 0) subdivide(p, child, depth + 1, state);
  }
}

/** Accumulate mass and centre of mass bottom-up. */
function computeMassDistribution(p: Pool, node: number, state: SimState): void {
  const first = p.firstChild[node];

  if (first === -1) {
    // Leaf: sum its bucket directly.
    let m = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const start = p.bodyStart[node];
    const end = start + p.bodyCount[node];
    for (let k = start; k < end; k++) {
      const b = p.order[k];
      const mb = state.masses[b];
      const b3 = b * 3;
      m += mb;
      sx += mb * state.positions[b3];
      sy += mb * state.positions[b3 + 1];
      sz += mb * state.positions[b3 + 2];
    }
    p.mass[node] = m;
    if (m > 0) {
      p.com[node * 3] = sx / m;
      p.com[node * 3 + 1] = sy / m;
      p.com[node * 3 + 2] = sz / m;
    }
    return;
  }

  let m = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let o = 0; o < CHILDREN_PER_NODE; o++) {
    const child = first + o;
    if (p.bodyCount[child] === 0) continue;
    computeMassDistribution(p, child, state);
    const mc = p.mass[child];
    m += mc;
    sx += mc * p.com[child * 3];
    sy += mc * p.com[child * 3 + 1];
    sz += mc * p.com[child * 3 + 2];
  }
  p.mass[node] = m;
  if (m > 0) {
    p.com[node * 3] = sx / m;
    p.com[node * 3 + 1] = sy / m;
    p.com[node * 3 + 2] = sz / m;
  }
}

/**
 * Add the tree's contribution to body `target`'s acceleration.
 *
 * A cell is accepted as a single point mass when s/d < θ, where s is the cell
 * width and d the distance to its centre of mass — the standard opening
 * criterion. Traversal is iterative over an explicit stack, so tree depth
 * cannot overflow the call stack.
 */
export function accumulateTreeAcceleration(
  tree: Octree,
  state: SimState,
  target: number,
  g: number,
  eps2: number,
  theta: number,
): void {
  const { positions, accelerations, masses } = state;
  const t3 = target * 3;
  const px = positions[t3];
  const py = positions[t3 + 1];
  const pz = positions[t3 + 2];

  let ax = 0;
  let ay = 0;
  let az = 0;

  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop() as number;
    const m = tree.mass[node];
    if (m <= 0) continue;

    const n3 = node * 3;
    const dx = tree.com[n3] - px;
    const dy = tree.com[n3 + 1] - py;
    const dz = tree.com[n3 + 2] - pz;
    const r2 = dx * dx + dy * dy + dz * dz;

    const first = tree.firstChild[node];
    const width = tree.half[node] * 2;

    // Accept this cell as a point mass, or it is a leaf we must sum directly.
    if (first === -1 || width * width < theta * theta * r2) {
      if (first === -1) {
        // Leaf bucket: exact pairwise sum over its bodies, skipping self.
        const start = tree.bodyStart[node];
        const end = start + tree.bodyCount[node];
        for (let k = start; k < end; k++) {
          const b = tree.order[k];
          if (b === target) continue;
          const b3 = b * 3;
          const bx = positions[b3] - px;
          const by = positions[b3 + 1] - py;
          const bz = positions[b3 + 2] - pz;
          const br2 = bx * bx + by * by + bz * bz + eps2;
          if (br2 === 0) continue;
          const f = (g * masses[b]) / (br2 * Math.sqrt(br2));
          ax += f * bx;
          ay += f * by;
          az += f * bz;
        }
      } else {
        const sr2 = r2 + eps2;
        if (sr2 > 0) {
          const f = (g * m) / (sr2 * Math.sqrt(sr2));
          ax += f * dx;
          ay += f * dy;
          az += f * dz;
        }
      }
      continue;
    }

    for (let o = 0; o < CHILDREN_PER_NODE; o++) {
      const child = first + o;
      if (tree.bodyCount[child] > 0) stack.push(child);
    }
  }

  accelerations[t3] += ax;
  accelerations[t3 + 1] += ay;
  accelerations[t3 + 2] += az;
}
