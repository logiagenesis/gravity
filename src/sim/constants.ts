/**
 * Canonical units and physical constants.
 *
 * Units (artifacts/05-product-and-technical-spec.md §4.1):
 *   length AU · mass M☉ · time days · velocity AU/day
 *
 * In this system G is *derived, not measured*. The Gaussian gravitational
 * constant k is a defined quantity, so G = k² is exact and carries no
 * measurement uncertainty. This is the standard convention for solar-system
 * dynamics and is why we work in these units rather than SI.
 */

/** Gaussian gravitational constant (defined, dimensionless in AU/M☉/day). */
export const GAUSSIAN_GRAVITATIONAL_CONSTANT = 0.01720209895;

/** G = k², exact in AU³ · M☉⁻¹ · day⁻². */
export const G_AU3_PER_MSUN_DAY2 =
  GAUSSIAN_GRAVITATIONAL_CONSTANT * GAUSSIAN_GRAVITATIONAL_CONSTANT;

/** Days in a Julian year, by definition. */
export const DAYS_PER_JULIAN_YEAR = 365.25;

/** Bit flags packed into the state's `flags` array. */
export const FLAG_ACTIVE = 1 << 0;
/**
 * A massless test particle: integrated as a *target* of gravity, but never
 * acts as a *source*. Keeping these out of the source loop and out of the
 * octree is what lets a scenario carry thousands of tracers cheaply.
 */
export const FLAG_MASSLESS = 1 << 1;
