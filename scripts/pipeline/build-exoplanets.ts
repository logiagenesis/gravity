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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { elementsToStateVectors, orbitalPeriodDays } from "../../src/sim/kepler";
import { safeParseScenario, CURRENT_SCHEMA_VERSION } from "../../src/schema/scenario";

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
  a: number | null;
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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

function describeStar(teff: number | null, mass: number): string {
  const t = teff ?? 0;
  let kind: string;
  if (t >= 10000) kind = "a hot blue-white star";
  else if (t >= 7500) kind = "a white A-type star";
  else if (t >= 6000) kind = "a Sun-like F/G-type star";
  else if (t >= 5200) kind = "a Sun-like G-type star";
  else if (t >= 3700) kind = "an orange K-type dwarf";
  else if (t > 0) kind = "a cool red M-dwarf";
  else kind = "a star of unrecorded temperature";
  return `${kind} of ${mass.toFixed(2)} solar masses`;
}

interface Excluded {
  host: string;
  reason: string;
}

function main(): void {
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

  if ([iPl, iHost, iA, iM, iSm].some((i) => i < 0)) {
    console.error("Snapshot is missing required columns.");
    process.exit(1);
  }

  const bySystem = new Map<string, Row[]>();
  for (const r of rows.slice(1)) {
    const row: Row = {
      planet: r[iPl],
      host: r[iHost],
      a: num(r[iA]),
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

  for (const [host, planets] of bySystem) {
    const starMass = planets[0].starMass;
    if (starMass === null || starMass <= 0) {
      excluded.push({ host, reason: "no stellar mass" });
      continue;
    }

    // Keep only planets with the minimum usable set.
    const usable = planets.filter(
      (p) => p.a !== null && p.a > 0 && p.massEarth !== null && p.massEarth > 0,
    );
    if (usable.length === 0) {
      excluded.push({ host, reason: "no planet with both semi-major axis and mass" });
      continue;
    }

    usable.sort((x, y) => (x.a as number) - (y.a as number));

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
      const a = p.a as number;
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
    const innermost = usable[0].a as number;
    const shortestPeriod = orbitalPeriodDays(innermost, starMass);
    const dt = Math.max(1e-6, Number((shortestPeriod / 400).toPrecision(3)));

    const n = usable.length;
    byPlanetCount.set(n, (byPlanetCount.get(n) ?? 0) + 1);

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
    assumptions.push(
      "starting mean anomalies are distributed evenly and are NOT the real orbital phases; this is not an ephemeris",
    );

    const planetWord = n === 1 ? "planet" : "planets";
    const summary =
      `${host} is ${describeStar(planets[0].starTeff, starMass)}, with ${n} known ${planetWord} ` +
      `between ${(usable[0].a as number).toPrecision(3)} and ` +
      `${(usable[n - 1].a as number).toPrecision(3)} AU. ` +
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

  writeFileSync(
    join(ROOT, "artifacts/09-exoplanet-pipeline-report.md"),
    report,
    "utf8",
  );

  console.log(
    `Exoplanet pipeline: ${written} systems written, ${planetsIncluded} planets, ` +
      `${excluded.length} systems excluded. Report: artifacts/09-exoplanet-pipeline-report.md`,
  );
}

main();
