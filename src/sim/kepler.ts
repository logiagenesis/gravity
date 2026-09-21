/**
 * Keplerian orbital elements → Cartesian state vectors.
 *
 * Needed because catalogues publish ELEMENTS (semi-major axis, eccentricity,
 * …) while an n-body integrator needs POSITION and VELOCITY. Getting this wrong
 * produces orbits that look plausible and have the wrong period, which is worse
 * than an obvious failure — so it is tested against closed-form results,
 * including the high-eccentricity cases where the naive solver fails to
 * converge.
 *
 * Units are the project's canonical AU / M☉ / days.
 */
import { G_AU3_PER_MSUN_DAY2 } from "./constants";

export interface OrbitalElements {
  /** Semi-major axis, AU. */
  semiMajorAxis: number;
  /** Eccentricity, 0 ≤ e < 1 for bound orbits. */
  eccentricity: number;
  /** Inclination, radians. */
  inclination?: number;
  /** Longitude of the ascending node, radians. */
  longitudeOfAscendingNode?: number;
  /** Argument of periapsis, radians. */
  argumentOfPeriapsis?: number;
  /** Mean anomaly at epoch, radians. */
  meanAnomaly?: number;
}

export interface StateVectors {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export class KeplerConvergenceError extends Error {
  constructor(eccentricity: number, meanAnomaly: number) {
    super(
      `Kepler's equation did not converge for e=${eccentricity}, M=${meanAnomaly}. ` +
        `This orbit cannot be converted to state vectors.`,
    );
    this.name = "KeplerConvergenceError";
  }
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly E.
 *
 * Newton-Raphson, but with two things the naive version gets wrong:
 *
 *  - The starting guess. E₀ = M diverges for e near 1. The standard remedy
 *    (Danby) is E₀ = M + 0.85·e·sign(sin M), which converges across the range.
 *  - A damped step. Near e = 1 the derivative 1 − e·cos E approaches zero and
 *    an undamped step overshoots wildly; clamping the step keeps it stable.
 */
export function solveKeplerEquation(
  meanAnomaly: number,
  eccentricity: number,
  tolerance = 1e-12,
  maxIterations = 100,
): number {
  if (eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError(
      `solveKeplerEquation handles bound orbits only (0 <= e < 1), received ${eccentricity}`,
    );
  }

  // Normalise to [-π, π] so the starting guess is well conditioned.
  let M = meanAnomaly % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  if (eccentricity === 0) return M;

  let E = M + 0.85 * eccentricity * Math.sign(Math.sin(M) || 1);

  for (let i = 0; i < maxIterations; i++) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fPrime = 1 - eccentricity * Math.cos(E);
    if (Math.abs(f) < tolerance) return E;

    // Guard against a vanishing derivative at very high eccentricity.
    let step = f / (fPrime === 0 ? 1e-12 : fPrime);
    // Damp: never move more than one radian in a single iteration.
    if (step > 1) step = 1;
    if (step < -1) step = -1;
    E -= step;
  }

  // Report rather than return a silently wrong answer.
  throw new KeplerConvergenceError(eccentricity, meanAnomaly);
}

/** Orbital period in days for a two-body orbit. */
export function orbitalPeriodDays(
  semiMajorAxis: number,
  totalMassSolar: number,
  g = G_AU3_PER_MSUN_DAY2,
): number {
  const mu = g * totalMassSolar;
  return 2 * Math.PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / mu);
}

/**
 * Convert elements to state vectors, relative to the primary.
 *
 * @param totalMassSolar M_primary + M_secondary, so μ = G(M₁+M₂)
 */
export function elementsToStateVectors(
  elements: OrbitalElements,
  totalMassSolar: number,
  g = G_AU3_PER_MSUN_DAY2,
): StateVectors {
  const a = elements.semiMajorAxis;
  const e = elements.eccentricity;
  const i = elements.inclination ?? 0;
  const raan = elements.longitudeOfAscendingNode ?? 0;
  const argP = elements.argumentOfPeriapsis ?? 0;
  const M = elements.meanAnomaly ?? 0;

  if (!(a > 0) || !Number.isFinite(a)) {
    throw new RangeError(`Semi-major axis must be positive and finite, received ${a}`);
  }
  if (!(totalMassSolar > 0)) {
    throw new RangeError(`Total mass must be positive, received ${totalMassSolar}`);
  }

  const mu = g * totalMassSolar;
  const E = solveKeplerEquation(M, e);

  // True anomaly from eccentric anomaly. The half-angle form is numerically
  // better behaved than acos(...) near ν = 0 and ν = π.
  const trueAnomaly =
    2 *
    Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

  const r = a * (1 - e * Math.cos(E));
  // Semi-latus rectum and specific angular momentum.
  const p = a * (1 - e * e);
  const h = Math.sqrt(mu * p);

  // In-plane (perifocal) coordinates.
  const xP = r * Math.cos(trueAnomaly);
  const yP = r * Math.sin(trueAnomaly);
  // Radial and transverse velocity components.
  const vRadial = (mu / h) * e * Math.sin(trueAnomaly);
  const vTransverse = h / r;
  const cosNu = Math.cos(trueAnomaly);
  const sinNu = Math.sin(trueAnomaly);
  const vxP = vRadial * cosNu - vTransverse * sinNu;
  const vyP = vRadial * sinNu + vTransverse * cosNu;

  // Rotate perifocal → reference frame: Rz(raan)·Rx(i)·Rz(argP).
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosW = Math.cos(argP);
  const sinW = Math.sin(argP);

  const r11 = cosO * cosW - sinO * sinW * cosI;
  const r12 = -cosO * sinW - sinO * cosW * cosI;
  const r21 = sinO * cosW + cosO * sinW * cosI;
  const r22 = -sinO * sinW + cosO * cosW * cosI;
  const r31 = sinW * sinI;
  const r32 = cosW * sinI;

  return {
    position: {
      x: r11 * xP + r12 * yP,
      y: r21 * xP + r22 * yP,
      z: r31 * xP + r32 * yP,
    },
    velocity: {
      x: r11 * vxP + r12 * vyP,
      y: r21 * vxP + r22 * vyP,
      z: r31 * vxP + r32 * vyP,
    },
  };
}
