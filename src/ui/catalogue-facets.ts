/**
 * Facet vocabularies for the catalogue page.
 *
 * Kept out of the component so the ranges can be unit-tested without a DOM,
 * and so the labels and the numbers behind them live in one place.
 */

/** Body-count bands. `max` of null means "no upper bound". */
export const BODY_BANDS: {
  id: string;
  label: string;
  min: number;
  max: number | null;
}[] = [
  { id: "2", label: "2 bodies", min: 2, max: 2 },
  { id: "3-5", label: "3 to 5", min: 3, max: 5 },
  { id: "6-10", label: "6 to 10", min: 6, max: 10 },
  { id: "11+", label: "11 or more", min: 11, max: null },
];

/**
 * Orbital-period bands, in days. A scenario matches a band when ANY of its
 * orbits falls inside it, so a system with a hot Jupiter and a cold giant
 * appears under both — which is what someone looking for either would want.
 *
 * The boundaries are round numbers on a log scale rather than anything
 * derived: they exist to divide the catalogue into useful handfuls, and the
 * page says so.
 */
export const PERIOD_BANDS: {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
}[] = [
  { id: "ultra-short", label: "Under 1 day", min: null, max: 1 },
  { id: "short", label: "1 to 10 days", min: 1, max: 10 },
  { id: "medium", label: "10 to 100 days", min: 10, max: 100 },
  { id: "long", label: "100 days to 10 years", min: 100, max: 3652.5 },
  { id: "very-long", label: "Over 10 years", min: 3652.5, max: null },
];

/** Human-readable period, chosen so the unit suits the magnitude. */
export function formatPeriod(days: number | null): string {
  if (days === null) return "no bound orbit";
  if (days < 1) return `${(days * 24).toPrecision(2)} hours`;
  if (days < 400) return `${days.toPrecision(3)} days`;
  const years = days / 365.25;
  if (years < 1000) return `${years.toPrecision(3)} years`;
  return `${(years / 1000).toPrecision(3)} thousand years`;
}

/**
 * What each category is, in the catalogue's own words.
 *
 * Every line here must be true of the data actually in that category; the
 * counts shown beside them come from the manifest, never from this file.
 */
export const CATEGORY_COPY: Record<string, { title: string; blurb: string }> = {
  "solar-system": {
    title: "The Solar System",
    blurb:
      "Planets, moons and Lagrange points built from published orbital elements " +
      "and physical constants. Each scenario names the source it was built from.",
  },
  exoplanets: {
    title: "Exoplanet systems",
    blurb:
      "One scenario per confirmed planetary system in the NASA Exoplanet Archive, " +
      "converted from published orbital elements into state vectors. Starting " +
      "orbital phases are spread evenly and are not the real phases, so these are " +
      "models of each system, not ephemerides.",
  },
  choreographies: {
    title: "Choreographies",
    blurb:
      "Exact periodic solutions of the n-body problem, where several bodies chase " +
      "one another around a single closed path. Initial conditions come from the " +
      "papers that found them.",
  },
  spaceflight: {
    title: "Spaceflight",
    blurb:
      "Real spacecraft at their real positions, from the JPL Horizons ephemeris " +
      "at a recorded epoch. Each one is a massless test particle: it feels the " +
      "Sun and the planets but exerts no gravity of its own, which at these mass " +
      "ratios is the honest simplification rather than a shortcut.",
  },
  "what-if": {
    title: "What if?",
    blurb:
      "Deliberately hypothetical setups for exploring how gravity behaves when the " +
      "numbers are changed. These are constructed, not observed, and say so.",
  },
};

export function categoryTitle(category: string): string {
  return CATEGORY_COPY[category]?.title ?? category.replace(/-/g, " ");
}
