/**
 * Exoplanet catalogue pipeline.
 *
 * Reads the committed NASA Exoplanet Archive snapshot and emits one scenario
 * per PLANETARY SYSTEM (not per planet), converting published orbital elements
 * into the state vectors an n-body integrator needs.
 *
 * WHY A COMMITTED SNAPSHOT rather than a live query: neither this environment
 * nor CI can reach the archive (egress policy). A snapshot also makes builds
 * reproducible and offline-safe, and it records the exact query and retrieval
 * date so it can be regenerated and audited. See
 * artifacts/04-licensing-and-clean-room.md §11 for the terms and the required
 * acknowledgement, which every generated scenario carries.
 *
 * MISSING DATA POLICY: a system that cannot be built from validated numbers is
 * EXCLUDED and counted in the report, with the reason. Nothing is guessed, and
 * no placeholder numbers are ever emitted.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { format } from "prettier";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { elementsToStateVectors, orbitalPeriodDays } from "../../src/sim/kepler";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";
import { safeParseScenario, CURRENT_SCHEMA_VERSION } from "../../src/schema/scenario";
// One definition of the slug, shared with the catalogue build so it can
// reconstruct ids from names instead of storing all 4,432 of them.
import { slugify } from "../../src/catalog/format";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SNAPSHOT = join(
  ROOT,
  "data/sources/snapshots/nasa-exoplanet-archive-pscomppars.csv",
);
const OUT_DIR = join(ROOT, "data/scenarios/exoplanets");

// --- unit conversions, all from the values in data/sources/solar-system.ts ---
/** Earth mass in solar masses: 5.97e24 kg / 1.9885e30 kg. */
const EARTH_MASS_IN_SOLAR = 5.97e24 / 1.9885e30;
/** Earth equatorial radius in AU: 6378.1 km / 149597870.7 km. */
const EARTH_RADIUS_IN_AU = 6378.1 / 149_597_870.7;
/** Solar radius in AU: 695700 km / 149597870.7 km. */
const SOLAR_RADIUS_IN_AU = 695_700 / 149_597_870.7;

const RETRIEVED = "2026-09-21";
const ACKNOWLEDGEMENT =
  "This research has made use of the NASA Exoplanet Archive, which is operated by " +
  "the California Institute of Technology, under contract with the National " +
  "Aeronautics and Space Administration under the Exoplanet Exploration Program.";

interface Row {
  planet: string;
  host: string;
  /** Published semi-major axis, AU. Often derived by the archive, not measured. */
  a: number | null;
  /** Published orbital period, days. The directly measured quantity. */
  period: number | null;
  /** Semi-major axis actually used, AU, and where it came from. */
  aUsed: number;
  aFromPeriod: boolean;
  e: number | null;
  massEarth: number | null;
  radiusEarth: number | null;
  starMass: number | null;
  starRadius: number | null;
  starTeff: number | null;
}

/** Minimal RFC-4180 CSV parser: the archive quotes fields containing commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

const num = (raw: string): number | null => {
  const t = raw.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** Visual colour by planet mass, so the catalogue is not monochrome. */
function planetColour(massEarth: number): string {
  if (massEarth > 100) return "#d8ca9d"; // gas giant
  if (massEarth > 10) return "#9fd8e6"; // ice giant
  if (massEarth > 2) return "#c98f6a"; // super-Earth
  return "#8ab4d8"; // terrestrial
}

/** Star colour by effective temperature. Mirrors the renderer's blackbody fit. */
function starColourHex(teff: number | null): string {
  const t = teff ?? 5772;
  if (t >= 10000) return "#aabfff";
  if (t >= 7500) return "#cad7ff";
  if (t >= 6000) return "#fff4ea";
  if (t >= 5200) return "#ffd2a1";
  if (t >= 3700) return "#ffb765";
  return "#ff9060";
}

/**
 * Morgan-Keenan spectral class from effective temperature.
 *
 * Boundaries are the conventional main-sequence ones: O >= 30000 K,
 * B >= 10000, A >= 7500, F >= 6000, G >= 5200, K >= 3700, M below that.
 * One table serves both the prose summary and the catalogue tag, so the two
 * can never disagree about what class a star is.
 *
 * A star whose temperature the archive does not record is classed "unknown",
 * NOT guessed from its mass. Mass-to-temperature is a model, not a
 * measurement, and this catalogue does not present models as measurements.
 */
interface SpectralClass {
  /** Catalogue tag, kebab-case. */
  tag: string;
  /** Noun phrase for the summary sentence, with its article. */
  phrase: string;
}

function spectralClass(teff: number | null): SpectralClass {
  if (teff === null || !Number.isFinite(teff) || teff <= 0) {
    return { tag: "star-class-unknown", phrase: "a star of unrecorded temperature" };
  }
  if (teff >= 30000) return { tag: "o-type-star", phrase: "a blue O-type star" };
  if (teff >= 10000) return { tag: "b-type-star", phrase: "a blue-white B-type star" };
  if (teff >= 7500) return { tag: "a-type-star", phrase: "a white A-type star" };
  if (teff >= 6000) return { tag: "f-type-star", phrase: "a yellow-white F-type star" };
  if (teff >= 5200) return { tag: "g-type-star", phrase: "a Sun-like G-type star" };
  if (teff >= 3700) return { tag: "k-type-star", phrase: "an orange K-type dwarf" };
  return { tag: "m-type-star", phrase: "a cool red M-dwarf" };
}

function describeStar(teff: number | null, mass: number): string {
  return `${spectralClass(teff).phrase} of ${mass.toFixed(2)} solar masses`;
}

/**
 * Semi-major axis from an orbital period, by Kepler's third law:
 * a = (mu (P / 2pi)^2)^(1/3), with mu = G(M* + Mp) in AU^3 / (Msun day^2).
 */
function semiMajorAxisFromPeriod(periodDays: number, totalMassSolar: number): number {
  const mu = G_AU3_PER_MSUN_DAY2 * totalMassSolar;
  return Math.cbrt(mu * Math.pow(periodDays / (2 * Math.PI), 2));
}

interface Excluded {
  host: string;
  reason: string;
}

async function main(): Promise<void> {
  const rows = parseCsv(readFileSync(SNAPSHOT, "utf8"));
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const iPl = idx("pl_name");
  const iHost = idx("hostname");
  const iA = idx("pl_orbsmax");
  const iE = idx("pl_orbeccen");
  const iM = idx("pl_bmasse");
  const iR = idx("pl_rade");
  const iSm = idx("st_mass");
  const iSr = idx("st_rad");
  const iSt = idx("st_teff");
  const iP = idx("pl_orbper");

  if ([iPl, iHost, iA, iP, iM, iSm].some((i) => i < 0)) {
    console.error("Snapshot is missing required columns.");
    process.exit(1);
  }

  const bySystem = new Map<string, Row[]>();
  for (const r of rows.slice(1)) {
    const row: Row = {
      planet: r[iPl],
      host: r[iHost],
      a: num(r[iA]),
      period: num(r[iP]),
      aUsed: 0,
      aFromPeriod: false,
      e: iE >= 0 ? num(r[iE]) : null,
      massEarth: num(r[iM]),
      radiusEarth: iR >= 0 ? num(r[iR]) : null,
      starMass: num(r[iSm]),
      starRadius: iSr >= 0 ? num(r[iSr]) : null,
      starTeff: iSt >= 0 ? num(r[iSt]) : null,
    };
    const list = bySystem.get(row.host);
    if (list) list.push(row);
    else bySystem.set(row.host, [row]);
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const excluded: Excluded[] = [];
  let written = 0;
  let planetsIncluded = 0;
  const byPlanetCount = new Map<number, number>();
  /** Where each included planet's orbit size came from, for the report. */
  let orbitsFromPeriod = 0;
  let orbitsFromAxis = 0;
  /** How far the published axis would have disagreed with the published period. */
  const axisDisagreement: number[] = [];

  for (const [host, planets] of bySystem) {
    const starMass = planets[0].starMass;
    if (starMass === null || starMass <= 0) {
      excluded.push({ host, reason: "no stellar mass" });
      continue;
    }

    /*
     * SEMI-MAJOR AXIS FROM THE PUBLISHED PERIOD, where there is one.
     *
     * pscomppars is a COMPOSITE table: it takes each parameter from whichever
     * reference the archive judges best, so `pl_orbsmax` and `pl_orbper` can
     * come from different papers — or from the same paper and still disagree.
     * Measured across the whole snapshot, the period implied by `pl_orbsmax`
     * differs from the published `pl_orbper` by more than 10% for 402 of
     * 5,570 planets and by more than a factor of two for 26 (see
     * artifacts/09-exoplanet-pipeline-report.md). Spot checks show why:
     * KOI-2513.01 carries a semi-major axis of exactly 0.5 AU against a
     * period of 19.005 days, and TOI-2285 b pairs a 2022 axis with a 2025
     * period.
     *
     * For a transiting or radial-velocity detection the PERIOD is what is
     * measured; the axis is inferred from it and the stellar mass. Deriving
     * the axis back from the period and the mass we are actually going to
     * integrate with therefore uses the better quantity AND makes each
     * scenario self-consistent: the orbit it simulates has the period the
     * archive publishes. Where no period is published the axis is used as
     * given, and the scenario says so.
     */
    for (const row of planets) {
      const massSolar =
        row.massEarth !== null && row.massEarth > 0
          ? row.massEarth * EARTH_MASS_IN_SOLAR
          : 0;
      if (row.period !== null && row.period > 0) {
        row.aUsed = semiMajorAxisFromPeriod(row.period, starMass + massSolar);
        row.aFromPeriod = true;
      } else if (row.a !== null && row.a > 0) {
        row.aUsed = row.a;
        row.aFromPeriod = false;
      } else {
        row.aUsed = 0;
      }
    }

    // Keep only planets with the minimum usable set.
    const usable = planets.filter(
      (p) => p.aUsed > 0 && p.massEarth !== null && p.massEarth > 0,
    );
    if (usable.length === 0) {
      excluded.push({
        host,
        reason: "no planet with a usable orbit (period or semi-major axis) and a mass",
      });
      continue;
    }

    usable.sort((x, y) => x.aUsed - y.aUsed);

    const starRadiusAu =
      planets[0].starRadius !== null && planets[0].starRadius > 0
        ? planets[0].starRadius * SOLAR_RADIUS_IN_AU
        : // Fall back to a main-sequence approximation R ≈ M^0.8, recorded in
          // the citation as an assumption rather than presented as measured.
          Math.pow(starMass, 0.8) * SOLAR_RADIUS_IN_AU;
    const starRadiusAssumed = !(
      planets[0].starRadius !== null && planets[0].starRadius > 0
    );

    const bodies: Array<Record<string, unknown>> = [
      {
        id: "star",
        name: host,
        mass: starMass,
        radius: starRadiusAu,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        colour: starColourHex(planets[0].starTeff),
      },
    ];

    let failed: string | null = null;
    let radiusAssumedCount = 0;

    usable.forEach((p, index) => {
      if (failed) return;
      const a = p.aUsed;
      const massSolar = (p.massEarth as number) * EARTH_MASS_IN_SOLAR;
      // Eccentricity is frequently blank; the archive convention is that a
      // blank means "not measured", not "zero". A circular orbit is the
      // standard assumption and is recorded as one in the citation.
      const e = p.e !== null && p.e >= 0 && p.e < 1 ? p.e : 0;

      let radiusAu: number;
      if (p.radiusEarth !== null && p.radiusEarth > 0) {
        radiusAu = p.radiusEarth * EARTH_RADIUS_IN_AU;
      } else {
        // Mass-radius relation for the missing cases, flagged in the citation.
        radiusAu = Math.pow(p.massEarth as number, 0.27) * EARTH_RADIUS_IN_AU;
        radiusAssumedCount++;
      }

      try {
        // Spread starting mean anomalies so a multi-planet system does not
        // begin with every planet artificially lined up at periapsis.
        const meanAnomaly = (index * 2 * Math.PI) / Math.max(1, usable.length);
        const state = elementsToStateVectors(
          { semiMajorAxis: a, eccentricity: e, meanAnomaly },
          starMass + massSolar,
        );
        if (
          ![
            state.position.x,
            state.position.y,
            state.velocity.x,
            state.velocity.y,
          ].every(Number.isFinite)
        ) {
          failed = `non-finite state vector for ${p.planet}`;
          return;
        }
        bodies.push({
          id: slugify(p.planet) || `planet-${index}`,
          name: p.planet,
          mass: massSolar,
          radius: radiusAu,
          position: state.position,
          velocity: state.velocity,
          colour: planetColour(p.massEarth as number),
        });
      } catch (error) {
        failed = `${p.planet}: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

    if (failed) {
      excluded.push({ host, reason: failed });
      continue;
    }

    // Shift into the centre-of-momentum frame so the system does not drift.
    let totalMass = 0;
    const sumP = { x: 0, y: 0, z: 0 };
    const sumV = { x: 0, y: 0, z: 0 };
    for (const b of bodies) {
      const m = b.mass as number;
      const p = b.position as { x: number; y: number; z: number };
      const v = b.velocity as { x: number; y: number; z: number };
      totalMass += m;
      sumP.x += m * p.x;
      sumP.y += m * p.y;
      sumP.z += m * p.z;
      sumV.x += m * v.x;
      sumV.y += m * v.y;
      sumV.z += m * v.z;
    }
    for (const b of bodies) {
      const p = b.position as { x: number; y: number; z: number };
      const v = b.velocity as { x: number; y: number; z: number };
      p.x -= sumP.x / totalMass;
      p.y -= sumP.y / totalMass;
      p.z -= sumP.z / totalMass;
      v.x -= sumV.x / totalMass;
      v.y -= sumV.y / totalMass;
      v.z -= sumV.z / totalMass;
    }

    // Timestep must resolve the innermost orbit: 1/400 of its period.
    const innermost = usable[0].aUsed;
    const shortestPeriod = orbitalPeriodDays(innermost, starMass);
    const dt = Math.max(1e-6, Number((shortestPeriod / 400).toPrecision(3)));

    const n = usable.length;
    byPlanetCount.set(n, (byPlanetCount.get(n) ?? 0) + 1);
    for (const u of usable) {
      if (u.aFromPeriod) orbitsFromPeriod++;
      else orbitsFromAxis++;
      if (u.aFromPeriod && u.a !== null && u.a > 0) {
        axisDisagreement.push(Math.abs(u.aUsed - u.a) / u.a);
      }
    }

    const assumptions: string[] = [];
    if (starRadiusAssumed) {
      assumptions.push(
        "stellar radius not published; approximated from mass via R ≈ M^0.8",
      );
    }
    if (radiusAssumedCount > 0) {
      assumptions.push(
        `${radiusAssumedCount} planet radius value(s) not published; approximated from mass via R ≈ M^0.27`,
      );
    }
    const blankE = usable.filter((p) => p.e === null).length;
    if (blankE > 0) {
      assumptions.push(
        `${blankE} eccentricity value(s) not published; circular orbits assumed`,
      );
    }
    const fromAxis = usable.filter((p) => !p.aFromPeriod).length;
    if (fromAxis === usable.length) {
      assumptions.push(
        "orbit sizes taken from the published semi-major axis; no orbital period is published for this system",
      );
    } else if (fromAxis > 0) {
      assumptions.push(
        `${usable.length - fromAxis} orbit size(s) derived from the published orbital period; ` +
          `${fromAxis} taken from the published semi-major axis where no period is published`,
      );
    } else {
      assumptions.push(
        "orbit sizes derived from the published orbital period and the stellar mass, so each orbit has the period the archive publishes",
      );
    }
    assumptions.push(
      "starting mean anomalies are distributed evenly and are NOT the real orbital phases; this is not an ephemeris",
    );

    const planetWord = n === 1 ? "planet" : "planets";
    const summary =
      `${host} is ${describeStar(planets[0].starTeff, starMass)}, with ${n} known ${planetWord} ` +
      `between ${usable[0].aUsed.toPrecision(3)} and ` +
      `${usable[n - 1].aUsed.toPrecision(3)} AU. ` +
      `Simulated as an n-body system from published orbital elements.`;

    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: `exo-${slugify(host)}`,
      name: host,
      summary,
      category: "exoplanets",
      tags: [
        "exoplanet",
        `${n}-planet-system`,
        ...(n > 1 ? ["multi-planet"] : []),
        ...(usable.some((p) => (p.massEarth as number) > 100) ? ["gas-giant"] : []),
        ...(usable.some((p) => (p.massEarth as number) <= 2) ? ["terrestrial"] : []),
        // Spectral class as a tag, so the catalogue can filter on it without
        // having to parse the summary prose.
        spectralClass(planets[0].starTeff).tag,
      ],
      difficulty: n > 2 ? "intermediate" : "beginner",
      source: {
        provider: "NASA Exoplanet Archive",
        reference: `Planetary Systems Composite Parameters (pscomppars), host ${host}`,
        retrievedAt: RETRIEVED,
        url: "https://exoplanetarchive.ipac.caltech.edu/",
        notes: `${ACKNOWLEDGEMENT} Assumptions: ${assumptions.join("; ")}.`,
      },
      physics: {
        softening: 0,
        integrator: "verlet",
        dt,
        forceMode: "direct",
        theta: 0.5,
        collisions: true,
      },
      bodies,
      camera: {
        distance: Math.max(0.2, (usable[n - 1].a as number) * 2.6),
        target: "star",
      },
    };

    const result = safeParseScenario(doc);
    if (!result.ok) {
      excluded.push({
        host,
        reason: `schema: ${result.issues.slice(0, 2).join("; ")}`,
      });
      continue;
    }
    writeFileSync(
      join(OUT_DIR, `${result.scenario.id}.json`),
      JSON.stringify(result.scenario),
      "utf8",
    );
    written++;
    planetsIncluded += n;
  }

  // --- report ------------------------------------------------------------
  const reasons = new Map<string, number>();
  for (const x of excluded) {
    const key = x.reason.replace(/^[^:]+:\s*/, "").slice(0, 60);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  const report = [
    "# Exoplanet pipeline report",
    "",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Snapshot: data/sources/snapshots/nasa-exoplanet-archive-pscomppars.csv`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Planet rows in snapshot | ${rows.length - 1} |`,
    `| Distinct host systems | ${bySystem.size} |`,
    `| **Systems written** | **${written}** |`,
    `| Planets included | ${planetsIncluded} |`,
    `| Systems excluded | ${excluded.length} |`,
    `| Orbits sized from the published PERIOD | ${orbitsFromPeriod} |`,
    `| Orbits sized from the published semi-major AXIS | ${orbitsFromAxis} |`,
    "",
    "## Why orbits are sized from the period",
    "",
    "`pscomppars` is a COMPOSITE table: each parameter is taken from whichever",
    "reference the archive judges best, so `pl_orbsmax` and `pl_orbper` may come",
    "from different papers, or from the same paper and still disagree. For a",
    "transiting or radial-velocity detection the period is the measured quantity",
    "and the axis is inferred from it, so this pipeline derives the axis back",
    "from the period and the stellar mass it actually integrates with. Each",
    "scenario therefore reproduces the period the archive publishes, which",
    "`tests/catalog/generated-scenarios.test.ts` checks on every CI run.",
    "",
    "How far the published axis would have disagreed, over the",
    `${axisDisagreement.length} planets that have both:`,
    "",
    "| Disagreement in semi-major axis | Planets |",
    "|---|---|",
    ...[0.01, 0.05, 0.1, 0.25].map(
      (t) =>
        `| over ${(t * 100).toFixed(0)}% | ${axisDisagreement.filter((d) => d > t).length} |`,
    ),
    "",
    "## Systems by planet count",
    "",
    "| Planets | Systems |",
    "|---|---|",
    ...[...byPlanetCount.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Exclusions by reason",
    "",
    excluded.length === 0
      ? "None — every system in the snapshot produced a valid scenario."
      : [
          "| Reason | Systems |",
          "|---|---|",
          ...[...reasons.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `| ${k} | ${v} |`),
        ].join("\n"),
    "",
    "Excluded systems are omitted entirely rather than emitted with placeholder",
    "numbers. Every included system records its assumptions in its own citation",
    "block, so no approximation is presented as a measurement.",
    "",
  ].join("\n");

  const reportPath = join(ROOT, "artifacts/09-exoplanet-pipeline-report.md");
  // Through Prettier, so a pipeline run never leaves the repository failing
  // its own format check.
  writeFileSync(
    reportPath,
    await format(report, { parser: "markdown", filepath: reportPath }),
    "utf8",
  );

  console.log(
    `Exoplanet pipeline: ${written} systems written, ${planetsIncluded} planets, ` +
      `${excluded.length} systems excluded. Report: artifacts/09-exoplanet-pipeline-report.md`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
