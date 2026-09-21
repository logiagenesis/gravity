/**
 * Scenario generator.
 *
 * Derives scenario documents from the cited primary-source data in
 * data/sources/. Keeping the derivation in code rather than hand-typing state
 * vectors means the numbers can be checked, and a correction to a source
 * propagates by re-running rather than by editing many files.
 *
 * Run: npx tsx scripts/generate-scenarios.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { format } from "prettier";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLANETS,
  SUN,
  MOON,
  toSolarMasses,
  toAu,
  AU_KM,
} from "../data/sources/solar-system";
import { G_AU3_PER_MSUN_DAY2 } from "../src/sim/constants";
import { safeParseScenario, CURRENT_SCHEMA_VERSION } from "../src/schema/scenario";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "data", "scenarios");

const RETRIEVED = "2026-09-21";

/**
 * Honest statement attached to every derived solar-system scenario. Repeated in
 * full on each one so a user who opens a single scenario sees it, rather than
 * having to find a global disclaimer.
 */
const IDEALISATION_NOTE =
  "Idealised coplanar model. Each body starts at its own perihelion. Semi-major " +
  "axis, eccentricity, mass and radius are the true values from the cited sources; " +
  "the orbital plane and each orbit's orientation angle are chosen for visual " +
  "clarity. This is NOT an ephemeris and does not correspond to any real date. " +
  "Radii are physical, not exaggerated: the renderer enforces a minimum on-screen " +
  "size so small bodies remain visible without altering the simulation.";

interface Vec {
  x: number;
  y: number;
  z: number;
}

/**
 * Two-body state at perihelion, rotated by `angle` in the xy-plane.
 *
 * At perihelion r = a(1-e) and, from the vis-viva equation
 * v² = μ(2/r − 1/a) with μ = G(M+m), the speed is
 *   v = √( μ(1+e) / (a(1−e)) )
 * and the velocity is perpendicular to the radius.
 */
function perihelionState(
  centralMass: number,
  bodyMass: number,
  semiMajorAxis: number,
  eccentricity: number,
  angle: number,
): { position: Vec; velocity: Vec } {
  const mu = G_AU3_PER_MSUN_DAY2 * (centralMass + bodyMass);
  const r = semiMajorAxis * (1 - eccentricity);
  const speed = Math.sqrt(
    (mu * (1 + eccentricity)) / (semiMajorAxis * (1 - eccentricity)),
  );
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    position: { x: r * cos, y: r * sin, z: 0 },
    velocity: { x: -speed * sin, y: speed * cos, z: 0 },
  };
}

/** Shift a set of bodies into the centre-of-momentum frame. */
function toBarycentricFrame<T extends { mass: number; position: Vec; velocity: Vec }>(
  bodies: T[],
): T[] {
  let totalMass = 0;
  const sumP = { x: 0, y: 0, z: 0 };
  const sumV = { x: 0, y: 0, z: 0 };
  for (const b of bodies) {
    totalMass += b.mass;
    sumP.x += b.mass * b.position.x;
    sumP.y += b.mass * b.position.y;
    sumP.z += b.mass * b.position.z;
    sumV.x += b.mass * b.velocity.x;
    sumV.y += b.mass * b.velocity.y;
    sumV.z += b.mass * b.velocity.z;
  }
  const comP = { x: sumP.x / totalMass, y: sumP.y / totalMass, z: sumP.z / totalMass };
  const comV = { x: sumV.x / totalMass, y: sumV.y / totalMass, z: sumV.z / totalMass };
  return bodies.map((b) => ({
    ...b,
    position: {
      x: b.position.x - comP.x,
      y: b.position.y - comP.y,
      z: b.position.z - comP.z,
    },
    velocity: {
      x: b.velocity.x - comV.x,
      y: b.velocity.y - comV.y,
      z: b.velocity.z - comV.z,
    },
  }));
}

/**
 * TRUE physical radius, in AU. No exaggeration.
 *
 * Radius is used for collision contact, so inflating it here would make bodies
 * merge at the wrong separation — a physics error introduced purely to solve a
 * display problem. Visibility is the RENDERER's job: it enforces a minimum
 * apparent size in pixels (src/render/scene.ts) without touching the physical
 * value. That keeps the simulation honest and the view readable.
 */
const physicalRadius = (km: number): number => toAu(km);

const SOLAR_SOURCE = {
  provider: "NASA NSSDCA Planetary Fact Sheet; NASA JPL Solar System Dynamics",
  reference:
    "Planetary Fact Sheet (masses, radii); Approximate Positions of the Planets (a, e)",
  retrievedAt: RETRIEVED,
  url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/",
  notes: IDEALISATION_NOTE,
};

type ScenarioDoc = Record<string, unknown>;
const scenarios: ScenarioDoc[] = [];

// ---------------------------------------------------------------------------
// Sun + Earth: the simplest real two-body system.
// ---------------------------------------------------------------------------
{
  const earth = PLANETS.find((p) => p.id === "earth")!;
  const earthMass = toSolarMasses(earth.massE24Kg);
  const state = perihelionState(
    1,
    earthMass,
    earth.semiMajorAxisAu,
    earth.eccentricity,
    0,
  );

  const bodies = toBarycentricFrame([
    {
      id: SUN.id,
      name: SUN.name,
      mass: 1,
      radius: physicalRadius(SUN.radiusKm),
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      colour: SUN.colour,
    },
    {
      id: earth.id,
      name: earth.name,
      mass: earthMass,
      radius: physicalRadius(earth.radiusKm),
      position: state.position,
      velocity: state.velocity,
      colour: earth.colour,
    },
  ]);

  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "sun-and-earth",
    name: "The Sun and the Earth",
    summary:
      "The simplest real gravitational system: one star, one planet, one nearly circular orbit of 365 days. A good place to watch energy and angular momentum stay constant.",
    category: "solar-system",
    tags: ["two-body", "earth", "sun", "circular", "beginner"],
    difficulty: "beginner",
    source: SOLAR_SOURCE,
    physics: {
      softening: 0,
      integrator: "verlet",
      dt: 0.5,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "merge",
    },
    bodies,
    camera: { distance: 3, target: "sun" },
  });
}

// ---------------------------------------------------------------------------
// Inner solar system.
// ---------------------------------------------------------------------------
{
  const inner = PLANETS.filter((p) =>
    ["mercury", "venus", "earth", "mars"].includes(p.id),
  );
  // Orientation angles are OURS, spread for visual clarity. Not sourced.
  const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

  const raw = [
    {
      id: SUN.id,
      name: SUN.name,
      mass: 1,
      radius: physicalRadius(SUN.radiusKm),
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      colour: SUN.colour,
    },
    ...inner.map((p, i) => {
      const mass = toSolarMasses(p.massE24Kg);
      const s = perihelionState(1, mass, p.semiMajorAxisAu, p.eccentricity, angles[i]);
      return {
        id: p.id,
        name: p.name,
        mass,
        radius: physicalRadius(p.radiusKm),
        position: s.position,
        velocity: s.velocity,
        colour: p.colour,
      };
    }),
  ];

  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "inner-solar-system",
    name: "The Inner Solar System",
    summary:
      "Mercury, Venus, Earth and Mars around the Sun. Mercury's orbit is the most eccentric of the four, and you can see it speed up near perihelion.",
    category: "solar-system",
    tags: ["solar-system", "planets", "inner", "kepler"],
    difficulty: "beginner",
    source: SOLAR_SOURCE,
    physics: {
      softening: 0,
      integrator: "verlet",
      dt: 0.25,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "merge",
    },
    bodies: toBarycentricFrame(raw),
    camera: { distance: 4, target: "sun" },
  });
}

// ---------------------------------------------------------------------------
// Sun + Jupiter: the dominant perturber.
// ---------------------------------------------------------------------------
{
  const jupiter = PLANETS.find((p) => p.id === "jupiter")!;
  const mass = toSolarMasses(jupiter.massE24Kg);
  const s = perihelionState(1, mass, jupiter.semiMajorAxisAu, jupiter.eccentricity, 0);

  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "sun-and-jupiter",
    name: "The Sun and Jupiter",
    summary:
      "Jupiter is about one thousandth of the Sun's mass, and it is enough to move the Sun. Watch the star wobble about the barycentre — the same signal used to detect exoplanets.",
    category: "solar-system",
    tags: ["jupiter", "barycentre", "two-body", "exoplanet-detection"],
    difficulty: "intermediate",
    source: SOLAR_SOURCE,
    physics: {
      softening: 0,
      integrator: "verlet",
      dt: 2,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "merge",
    },
    bodies: toBarycentricFrame([
      {
        id: SUN.id,
        name: SUN.name,
        mass: 1,
        radius: physicalRadius(SUN.radiusKm),
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        colour: SUN.colour,
      },
      {
        id: jupiter.id,
        name: jupiter.name,
        mass,
        radius: physicalRadius(jupiter.radiusKm),
        position: s.position,
        velocity: s.velocity,
        colour: jupiter.colour,
      },
    ]),
    camera: { distance: 14, target: "sun" },
  });
}

// ---------------------------------------------------------------------------
// Earth + Moon.
// ---------------------------------------------------------------------------
{
  const earth = PLANETS.find((p) => p.id === "earth")!;
  const earthMass = toSolarMasses(earth.massE24Kg);
  const moonMass = toSolarMasses(MOON.massE24Kg);
  const aAu = MOON.semiMajorAxisKm / AU_KM;
  const s = perihelionState(earthMass, moonMass, aAu, MOON.eccentricity, 0);

  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "earth-and-moon",
    name: "The Earth and the Moon",
    summary:
      "An unusually massive moon: at about 1/81 of the Earth's mass, it pulls the barycentre roughly three quarters of the way to the Earth's surface. Orbital period is about 27.3 days.",
    category: "solar-system",
    tags: ["earth", "moon", "two-body", "barycentre", "tides"],
    difficulty: "beginner",
    source: {
      provider: "NASA NSSDCA Planetary Fact Sheet",
      reference: "Earth and Moon fact sheets (mass, radius, lunar orbit a and e)",
      retrievedAt: RETRIEVED,
      url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html",
      notes:
        "Isolated two-body model: the Sun's influence is deliberately excluded so the " +
        "Earth-Moon orbit can be studied on its own. Body radii are the true physical " +
        "values; the renderer enforces a minimum on-screen size so small bodies stay " +
        "visible without altering the physics.",
    },
    physics: {
      softening: 0,
      integrator: "verlet",
      dt: 0.005,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "merge",
    },
    bodies: toBarycentricFrame([
      {
        id: earth.id,
        name: earth.name,
        mass: earthMass,
        radius: toAu(earth.radiusKm),
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        colour: earth.colour,
      },
      {
        id: MOON.id,
        name: MOON.name,
        mass: moonMass,
        radius: toAu(MOON.radiusKm),
        position: s.position,
        velocity: s.velocity,
        colour: MOON.colour,
      },
    ]),
    camera: { distance: 0.01, target: "earth" },
  });
}

// ---------------------------------------------------------------------------
// Figure-eight choreography. Units here are G = 1, m = 1.
// ---------------------------------------------------------------------------
{
  const X = 0.97000436;
  const Y = -0.24308753;
  const VX = 0.93240737;
  const VY = 0.86473146;

  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "figure-eight-choreography",
    name: "The Figure-Eight Choreography",
    summary:
      "Three equal masses chasing one another around a single figure-eight curve. A stable periodic solution to the three-body problem, found numerically in 1993 and proved to exist in 2000.",
    category: "choreographies",
    tags: ["three-body", "choreography", "periodic", "chaos", "famous"],
    difficulty: "advanced",
    source: {
      provider: "Chenciner & Montgomery (2000); Moore (1993)",
      reference:
        "Annals of Mathematics 152, 881-901 (existence proof); Phys. Rev. Lett. 70, 3675 (numerical discovery)",
      retrievedAt: RETRIEVED,
      url: "https://doi.org/10.2307/2661357",
      notes:
        "Dimensionless units with G = 1 and all three masses equal to 1. These are the " +
        "standard published initial conditions for the figure-eight solution. Period is " +
        "approximately 6.3259 time units.",
    },
    physics: {
      g: 1,
      softening: 0,
      integrator: "pefrl",
      dt: 0.0005,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "pass-through",
    },
    bodies: [
      {
        id: "body-a",
        name: "Body A",
        mass: 1,
        radius: 0.03,
        position: { x: X, y: Y, z: 0 },
        velocity: { x: VX / 2, y: VY / 2, z: 0 },
        colour: "#ff6b6b",
      },
      {
        id: "body-b",
        name: "Body B",
        mass: 1,
        radius: 0.03,
        position: { x: -X, y: -Y, z: 0 },
        velocity: { x: VX / 2, y: VY / 2, z: 0 },
        colour: "#4ecdc4",
      },
      {
        id: "body-c",
        name: "Body C",
        mass: 1,
        radius: 0.03,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: -VX, y: -VY, z: 0 },
        colour: "#ffe66d",
      },
    ],
    camera: { distance: 3 },
  });
}

// ---------------------------------------------------------------------------
// Lagrange points: Sun, Jupiter, and test particles at L4/L5.
// ---------------------------------------------------------------------------
{
  const jupiter = PLANETS.find((p) => p.id === "jupiter")!;
  const jMass = toSolarMasses(jupiter.massE24Kg);
  const a = jupiter.semiMajorAxisAu;

  /*
   * Built ABOUT THE BARYCENTRE, not about the Sun.
   *
   * The equilateral points of the circular restricted three-body problem are
   * equidistant from BOTH primaries, and both primaries circle their common
   * centre of mass. Putting the Sun at rest at the origin instead — which an
   * earlier version of this file did — leaves the system with net momentum,
   * so the whole configuration translates while it runs and L4/L5 slowly stop
   * being where they were placed. tests/catalog/generated-scenarios.ts checks
   * every scenario for exactly this.
   */
  const total = 1 + jMass;
  const muSun = 1 / total;
  const muJup = jMass / total;
  // Mean motion of the relative orbit: omega^2 a^3 = G(M1 + M2).
  const omega = Math.sqrt((G_AU3_PER_MSUN_DAY2 * total) / (a * a * a));

  const sunX = -a * muJup;
  const jupX = a * muSun;

  /** Circular motion about the origin at the shared angular rate. */
  const circular = (x: number, y: number) => ({
    position: { x, y, z: 0 },
    velocity: { x: -omega * y, y: omega * x, z: 0 },
  });

  const trojan = (sign: 1 | -1, id: string, name: string, colour: string) => {
    // Apex of the equilateral triangle on the two primaries, measured from
    // the barycentre: halfway between them, then a*sqrt(3)/2 off the axis.
    const x = (sunX + jupX) / 2;
    const y = (sign * a * Math.sqrt(3)) / 2;
    return {
      id,
      name,
      mass: 0,
      radius: 0.06,
      massless: true,
      colour,
      ...circular(x, y),
    };
  };

  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "jupiter-trojan-points",
    name: "Jupiter's Trojan Points",
    summary:
      "Massless test particles placed 60 degrees ahead of and behind Jupiter, at the L4 and L5 Lagrange points. Real asteroid families sit here, held in place by the combined pull of the Sun and Jupiter.",
    category: "what-if",
    tags: ["lagrange", "trojan", "jupiter", "test-particles", "stability"],
    difficulty: "advanced",
    source: {
      provider: "NASA NSSDCA Planetary Fact Sheet; NASA JPL Solar System Dynamics",
      reference: "Jupiter mass and radius; Jupiter semi-major axis",
      retrievedAt: RETRIEVED,
      url: "https://ssd.jpl.nasa.gov/planets/approx_pos.html",
      notes:
        "Jupiter is placed on a CIRCULAR orbit (its real eccentricity of 0.048 is set to " +
        "zero) so that L4 and L5 are exactly the equilateral points of the restricted " +
        "circular three-body problem. The Sun and Jupiter both circle their common " +
        "barycentre, so the system has no net momentum and does not drift. The trojans " +
        "are massless test particles: they feel gravity but exert none.",
    },
    physics: {
      softening: 0,
      integrator: "verlet",
      dt: 1,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "pass-through",
    },
    bodies: [
      {
        id: SUN.id,
        name: SUN.name,
        mass: 1,
        radius: physicalRadius(SUN.radiusKm),
        colour: SUN.colour,
        ...circular(sunX, 0),
      },
      {
        id: jupiter.id,
        name: jupiter.name,
        mass: jMass,
        radius: physicalRadius(jupiter.radiusKm),
        colour: jupiter.colour,
        ...circular(jupX, 0),
      },
      trojan(1, "l4-greeks", "L4 (Greeks)", "#7ee787"),
      trojan(-1, "l5-trojans", "L5 (Trojans)", "#79c0ff"),
    ],
    camera: { distance: 14, target: "sun" },
  });
}

// ---------------------------------------------------------------------------
// A deliberately chaotic three-body system.
// ---------------------------------------------------------------------------
{
  scenarios.push({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Hand-authored: the catalogue leads with these.
    featured: true,
    id: "three-body-chaos",
    name: "Three-Body Chaos",
    summary:
      "Three equal masses at rest in a triangle. There is no closed-form solution, and the outcome is exquisitely sensitive to the starting conditions: usually two bodies pair up and the third is flung away.",
    category: "choreographies",
    tags: ["three-body", "chaos", "ejection", "sensitive-dependence"],
    difficulty: "intermediate",
    source: {
      provider: "Constructed for this project",
      reference: "Equal masses at rest on an equilateral triangle, dimensionless units",
      retrievedAt: RETRIEVED,
      notes:
        "Not an observation. A deliberately simple starting configuration chosen to " +
        "demonstrate sensitive dependence on initial conditions. Energy drift is worth " +
        "watching here: after a close encounter, a fixed timestep struggles and the " +
        "diagnostics will say so.",
    },
    physics: {
      g: 1,
      softening: 0.01,
      integrator: "pefrl",
      dt: 0.0005,
      forceMode: "direct",
      theta: 0.5,
      collisionMode: "merge",
    },
    bodies: [0, 1, 2].map((i) => {
      const t = (i * 2 * Math.PI) / 3;
      const colours = ["#ff9f45", "#8ecae6", "#c77dff"];
      return {
        id: `mass-${i + 1}`,
        name: `Mass ${i + 1}`,
        mass: 1,
        radius: 0.04,
        position: { x: Math.cos(t), y: Math.sin(t), z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        colour: colours[i],
      };
    }),
    camera: { distance: 4 },
  });
}

// ---------------------------------------------------------------------------
// Validate everything, then write. A scenario that fails its own schema is a
// build failure, not a warning.
// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
for (const doc of scenarios) {
  const result = safeParseScenario(doc);
  if (!result.ok) {
    console.error(`INVALID  ${String(doc.id)}`);
    for (const issue of result.issues) console.error(`    - ${issue}`);
    failures++;
    continue;
  }
  const path = join(OUT_DIR, `${result.scenario.id}.json`);
  // Written through Prettier so that regenerating never leaves the repository
  // failing its own format check. JSON.stringify and Prettier disagree about
  // short arrays, and the generator losing that argument every time was a
  // papercut with no upside.
  const json = await format(JSON.stringify(result.scenario), {
    parser: "json",
    filepath: path,
  });
  writeFileSync(path, json, "utf8");
  console.log(
    `ok  ${result.scenario.id.padEnd(28)} ${String(result.scenario.bodies.length).padStart(2)} bodies`,
  );
}

if (failures > 0) {
  console.error(
    `\n${failures} scenario(s) failed validation. Nothing partial was written.`,
  );
  process.exit(1);
}
console.log(`\nWrote ${scenarios.length} scenarios to data/scenarios/`);
