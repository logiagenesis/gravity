/**
 * Binary-star scenarios from DEBCat.
 *
 * WHY THIS SOURCE. A binary star is the cleanest two-body problem there is:
 * two comparable masses circling a common barycentre. To simulate one honestly
 * you need BOTH component masses as measurements, and detached eclipsing
 * binaries are the systems where astronomy actually has them — an eclipsing,
 * double-lined system yields each star's mass and radius directly from the
 * light curve and the radial velocities. DEBCat is the standing compilation of
 * those results.
 *
 * The alternative considered was MORBBINCAT (Malkov et al. 2012), which covers
 * far more systems but publishes only the TOTAL dynamical mass. Splitting that
 * total would have meant applying a mass-luminosity or spectral-type model to
 * every system, putting an assumption at the heart of every scenario. Measured
 * beats modelled, so DEBCat it is. Both are recorded in
 * artifacts/04-licensing-and-clean-room.md section 11.
 *
 * WHAT IS MEASURED AND WHAT IS ASSUMED, stated per scenario in its own
 * citation block:
 *   measured  orbital period, both masses, both radii, both temperatures
 *   derived   separation, from Kepler's third law with the measured period and
 *             the measured total mass — so the orbit reproduces the published
 *             period by construction
 *   assumed   a circular orbit. DEBCat does not tabulate eccentricity. Close
 *             detached binaries are usually tidally circularised, but not all
 *             of them are, and the scenarios say so rather than implying the
 *             eccentricity was looked up.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { safeParseScenario, CURRENT_SCHEMA_VERSION } from "../../src/schema/scenario";
import { G_AU3_PER_MSUN_DAY2 } from "../../src/sim/constants";
import { slugify } from "../../src/catalog/format";
import { AU_KM } from "../../data/sources/solar-system";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SNAPSHOT = join(ROOT, "data/sources/snapshots/debcat-debs.dat");
const OUT_DIR = join(ROOT, "data/scenarios/binaries");

const RETRIEVED = "2026-09-21";
const CITATION =
  "Southworth (2015), DEBCat: A Catalog of Detached Eclipsing Binary Stars, " +
  "ASP Conference Series 496, 164.";

/** Solar radius in km. NASA NSSDCA Sun fact sheet. */
const SOLAR_RADIUS_KM = 695_700;
/** DEBCat writes an unmeasured value as -9.99. */
const MISSING = -9.99;

interface Debs {
  system: string;
  spectralType1: string;
  spectralType2: string;
  periodDays: number;
  mass1: number;
  mass2: number;
  radius1: number;
  radius2: number;
  teff1: number | null;
  teff2: number | null;
  /** How many of the tabulated values are the -9.99 "not measured" sentinel. */
  missingCount: number;
}

function parse(): Debs[] {
  const lines = readFileSync(SNAPSHOT, "utf8").trim().split("\n");
  const header = lines[0].replace(/^#\s*/, "").split(/\s+/);
  const at = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`DEBCat snapshot is missing column "${name}".`);
    return i;
  };
  const iSystem = at("System");
  const iSpT1 = at("SpT1");
  const iSpT2 = at("SpT2");
  const iP = at("Pday");
  const iM1 = at("logM1");
  const iM2 = at("logM2");
  const iR1 = at("logR1");
  const iR2 = at("logR2");
  const iT1 = at("logT1");
  const iT2 = at("logT2");

  const out: Debs[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(/\s+/);
    const num = (i: number) => Number(f[i]);
    // Values are logarithms; a missing one is the -9.99 sentinel, NOT 1e-9.
    const un = (v: number) => (v <= MISSING + 1e-9 ? null : Math.pow(10, v));
    const mass1 = un(num(iM1));
    const mass2 = un(num(iM2));
    const radius1 = un(num(iR1));
    const radius2 = un(num(iR2));
    const periodDays = num(iP);
    if (
      mass1 === null ||
      mass2 === null ||
      radius1 === null ||
      radius2 === null ||
      !Number.isFinite(periodDays) ||
      periodDays <= 0
    ) {
      continue;
    }
    out.push({
      missingCount: f.slice(1).filter((v) => Number(v) <= MISSING + 1e-9).length,
      system: f[iSystem].replace(/_/g, " "),
      spectralType1: f[iSpT1].replace(/_/g, " "),
      spectralType2: f[iSpT2].replace(/_/g, " "),
      periodDays,
      mass1,
      mass2,
      radius1,
      radius2,
      teff1: un(num(iT1)),
      teff2: un(num(iT2)),
    });
  }
  return out;
}

/** Blackbody-ish colour by effective temperature. Mirrors the renderer. */
function starColour(teff: number | null): string {
  const t = teff ?? 5772;
  if (t >= 30000) return "#9bb0ff";
  if (t >= 10000) return "#aabfff";
  if (t >= 7500) return "#cad7ff";
  if (t >= 6000) return "#fff4ea";
  if (t >= 5200) return "#ffd2a1";
  if (t >= 3700) return "#ffb765";
  return "#ff9060";
}

/** Morgan-Keenan class from effective temperature. Same table as the exoplanet pipeline. */
function spectralPhrase(teff: number | null): string {
  if (teff === null) return "a star of unrecorded temperature";
  if (teff >= 30000) return "a blue O-type star";
  if (teff >= 10000) return "a blue-white B-type star";
  if (teff >= 7500) return "a white A-type star";
  if (teff >= 6000) return "a yellow-white F-type star";
  if (teff >= 5200) return "a Sun-like G-type star";
  if (teff >= 3700) return "an orange K-type dwarf";
  return "a cool red M-dwarf";
}

function classTag(teff: number | null): string {
  if (teff === null) return "star-class-unknown";
  if (teff >= 30000) return "o-type-star";
  if (teff >= 10000) return "b-type-star";
  if (teff >= 7500) return "a-type-star";
  if (teff >= 6000) return "f-type-star";
  if (teff >= 5200) return "g-type-star";
  if (teff >= 3700) return "k-type-star";
  return "m-type-star";
}

function round(value: number, figures = 4): number {
  return Number(value.toPrecision(figures));
}

async function main(): Promise<void> {
  const allRows = parse();

  /*
   * DEBCat lists one row per published ANALYSIS, so a system that has been
   * measured twice appears twice — Gaia DR3 4658237043035232256 has periods of
   * 771.781 and 772.638 days from two papers. Keep the more complete analysis
   * rather than whichever happens to come first: the two rows for that system
   * differ in whether spectral types and luminosities were determined.
   */
  const bySystem = new Map<string, Debs>();
  let supersededCount = 0;
  for (const row of allRows) {
    const id = `binary-${slugify(row.system)}`;
    const existing = bySystem.get(id);
    if (existing === undefined) {
      bySystem.set(id, row);
    } else {
      supersededCount++;
      if (row.missingCount < existing.missingCount) bySystem.set(id, row);
    }
  }
  const rows = [...bySystem.values()];

  const scenarios: { id: string; doc: unknown }[] = [];
  const excluded: { system: string; reason: string }[] = [];

  for (const row of rows) {
    const id = `binary-${slugify(row.system)}`;

    /*
     * Round the masses FIRST, then derive everything from the rounded values.
     *
     * Deriving the velocities from full-precision masses and then rounding the
     * masses into the scenario leaves the two momenta not quite equal and
     * opposite, so the system drifts. It is a residual of about 1e-6 — far too
     * small to see and exactly the kind of thing that is never found by
     * looking. tests/catalog/generated-scenarios.test.ts found it.
     */
    const mass1 = round(row.mass1, 6);
    const mass2 = round(row.mass2, 6);
    const total = mass1 + mass2;
    // Kepler's third law, with the measured period and the measured total
    // mass, so the simulated orbit has the published period by construction.
    const mu = G_AU3_PER_MSUN_DAY2 * total;
    const separation = Math.cbrt(mu * Math.pow(row.periodDays / (2 * Math.PI), 2));

    const radius1Au = (row.radius1 * SOLAR_RADIUS_KM) / AU_KM;
    const radius2Au = (row.radius2 * SOLAR_RADIUS_KM) / AU_KM;

    // The stars must not start already overlapping, or the scenario opens with
    // a collision. This is a real exclusion: some DEBCat systems are close
    // enough that the circular-orbit assumption puts them in contact.
    if (separation <= radius1Au + radius2Au) {
      excluded.push({
        system: row.system,
        reason: "stars would start in contact at the circular separation",
      });
      continue;
    }

    // Circular orbit about the barycentre: each star's distance from it is in
    // inverse proportion to its mass, and each speed likewise.
    const r1 = (separation * mass2) / total;
    const r2 = (separation * mass1) / total;
    const relativeSpeed = Math.sqrt(mu / separation);
    const v1 = (relativeSpeed * mass2) / total;
    const v2 = (relativeSpeed * mass1) / total;

    const heavierFirst = mass1 >= mass2;
    const primary = heavierFirst ? 1 : 2;
    const bodies = [
      {
        id: "primary",
        name: `${row.system} A`,
        mass: mass1,
        radius: round(radius1Au, 6),
        position: { x: -r1, y: 0, z: 0 },
        velocity: { x: 0, y: -v1, z: 0 },
        colour: starColour(row.teff1),
      },
      {
        id: "secondary",
        name: `${row.system} B`,
        mass: mass2,
        radius: round(radius2Au, 6),
        position: { x: r2, y: 0, z: 0 },
        velocity: { x: 0, y: v2, z: 0 },
        colour: starColour(row.teff2),
      },
    ];

    const ratio = Math.max(mass1, mass2) / Math.min(mass1, mass2);
    const separationKm = separation * AU_KM;
    const summary =
      `${row.system} is a detached eclipsing binary: ${spectralPhrase(row.teff1)} of ` +
      `${mass1.toPrecision(3)} solar masses and ${spectralPhrase(row.teff2)} of ` +
      `${mass2.toPrecision(3)}, circling each other every ` +
      `${row.periodDays.toPrecision(4)} days at about ` +
      `${(separationKm / 1e6).toPrecision(3)} million kilometres. Both masses are ` +
      `measured, not inferred, which is what makes eclipsing binaries the ruler ` +
      `astronomy weighs stars with.`;

    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      name: row.system,
      summary,
      category: "stars",
      tags: [
        "binary-star",
        "eclipsing-binary",
        "two-body",
        ...(ratio < 1.05 ? ["twin-stars"] : []),
        ...(row.periodDays < 1 ? ["ultra-short-period"] : []),
        ...new Set([classTag(row.teff1), classTag(row.teff2)]),
      ],
      difficulty: "beginner" as const,
      source: {
        provider: "DEBCat",
        reference: `Detached eclipsing binary ${row.system}; spectral types ${row.spectralType1} and ${row.spectralType2}`,
        retrievedAt: RETRIEVED,
        url: "https://www.astro.keele.ac.uk/jkt/debcat/",
        notes:
          `${CITATION} Measured: orbital period, both masses, both radii and both ` +
          `effective temperatures. Derived: the separation, from Kepler's third law ` +
          `with the measured period and total mass, so the simulated orbit has the ` +
          `published period. Assumed: a CIRCULAR orbit — DEBCat does not tabulate ` +
          `eccentricity, and while close detached binaries are usually tidally ` +
          `circularised, this one has not been checked individually. The heavier ` +
          `star is component ${primary} as listed.`,
      },
      physics: {
        softening: 0,
        integrator: "verlet" as const,
        // 400 steps per orbit, as elsewhere in the catalogue.
        dt: round(row.periodDays / 400, 3),
        forceMode: "direct" as const,
        theta: 0.5,
        collisions: true,
      },
      bodies,
      camera: { distance: round(separation * 3.2, 3) },
    };

    const parsed = safeParseScenario(doc);
    if (!parsed.ok) {
      excluded.push({ system: row.system, reason: parsed.issues.join("; ") });
      continue;
    }
    scenarios.push({ id, doc: parsed.scenario });
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { id, doc } of scenarios) {
    const path = join(OUT_DIR, `${id}.json`);
    writeFileSync(
      path,
      await format(JSON.stringify(doc), { parser: "json", filepath: path }),
      "utf8",
    );
  }

  const byReason = new Map<string, number>();
  for (const x of excluded) {
    const key = x.reason.slice(0, 60);
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }

  const report = [
    "# Binary-star pipeline report",
    "",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "Snapshot: data/sources/snapshots/debcat-debs.dat",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Rows in snapshot | ${allRows.length} |`,
    `| Distinct systems | ${rows.length} |`,
    `| Rows superseded by a more complete analysis of the same system | ${supersededCount} |`,
    `| **Scenarios written** | **${scenarios.length}** |`,
    `| Excluded | ${excluded.length} |`,
    "",
    "## Exclusions by reason",
    "",
    excluded.length === 0
      ? "None."
      : [
          "| Reason | Systems |",
          "|---|---|",
          ...[...byReason].map(([k, v]) => `| ${k} | ${v} |`),
        ].join("\n"),
    "",
    "A system is excluded rather than adjusted. Where the reason is that the",
    "two stars would start in contact, that is a real statement about those",
    "systems and not a defect in the data: they are close binaries whose real",
    "orbits are not the circles assumed here.",
    "",
    `Citation carried by every generated scenario: ${CITATION}`,
    "",
  ].join("\n");

  const reportPath = join(ROOT, "artifacts/11-binary-star-pipeline-report.md");
  writeFileSync(
    reportPath,
    await format(report, { parser: "markdown", filepath: reportPath }),
    "utf8",
  );

  console.log(
    `Binary pipeline: ${scenarios.length} scenarios written, ${excluded.length} excluded. ` +
      `Report: artifacts/11-binary-star-pipeline-report.md`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
