/**
 * Primary-source physical and orbital data.
 *
 * EVERY number here is transcribed from a cited public source. Nothing is
 * recalled or estimated. Where a value is DERIVED (for example a mass ratio),
 * the derivation is shown so it can be checked.
 *
 * Sources
 * -------
 * [FACT] NASA NSSDCA Planetary Fact Sheet
 *        https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 *        Masses in 1e24 kg and equatorial radii in km.
 *
 * [JPL]  NASA JPL Solar System Dynamics, "Approximate Positions of the Planets"
 *        https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *        Keplerian elements (semi-major axis, eccentricity) valid 1800-2050.
 *
 * IMPORTANT HONESTY NOTE ON THE DERIVED SCENARIOS
 * -----------------------------------------------
 * The generated solar-system scenarios are IDEALISED, COPLANAR models built by
 * placing each body at its own perihelion. They are NOT an ephemeris and do not
 * correspond to any real date. Only the semi-major axis, the eccentricity, the
 * masses and the radii come from the cited sources; the orbital plane and the
 * orientation angle of each orbit are chosen for visual clarity and are stated
 * as such in every generated scenario's `source.notes`. Inclination, longitude
 * of the ascending node and longitude of perihelion are deliberately NOT used,
 * because using half-remembered values would be worse than using none.
 */

/** Solar mass in 1e24 kg. [FACT], Sun fact sheet. */
export const SOLAR_MASS_1E24_KG = 1_988_500;

/** Astronomical unit in km. IAU 2012 definition: exactly 149,597,870.7 km. */
export const AU_KM = 149_597_870.7;

export interface PlanetDatum {
  id: string;
  name: string;
  /** Mass in 1e24 kg. [FACT] */
  massE24Kg: number;
  /** Equatorial radius in km. [FACT] */
  radiusKm: number;
  /** Semi-major axis in AU. [JPL] */
  semiMajorAxisAu: number;
  /** Eccentricity. [JPL] */
  eccentricity: number;
  /** Display colour. Ours, not sourced. */
  colour: string;
}

/** The Sun. [FACT] */
export const SUN = {
  id: "sun",
  name: "Sun",
  massE24Kg: SOLAR_MASS_1E24_KG,
  radiusKm: 695_700,
  colour: "#ffd27f",
};

export const PLANETS: readonly PlanetDatum[] = [
  {
    id: "mercury",
    name: "Mercury",
    massE24Kg: 0.33,
    radiusKm: 2439.7,
    semiMajorAxisAu: 0.38709927,
    eccentricity: 0.20563593,
    colour: "#9b8f84",
  },
  {
    id: "venus",
    name: "Venus",
    massE24Kg: 4.87,
    radiusKm: 6051.8,
    semiMajorAxisAu: 0.72333566,
    eccentricity: 0.00677672,
    colour: "#e6c88a",
  },
  {
    id: "earth",
    name: "Earth",
    massE24Kg: 5.97,
    radiusKm: 6378.1,
    // [JPL] lists this element set for the Earth-Moon barycentre.
    semiMajorAxisAu: 1.00000261,
    eccentricity: 0.01671123,
    colour: "#6b93d6",
  },
  {
    id: "mars",
    name: "Mars",
    massE24Kg: 0.642,
    radiusKm: 3396.2,
    semiMajorAxisAu: 1.52371034,
    eccentricity: 0.0933941,
    colour: "#c1440e",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    massE24Kg: 1898,
    radiusKm: 71_492,
    semiMajorAxisAu: 5.202887,
    eccentricity: 0.04838624,
    colour: "#d8ca9d",
  },
];

/** The Moon. [FACT]. Semi-major axis of the geocentric orbit is 0.3844e6 km. */
export const MOON = {
  id: "moon",
  name: "Moon",
  massE24Kg: 0.073,
  radiusKm: 1738.1,
  semiMajorAxisKm: 0.3844e6,
  eccentricity: 0.0549,
  colour: "#b8b8b8",
};

/** Convert a mass in 1e24 kg to solar masses. */
export const toSolarMasses = (massE24Kg: number): number =>
  massE24Kg / SOLAR_MASS_1E24_KG;

/** Convert a radius in km to AU. */
export const toAu = (km: number): number => km / AU_KM;
