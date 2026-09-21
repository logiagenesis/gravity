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

/**
 * Physical data for every body the Horizons pipeline places.
 *
 * Masses and diameters transcribed from [FACT] (page last updated
 * 18 March 2025); radii are the tabulated diameters halved. No orbital
 * elements here: those scenarios take their state vectors from JPL Horizons
 * at a recorded epoch, so an element set would be a second, conflicting
 * source for the same thing.
 *
 * Spacecraft are massless test particles. Their `radiusKm` is a DISPLAY size
 * chosen so they are visible at solar-system scale, not a physical dimension,
 * and each generated scenario says so in its citation.
 */
export interface BodyPhysical {
  name: string;
  /** Mass in 1e24 kg. [FACT]. Zero for a massless test particle. */
  massE24Kg: number;
  /** Radius in km. [FACT] (diameter / 2), or a display size for spacecraft. */
  radiusKm: number;
  colour: string;
  /** True when radiusKm is a display size rather than a measurement. */
  displayRadiusOnly?: boolean;
}

/** Keyed by JPL Horizons body id, as it appears in the snapshot. */
export const HORIZONS_BODIES: Readonly<Record<string, BodyPhysical>> = {
  "10": {
    name: "Sun",
    massE24Kg: SOLAR_MASS_1E24_KG,
    radiusKm: 695_700,
    colour: "#ffd27f",
  },
  "199": { name: "Mercury", massE24Kg: 0.33, radiusKm: 2439.7, colour: "#9b8f84" },
  "299": { name: "Venus", massE24Kg: 4.87, radiusKm: 6051.8, colour: "#e6c88a" },
  "399": { name: "Earth", massE24Kg: 5.97, radiusKm: 6378.1, colour: "#6b93d6" },
  "301": { name: "Moon", massE24Kg: 0.073, radiusKm: 1737.5, colour: "#b8b8b8" },
  "499": { name: "Mars", massE24Kg: 0.642, radiusKm: 3396.2, colour: "#c1440e" },
  "599": { name: "Jupiter", massE24Kg: 1898, radiusKm: 71_492, colour: "#d8ca9d" },
  "699": { name: "Saturn", massE24Kg: 568, radiusKm: 60_268, colour: "#e3d6a3" },
  "799": { name: "Uranus", massE24Kg: 86.8, radiusKm: 25_559, colour: "#a7dbe6" },
  "899": { name: "Neptune", massE24Kg: 102, radiusKm: 24_764, colour: "#5b7ff5" },
  "999": { name: "Pluto", massE24Kg: 0.013, radiusKm: 1188, colour: "#cbbfae" },
  "-31": {
    name: "Voyager 1",
    massE24Kg: 0,
    radiusKm: 120_000,
    colour: "#7ee787",
    displayRadiusOnly: true,
  },
  "-32": {
    name: "Voyager 2",
    massE24Kg: 0,
    radiusKm: 120_000,
    colour: "#79c0ff",
    displayRadiusOnly: true,
  },
  "-98": {
    name: "New Horizons",
    massE24Kg: 0,
    radiusKm: 90_000,
    colour: "#ffa657",
    displayRadiusOnly: true,
  },
  "-96": {
    name: "Parker Solar Probe",
    massE24Kg: 0,
    radiusKm: 9_000,
    colour: "#ff7b72",
    displayRadiusOnly: true,
  },
  "-170": {
    name: "James Webb Space Telescope",
    massE24Kg: 0,
    radiusKm: 4_000,
    colour: "#d2a8ff",
    displayRadiusOnly: true,
  },
};

/** Convert a mass in 1e24 kg to solar masses. */
export const toSolarMasses = (massE24Kg: number): number =>
  massE24Kg / SOLAR_MASS_1E24_KG;

/** Convert a radius in km to AU. */
export const toAu = (km: number): number => km / AU_KM;
