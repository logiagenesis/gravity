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

/**
 * Minimum mass that can sustain hydrogen fusion, in solar masses: the line
 * between a star and a brown dwarf.
 *
 * 0.075 M☉ (about 78.5 Jupiter masses) at solar metallicity, from the
 * hydrogen-burning minimum mass computed with the CD21 equation of state:
 * Chabrier, Debras & Baraffe (2023), Astronomy & Astrophysics 671, A119,
 * https://www.aanda.org/articles/aa/full_html/2023/03/aa43832-22/aa43832-22.html
 *
 * The limit is metallicity-dependent (roughly 0.072 to 0.088 M☉ across the
 * metallicities observed), so it is a boundary with real width. It is used
 * here only to label a catalogue facet, never to assert what a given object
 * is.
 */
export const HYDROGEN_BURNING_LIMIT_MSUN = 0.075;

/**
 * Minimum mass that can fuse deuterium, in solar masses: the IAU's working
 * boundary between a planet and a brown dwarf, and the point above which an
 * object is self-luminous enough to be drawn as glowing.
 *
 * 13 Jupiter masses at solar metallicity, per the IAU Commission F2 working
 * definition of an exoplanet: Lecavelier des Etangs & Lissauer (2022),
 * New Astronomy Reviews 94, 101641, https://arxiv.org/abs/2203.09520
 * Converted with the Jupiter and solar masses used elsewhere in this project:
 * 13 × 1.898e27 kg / 1.9885e30 kg.
 */
export const DEUTERIUM_BURNING_LIMIT_MSUN = (13 * 1.898e27) / 1.9885e30;
