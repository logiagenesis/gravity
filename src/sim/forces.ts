/**
 * Gravitational acceleration.
 *
 * Plummer-softened Newtonian acceleration (Plummer 1911; the softened form is
 * standard in collisionless N-body work, e.g. Aarseth, "Gravitational N-Body
 * Simulations", CUP 2003):
 *
 *   a_i = Σ_{j≠i} G · m_j · (r_j − r_i) / (|r_j − r_i|² + ε²)^{3/2}
 *
 * Softening ε removes the singularity as r → 0. With ε = 0 this is exactly
 * Newton's law.
 *
 * Massless test particles are excluded as *sources* but still receive
 * acceleration as *targets*.
 */
import type { SimState } from "./state";
import { buildOctree, accumulateTreeAcceleration } from "./barnes-hut";

export type ForceMode = "direct" | "barnes-hut";

export interface ForceOptions {
  g: number;
  /** Plummer softening length ε, in AU. */
  softening: number;
  mode: ForceMode;
  /** Barnes-Hut opening angle θ. Smaller is more accurate and slower. */
  theta?: number;
}

/**
 * Direct O(n²) summation. Exact to floating-point; the reference against which
 * the Barnes-Hut approximation is tested.
 */
export function computeAccelerationsDirect(
  state: SimState,
  g: number,
  softening: number,
): void {
  const { positions, accelerations, masses, count } = state;
  const eps2 = softening * softening;

  accelerations.fill(0, 0, count * 3);

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    const px = positions[ix];
    const py = positions[ix + 1];
    const pz = positions[ix + 2];

    let ax = 0;
    let ay = 0;
    let az = 0;

    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      // Massless test particles exert no force on anything.
      if (state.isMassless(j)) continue;

      const jx = j * 3;
      const dx = positions[jx] - px;
      const dy = positions[jx + 1] - py;
      const dz = positions[jx + 2] - pz;

      const r2 = dx * dx + dy * dy + dz * dz + eps2;
      if (r2 === 0) continue; // coincident and unsoftened: skip rather than divide by zero

      // 1/r³ via one sqrt: r2 * sqrt(r2)
      const invR3 = 1 / (r2 * Math.sqrt(r2));
      const f = g * masses[j] * invR3;

      ax += f * dx;
      ay += f * dy;
      az += f * dz;
    }

    accelerations[ix] = ax;
    accelerations[ix + 1] = ay;
    accelerations[ix + 2] = az;
  }
}

/**
 * Barnes-Hut approximation (Barnes & Hut, Nature 324, 446-449, 1986).
 *
 * The octree is rebuilt every call from the bodies' *actual* extent, so no
 * body can ever fall outside the root cell. See barnes-hut.ts.
 */
export function computeAccelerationsBarnesHut(
  state: SimState,
  g: number,
  softening: number,
  theta: number,
): void {
  const { accelerations, count } = state;
  accelerations.fill(0, 0, count * 3);

  const tree = buildOctree(state);
  if (tree === null) return; // no massive bodies: acceleration is zero everywhere

  const eps2 = softening * softening;
  for (let i = 0; i < count; i++) {
    accumulateTreeAcceleration(tree, state, i, g, eps2, theta);
  }
}

/** Dispatch to the configured force mode. */
export function computeAccelerations(state: SimState, options: ForceOptions): void {
  if (options.mode === "barnes-hut") {
    computeAccelerationsBarnesHut(
      state,
      options.g,
      options.softening,
      options.theta ?? 0.5,
    );
  } else {
    computeAccelerationsDirect(state, options.g, options.softening);
  }
}
