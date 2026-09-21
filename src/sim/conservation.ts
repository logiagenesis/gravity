/**
 * Conservation diagnostics.
 *
 * These exist so a user can *see* whether an integration is trustworthy rather
 * than assume it. No comparable consumer product surfaces its own numerical
 * error; doing so is the sharpest differentiator this product has
 * (artifacts/02-top-20-benchmark.md, conclusion 5).
 *
 * Total energy, using the same Plummer softening as the force law so that the
 * potential is the exact integral of the force actually applied:
 *
 *   E = Σ ½mᵢ|vᵢ|²  −  Σ_{i<j} G·mᵢmⱼ / √(rᵢⱼ² + ε²)
 *
 * Total angular momentum about the origin:
 *
 *   L = Σ mᵢ (rᵢ × vᵢ)
 */
import type { SimState } from "./state";

export interface Conservation {
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  /** Magnitude of the total angular momentum vector. */
  angularMomentum: number;
  angularMomentumVector: { x: number; y: number; z: number };
  /** Centre-of-mass position and velocity; useful for spotting drift. */
  centreOfMass: { x: number; y: number; z: number };
  linearMomentum: { x: number; y: number; z: number };
}

export function computeConservation(
  state: SimState,
  g: number,
  softening: number,
): Conservation {
  const { positions, velocities, masses, count } = state;
  const eps2 = softening * softening;

  let kinetic = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let comX = 0;
  let comY = 0;
  let comZ = 0;
  let totalMass = 0;

  for (let i = 0; i < count; i++) {
    const k = i * 3;
    const m = masses[i];
    const vx = velocities[k];
    const vy = velocities[k + 1];
    const vz = velocities[k + 2];
    const x = positions[k];
    const y = positions[k + 1];
    const z = positions[k + 2];

    kinetic += 0.5 * m * (vx * vx + vy * vy + vz * vz);

    // L = Σ m (r × v)
    lx += m * (y * vz - z * vy);
    ly += m * (z * vx - x * vz);
    lz += m * (x * vy - y * vx);

    px += m * vx;
    py += m * vy;
    pz += m * vz;

    comX += m * x;
    comY += m * y;
    comZ += m * z;
    totalMass += m;
  }

  let potential = 0;
  for (let i = 0; i < count; i++) {
    if (state.isMassless(i)) continue;
    const i3 = i * 3;
    const mi = masses[i];
    for (let j = i + 1; j < count; j++) {
      if (state.isMassless(j)) continue;
      const j3 = j * 3;
      const dx = positions[j3] - positions[i3];
      const dy = positions[j3 + 1] - positions[i3 + 1];
      const dz = positions[j3 + 2] - positions[i3 + 2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      if (r > 0) potential -= (g * mi * masses[j]) / r;
    }
  }

  const invMass = totalMass > 0 ? 1 / totalMass : 0;

  return {
    kineticEnergy: kinetic,
    potentialEnergy: potential,
    totalEnergy: kinetic + potential,
    angularMomentum: Math.sqrt(lx * lx + ly * ly + lz * lz),
    angularMomentumVector: { x: lx, y: ly, z: lz },
    centreOfMass: { x: comX * invMass, y: comY * invMass, z: comZ * invMass },
    linearMomentum: { x: px, y: py, z: pz },
  };
}

/**
 * Relative drift from a reference value.
 *
 * Falls back to absolute difference when the reference is ~0, because a
 * relative measure against zero is meaningless (a parabolic escape orbit has
 * E ≈ 0, and dividing by it would report a meaningless spike).
 */
export function relativeDrift(current: number, reference: number): number {
  const scale = Math.abs(reference);
  if (scale < 1e-30) return Math.abs(current - reference);
  return Math.abs(current - reference) / scale;
}
