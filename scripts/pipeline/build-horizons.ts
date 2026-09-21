/**
 * Solar System and Spaceflight scenarios from JPL Horizons state vectors.
 *
 * WHY THIS EXISTS. The hand-built solar-system scenarios are IDEALISED: every
 * body sits at its own perihelion in a single plane, because the generator had
 * only semi-major axis and eccentricity to work with. They say so in their own
 * citations, but "idealised coplanar model" is not the Solar System. These
 * scenarios instead take real barycentric state vectors from JPL Horizons at
 * one recorded epoch, so the inclinations, eccentricities and phases are the
 * real ones and the picture is of the actual sky on a real date.
 *
 * WHY A COMMITTED SNAPSHOT rather than a live query: CI has no outbound
 * access, a build that depends on a third-party service breaks when that
 * service does, and an ephemeris without a pinned epoch is meaningless. The
 * exact request, the epoch and the verification are recorded in
 * data/sources/snapshots/README.md; the terms of use are in
 * artifacts/04-licensing-and-clean-room.md section 11, checked before any of
 * this data was committed.
 *
 * WHAT COMES FROM WHERE, kept deliberately separate so neither source is
 * asked for something it does not measure:
 *   positions and velocities  JPL Horizons (DE441 and the per-body kernels it
 *                             names in each response)
 *   masses and radii          NASA NSSDCA Planetary Fact Sheet
 *
 * Spacecraft are MASSLESS TEST PARTICLES: they feel the planets and the Sun
 * but exert nothing, which is both physically sensible at these mass ratios
 * and what the engine's FLAG_MASSLESS path is for.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  HORIZONS_BODIES,
  toSolarMasses,
  toAu,
  type BodyPhysical,
} from "../../data/sources/solar-system";
import { safeParseScenario, CURRENT_SCHEMA_VERSION } from "../../src/schema/scenario";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";
import { slugify } from "../../src/catalog/format";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SNAPSHOT = join(ROOT, "data/sources/snapshots/jpl-horizons-state-vectors.csv");
const OUT_DIR = join(ROOT, "data/scenarios/horizons");

const RETRIEVED = "2026-09-21";
/** The epoch every body in the snapshot is sampled at. */
const EPOCH_JD = 2461041.5;
const EPOCH_LABEL = "2026-01-01 00:00 TDB (JD 2461041.5)";
const CREDIT = "Courtesy NASA/JPL-Caltech.";
const COMMON_NOTE =
  `State vectors from the JPL Horizons on-line ephemeris system, barycentric, ` +
  `ecliptic of J2000.0, at epoch ${EPOCH_LABEL}. ${CREDIT} ` +
  `Masses and radii from the NASA NSSDCA Planetary Fact Sheet. ` +
  `This is a snapshot of the real configuration at that instant, integrated ` +
  `forward by this simulator — it is NOT an ephemeris, and it will drift from ` +
  `the real Solar System as it runs.`;

interface StateRow {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function readSnapshot(): Map<string, StateRow> {
  const lines = readFileSync(SNAPSHOT, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Snapshot is missing column "${name}".`);
    return i;
  };
  const iId = col("id");
  const iName = col("name");
  const iJd = col("jdtdb");
  const fields = [
    "x_au",
    "y_au",
    "z_au",
    "vx_au_per_day",
    "vy_au_per_day",
    "vz_au_per_day",
  ].map(col);

  const out = new Map<string, StateRow>();
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    const jd = Number(f[iJd]);
    // Every body must be sampled at the SAME instant, or the configuration is
    // not a configuration. Assert it rather than assume it.
    if (jd !== EPOCH_JD) {
      throw new Error(
        `${f[iName]} is at JD ${f[iJd]}, not the common epoch ${EPOCH_JD}. ` +
          `Mixing epochs would produce a Solar System that never existed.`,
      );
    }
    const [x, y, z, vx, vy, vz] = fields.map((i) => Number(f[i]));
    if (![x, y, z, vx, vy, vz].every(Number.isFinite)) {
      throw new Error(`Non-finite state vector for ${f[iName]}.`);
    }
    out.set(f[iId], { id: f[iId], name: f[iName], x, y, z, vx, vy, vz });
  }
  return out;
}

interface Body {
  id: string;
  name: string;
  mass: number;
  radius: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  massless?: boolean;
  colour: string;
}

function toBody(row: StateRow, physical: BodyPhysical): Body {
  const mass = toSolarMasses(physical.massE24Kg);
  return {
    id: slugify(physical.name),
    name: physical.name,
    mass,
    radius: toAu(physical.radiusKm),
    position: { x: row.x, y: row.y, z: row.z },
    velocity: { x: row.vx, y: row.vy, z: row.vz },
    ...(mass === 0 ? { massless: true } : {}),
    colour: physical.colour,
  };
}

/**
 * Shortest orbital period anywhere in the system, in days.
 *
 * Taken over EVERY pair in which one body is heavier than the other, not just
 * pairs involving the heaviest body. In a hierarchical system that difference
 * matters: the Moon's period about the Sun is a year, but the motion the
 * timestep has to resolve is its 27-day orbit about the Earth. Sizing the step
 * from the solar orbit would have given the Webb scenario 150 steps per lunar
 * orbit instead of several thousand.
 *
 * Unbound pairs contribute nothing, so an escaping spacecraft cannot force an
 * absurdly small step.
 */
function shortestPeriodDays(bodies: readonly Body[]): number {
  let shortest = Infinity;
  for (const body of bodies) {
    for (const centre of bodies) {
      if (centre === body || centre.mass <= body.mass) continue;
      const r = Math.hypot(
        body.position.x - centre.position.x,
        body.position.y - centre.position.y,
        body.position.z - centre.position.z,
      );
      if (r === 0) continue;
      const v2 =
        (body.velocity.x - centre.velocity.x) ** 2 +
        (body.velocity.y - centre.velocity.y) ** 2 +
        (body.velocity.z - centre.velocity.z) ** 2;
      const mu = G_AU3_PER_MSUN_DAY2 * (centre.mass + body.mass);
      const energy = v2 / 2 - mu / r;
      if (energy >= 0) continue;
      const a = -mu / (2 * energy);
      const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
      if (Number.isFinite(period) && period > 0) shortest = Math.min(shortest, period);
    }
  }
  return Number.isFinite(shortest) ? shortest : 365.25;
}

/**
 * Camera distance that frames the whole system.
 *
 * The renderer uses a 50-degree perspective camera, so at distance d it shows
 * a half-width of d * tan(25 deg) = 0.466 d at the focal plane. Fitting a
 * system of radius R therefore needs d >= R / 0.466 = 2.15 R, and the camera
 * also sits at an elevation, which costs more. 3.0 R was checked against the
 * rendered output: at the 2.3 R this started with, Neptune was outside the
 * frame in the M4 screenshot.
 */
function framingDistance(bodies: readonly Body[], targetId?: string): number {
  // Framed about what the camera is actually looking at. For the Webb
  // scenario that is the Earth, and framing it about the Sun instead would
  // put the camera 3 AU away from a configuration 0.01 AU across.
  const centre =
    (targetId !== undefined ? bodies.find((b) => b.id === targetId) : undefined) ??
    bodies.reduce((a, b) => (b.mass > a.mass ? b : a));
  let radius = 0;
  for (const body of bodies) {
    if (body === centre) continue;
    radius = Math.max(
      radius,
      Math.hypot(
        body.position.x - centre.position.x,
        body.position.y - centre.position.y,
        body.position.z - centre.position.z,
      ),
    );
  }
  return radius > 0 ? Number((3.0 * radius).toPrecision(3)) : 5;
}

interface Spec {
  id: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  /** Horizons ids, heaviest first is not required. */
  bodies: string[];
  cameraTarget?: string;
  extraNotes?: string;
  /** Only where the automatic framing is wrong for the story being told. */
  cameraDistanceOverride?: number;
  /** Steps per shortest orbit. Higher where a close approach needs resolving. */
  stepsPerOrbit?: number;
}

const SPECS: Spec[] = [
  {
    id: "solar-system-epoch",
    name: "The Solar System, right now",
    summary:
      "The Sun and all eight planets at their real positions and velocities on " +
      "1 January 2026, taken from JPL Horizons. Unlike a textbook diagram the " +
      "orbits are genuinely inclined to one another and genuinely elliptical.",
    category: "solar-system",
    tags: ["solar-system", "planets", "ephemeris", "horizons", "eight-planets"],
    difficulty: "beginner",
    bodies: ["10", "199", "299", "399", "499", "599", "699", "799", "899"],
    cameraTarget: "sun",
  },
  {
    id: "inner-solar-system-epoch",
    name: "The inner Solar System, right now",
    summary:
      "Mercury, Venus, Earth, the Moon and Mars at their real positions on " +
      "1 January 2026. Mercury's orbit is visibly off-centre and visibly tilted " +
      "against the others.",
    category: "solar-system",
    tags: ["solar-system", "inner-planets", "ephemeris", "horizons", "moon"],
    difficulty: "beginner",
    bodies: ["10", "199", "299", "399", "301", "499"],
    cameraTarget: "sun",
    stepsPerOrbit: 600,
  },
  {
    id: "outer-solar-system-epoch",
    name: "The outer Solar System, right now",
    summary:
      "Jupiter, Saturn, Uranus, Neptune and Pluto at their real positions on " +
      "1 January 2026. Pluto's orbit is steeply inclined and clearly crosses " +
      "Neptune's in projection.",
    category: "solar-system",
    tags: ["solar-system", "outer-planets", "ephemeris", "horizons", "pluto"],
    difficulty: "beginner",
    bodies: ["10", "599", "699", "799", "899", "999"],
    cameraTarget: "sun",
  },
  {
    id: "voyager-1-interstellar",
    name: "Voyager 1 in interstellar space",
    summary:
      "Voyager 1 on 1 January 2026, about 168 astronomical units from the Sun " +
      "and still climbing out of its gravity well. Shown with the giant planets " +
      "whose gravity threw it there in 1979 and 1980.",
    category: "spaceflight",
    tags: ["spaceflight", "voyager", "interstellar", "horizons", "escape-trajectory"],
    difficulty: "intermediate",
    bodies: ["10", "599", "699", "799", "899", "-31"],
    cameraTarget: "sun",
    extraNotes:
      "Voyager 1 is modelled as a massless test particle: it feels the Sun and " +
      "the planets but exerts no gravity of its own, which at a mass ratio of " +
      "about 1e-25 is the physically honest simplification. Its drawn size is " +
      "a display size, not a measurement.",
  },
  {
    id: "voyager-2-interstellar",
    name: "Voyager 2 in interstellar space",
    summary:
      "Voyager 2 on 1 January 2026, the only spacecraft to have visited all " +
      "four giant planets, now leaving the Solar System far below the plane of " +
      "the planets.",
    category: "spaceflight",
    tags: ["spaceflight", "voyager", "interstellar", "horizons", "escape-trajectory"],
    difficulty: "intermediate",
    bodies: ["10", "599", "699", "799", "899", "-32"],
    cameraTarget: "sun",
    extraNotes:
      "Voyager 2 is modelled as a massless test particle. Its drawn size is a " +
      "display size, not a measurement.",
  },
  {
    id: "new-horizons-beyond-pluto",
    name: "New Horizons beyond Pluto",
    summary:
      "New Horizons on 1 January 2026, well past Pluto and heading out through " +
      "the Kuiper belt, shown with Jupiter — which gave it the gravity assist " +
      "in 2007 — and with Pluto itself.",
    category: "spaceflight",
    tags: ["spaceflight", "new-horizons", "kuiper-belt", "horizons", "gravity-assist"],
    difficulty: "intermediate",
    bodies: ["10", "599", "699", "899", "999", "-98"],
    cameraTarget: "sun",
    extraNotes:
      "New Horizons is modelled as a massless test particle. Its drawn size is " +
      "a display size, not a measurement.",
  },
  {
    id: "parker-solar-probe",
    name: "Parker Solar Probe",
    summary:
      "Parker Solar Probe on 1 January 2026, on the steep, fast ellipse that " +
      "repeatedly takes it closer to the Sun than any spacecraft has been. " +
      "Venus, whose gravity shrank that orbit seven times, is shown with it.",
    category: "spaceflight",
    tags: ["spaceflight", "parker", "sun", "horizons", "gravity-assist"],
    difficulty: "advanced",
    bodies: ["10", "199", "299", "399", "-96"],
    cameraTarget: "sun",
    stepsPerOrbit: 2000,
    extraNotes:
      "Parker Solar Probe is modelled as a massless test particle. Its orbit " +
      "passes very close to the Sun, so the timestep here is far finer than in " +
      "the other scenarios; it is still a fixed step, and the energy drift " +
      "readout will show you what that costs near perihelion. Its drawn size is " +
      "a display size, not a measurement.",
  },
  {
    id: "jwst-at-l2",
    name: "Webb at the second Lagrange point",
    summary:
      "The James Webb Space Telescope on 1 January 2026, holding station near " +
      "the Earth–Sun L2 point about 1.5 million kilometres beyond the Earth. " +
      "Run it and watch it stay with the Earth rather than fall behind.",
    category: "spaceflight",
    tags: ["spaceflight", "jwst", "lagrange", "horizons", "l2"],
    difficulty: "advanced",
    bodies: ["10", "399", "301", "-170"],
    cameraTarget: "earth",
    // Framed on the Earth-Moon-L2 neighbourhood. Automatic framing would use
    // the Sun, which is 1 AU away and 100x the scale of interest.
    cameraDistanceOverride: 0.05,
    stepsPerOrbit: 2000,
    extraNotes:
      "Webb is modelled as a massless test particle. L2 is an unstable " +
      "equilibrium: the real telescope fires thrusters to stay near it, and " +
      "this simulation does not, so over a long run it will drift away. That " +
      "drift is the physics, not a bug. Its drawn size is a display size, not " +
      "a measurement.",
  },
];

/** Build one scenario document from its spec. Pure: no I/O, no side effects. */
function buildScenario(spec: Spec, snapshot: Map<string, StateRow>): unknown {
  const bodies: Body[] = [];
  for (const horizonsId of spec.bodies) {
    const row = snapshot.get(horizonsId);
    const physical = HORIZONS_BODIES[horizonsId];
    if (!row || !physical) {
      throw new Error(`no snapshot row or physical data for Horizons id ${horizonsId}`);
    }
    bodies.push(toBody(row, physical));
  }

  /*
   * NOT shifted to the centre of momentum.
   *
   * Everywhere else in this catalogue a system is re-centred so it does not
   * drift. Here the frame is already meaningful: it is the solar-system
   * barycentre, and the Sun's motion about it is a real, observable effect
   * that these scenarios are partly there to show. Re-centring a SUBSET of
   * the Solar System would also be wrong, because the momentum of the bodies
   * left out is not zero.
   */
  const period = shortestPeriodDays(bodies);
  const dt = Math.max(
    1e-6,
    Number((period / (spec.stepsPerOrbit ?? 400)).toPrecision(3)),
  );

  const displayOnly = spec.bodies
    .map((id) => HORIZONS_BODIES[id])
    .filter((b) => b.displayRadiusOnly)
    .map((b) => b.name);

  const notes = [
    COMMON_NOTE,
    spec.extraNotes,
    displayOnly.length > 0
      ? `Drawn at a display size rather than a physical one: ${displayOnly.join(", ")}.`
      : undefined,
  ]
    .filter((n): n is string => n !== undefined)
    .join(" ");

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    category: spec.category,
    tags: spec.tags,
    difficulty: spec.difficulty,
    // Hand-authored, like the other curated scenarios.
    featured: true,
    source: {
      provider: "NASA JPL Horizons",
      reference: `Barycentric state vectors at ${EPOCH_LABEL}; bodies ${spec.bodies.join(", ")}`,
      retrievedAt: RETRIEVED,
      url: "https://ssd.jpl.nasa.gov/horizons/",
      notes,
    },
    physics: {
      softening: 0,
      integrator: "verlet" as const,
      dt,
      forceMode: "direct" as const,
      theta: 0.5,
      collisions: false,
    },
    bodies,
    camera: {
      distance:
        spec.cameraDistanceOverride ?? framingDistance(bodies, spec.cameraTarget),
      target: spec.cameraTarget,
    },
  };
}

async function main(): Promise<void> {
  const snapshot = readSnapshot();

  // Build and validate EVERYTHING before writing anything, so a failure never
  // leaves a half-populated directory behind.
  const ready: { spec: Spec; scenario: unknown }[] = [];
  const failures: string[] = [];

  for (const spec of SPECS) {
    try {
      const result = safeParseScenario(buildScenario(spec, snapshot));
      if (!result.ok) failures.push(`${spec.id}: ${result.issues.join("; ")}`);
      else ready.push({ spec, scenario: result.scenario });
    } catch (error) {
      failures.push(
        `${spec.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("Horizons pipeline failed:\n");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { spec, scenario } of ready) {
    const path = join(OUT_DIR, `${spec.id}.json`);
    writeFileSync(
      path,
      await format(JSON.stringify(scenario), { parser: "json", filepath: path }),
      "utf8",
    );
  }

  console.log(
    `Horizons pipeline: ${ready.length} scenarios written at epoch ${EPOCH_LABEL}\n` +
      `  ${ready.map((r) => r.spec.id).join(", ")}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
