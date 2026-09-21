/**
 * Catalogue build.
 *
 * Reads every scenario under data/scenarios (recursively), validates all of
 * them, and emits STATIC DATA FILES that the app fetches at runtime:
 *
 *   public/catalog/manifest.json      the whole searchable/filterable catalogue
 *   public/catalog/details/<n>.json   summaries, fetched per visible page
 *   public/scenarios/<id>.json        one scenario, fetched when opened
 *
 * WHY NOT JS MODULES. The previous version used `import.meta.glob`, which made
 * the bundler emit one JavaScript chunk per scenario. That is fine for seven
 * scenarios and impossible for 4,439: the module graph, the manifest of
 * chunks, and the build time all grow with the catalogue. Static JSON fetched
 * on demand keeps the JavaScript bundle a constant size no matter how large
 * the catalogue gets.
 *
 * WHY ONE MANIFEST RATHER THAN SHARDS. Measured, not assumed. The manifest
 * carries ids, names and packed facet columns for all 4,439 scenarios so that
 * search, filtering and sorting run in memory with no further requests. The
 * budget below is enforced on every build; when it trips, the manifest must be
 * sharded by category and the catalogue taught to fetch shards on demand.
 * Building that machinery before the numbers call for it would be guessing.
 *
 * A MANIFEST, NOT PAGES. A comparable implementation compiled 4,435 scenarios
 * into 4,435 built pages and offered no search at all, so finding a named
 * system meant paging through 248 listing pages
 * (artifacts/03-current-site-audit.md section 6).
 *
 * Any invalid scenario FAILS THE BUILD. Shipping a broken scenario is worse
 * than shipping one fewer scenario.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { migrateAndParse } from "../src/schema/migrations";
import type { Scenario } from "../src/schema/scenario";
import { G_AU3_PER_MSUN_DAY2 } from "../src/sim/constants";
import {
  CATALOG_FORMAT_VERSION,
  DETAIL_SHARD_SIZE,
  PERIOD_BUCKET_OFFSET,
  PERIOD_BUCKET_PER_DECADE,
  PERIOD_BUCKET_NONE,
  STAR_MASS_THRESHOLD_MSUN,
  ID_PREFIXES,
  encodeColumn,
  encodePeriodBucket,
  encodePostings,
  slugify,
  type PackedColumns,
  type CatalogManifest,
  type DetailShard,
} from "../src/catalog/format";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC_DIR = join(ROOT, "data", "scenarios");
const PUBLIC_DIR = join(ROOT, "public");
const CATALOG_OUT = join(PUBLIC_DIR, "catalog");
const SCENARIO_OUT = join(PUBLIC_DIR, "scenarios");

/**
 * Byte budget for the manifest, enforced below.
 *
 * Set from measurement, not from a guess: at 4,439 scenarios the manifest is
 * 174 kB raw and 26 kB gzipped, so these budgets leave roughly 40% headroom.
 * Raw size is what the browser must parse; gzip size is what it must
 * download, and GitHub Pages serves gzip. The build fails loudly rather than
 * quietly shipping a catalogue that takes seconds to load on a slow
 * connection.
 */
const MANIFEST_BUDGET_RAW_BYTES = 250_000;
const MANIFEST_BUDGET_GZIP_BYTES = 38_000;

/**
 * Tokens appearing in more than this fraction of the catalogue are dropped
 * from the search index: they cannot discriminate between results, and they
 * dominate its size. Measured at 4,439 scenarios: capping here removes 21
 * boilerplate terms ("orbital", "published", "n-body", ...) and shrinks the
 * index from 153 kB to 5.3 kB raw. Everything a dropped term would have
 * selected is reachable through a facet instead (spectral class, provider,
 * body count), so the capability is kept and only the cost is removed.
 */
const INDEX_MAX_POSTINGS_FRACTION = 0.1;

/** Words carrying no discriminating power in this domain. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "with",
  "this",
  "these",
  "those",
  "which",
  "you",
  "your",
  "can",
  "will",
  "one",
  "two",
  "into",
  "out",
  "up",
  "down",
  "over",
  "under",
  "about",
  "there",
]);

/**
 * Bare numbers are not search terms. Before this rule the index held 6,072
 * terms, 5,906 of which were numbers lifted out of generated summaries
 * ("1.18", "2.09"); nobody searches a catalogue for "2.09". Numbers that are
 * part of a designation ("kepler-90", "hd189733") survive, because they are
 * not bare.
 */
function isBareNumber(token: string): boolean {
  return /^[0-9]+(\.[0-9]+)?$/.test(token);
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !isBareNumber(t));
}

function costOf(scenario: Scenario): "light" | "moderate" | "heavy" {
  const n = scenario.bodies.length;
  // Direct force is O(n^2) per step, and step count scales as 1/dt.
  const work = (n * n) / scenario.physics.dt;
  if (work < 5_000) return "light";
  if (work < 500_000) return "moderate";
  return "heavy";
}

/**
 * Orbital periods of the satellites of the heaviest body, in days.
 *
 * Derived from the scenario's own state vectors by the two-body formula, so
 * it works for every scenario in the catalogue and needs no extra field in
 * the schema. A body on an unbound (parabolic or hyperbolic) path has no
 * period and is skipped rather than assigned one.
 *
 * This is an approximation: it ignores every gravitating body except the
 * primary. It is used only to bucket scenarios for a range filter, never
 * presented as an ephemeris.
 */
function orbitalPeriodRangeDays(scenario: Scenario): [number, number] | null {
  const g = scenario.physics.g ?? G_AU3_PER_MSUN_DAY2;
  const bodies = scenario.bodies;
  let primary = 0;
  for (let i = 1; i < bodies.length; i++) {
    if (bodies[i].mass > bodies[primary].mass) primary = i;
  }
  const centre = bodies[primary];
  if (centre.mass <= 0) return null;

  let min = Infinity;
  let max = 0;
  for (let i = 0; i < bodies.length; i++) {
    if (i === primary) continue;
    const b = bodies[i];
    const dx = b.position.x - centre.position.x;
    const dy = b.position.y - centre.position.y;
    const dz = b.position.z - centre.position.z;
    const r = Math.hypot(dx, dy, dz);
    if (r === 0) continue;
    const dvx = b.velocity.x - centre.velocity.x;
    const dvy = b.velocity.y - centre.velocity.y;
    const dvz = b.velocity.z - centre.velocity.z;
    const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
    const mu = g * (centre.mass + b.mass);
    const energy = v2 / 2 - mu / r;
    if (energy >= 0) continue; // unbound: no period
    const a = -mu / (2 * energy);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
    if (!Number.isFinite(period) || period <= 0) continue;
    if (period < min) min = period;
    if (period > max) max = period;
  }
  return max > 0 ? [min, max] : null;
}

function collectScenarioFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectScenarioFiles(path, out);
    else if (entry.name.endsWith(".json")) out.push(path);
  }
  return out;
}

function main(): void {
  const files = collectScenarioFiles(SRC_DIR);
  if (files.length === 0) {
    console.error(
      `No scenarios found under ${SRC_DIR}. Run: npx tsx scripts/pipeline/build-exoplanets.ts`,
    );
    process.exit(1);
  }

  const scenarios: Scenario[] = [];
  const failures: string[] = [];

  for (const file of files) {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
      scenarios.push(migrateAndParse(raw));
    } catch (error) {
      failures.push(
        `${relative(ROOT, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `Scenario validation failed for ${failures.length} of ${files.length} files. ` +
        `The build is stopping rather than shipping broken data:\n`,
    );
    for (const f of failures.slice(0, 20)) console.error(`  ${f}\n`);
    if (failures.length > 20) console.error(`  ...and ${failures.length - 20} more.\n`);
    process.exit(1);
  }

  const seen = new Map<string, string>();
  for (let i = 0; i < scenarios.length; i++) {
    const id = scenarios[i].id;
    const previous = seen.get(id);
    if (previous !== undefined) {
      console.error(
        `Duplicate scenario id "${id}": ${previous} and ${relative(ROOT, files[i])}. ` +
          `Ids must be unique across the catalogue.`,
      );
      process.exit(1);
    }
    seen.set(id, relative(ROOT, files[i]));
  }

  scenarios.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const count = scenarios.length;

  // --- dictionaries -------------------------------------------------------
  const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();
  const categories = sortedUnique(scenarios.map((s) => s.category));
  const difficulties = ["beginner", "intermediate", "advanced"];
  const costs = ["light", "moderate", "heavy"];
  const providers = sortedUnique(scenarios.map((s) => s.source.provider));
  const integrators = sortedUnique(scenarios.map((s) => s.physics.integrator));
  const tags = sortedUnique(scenarios.flatMap((s) => s.tags));

  const indexOf = (list: string[], value: string): number => {
    const i = list.indexOf(value);
    if (i < 0) {
      console.error(`Internal error: "${value}" missing from its dictionary.`);
      process.exit(1);
    }
    return i;
  };

  // --- packed facet columns ----------------------------------------------
  const category = new Uint8Array(count);
  const difficulty = new Uint8Array(count);
  const cost = new Uint8Array(count);
  const provider = new Uint8Array(count);
  const integrator = new Uint8Array(count);
  const starCount = new Uint8Array(count);
  const bodyCount = new Uint16Array(count);
  const minPeriod = new Uint8Array(count);
  const periodSpread = new Uint8Array(count);
  const tagSet = new Uint16Array(count);
  const featured = new Uint8Array(count);
  const idRule = new Uint8Array(count);

  /** Distinct tag combinations, keyed by their sorted dictionary indices. */
  const tagSetIds = new Map<string, number>();
  const tagSets: number[][] = [];

  const names: string[] = [];
  const summaries: string[] = [];
  const explicitIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const s = scenarios[i];
    names.push(s.name);
    summaries.push(s.summary.replace(/\s+/g, " ").trim());

    // Reconstruct the id from the name where that is EXACTLY right, and store
    // it verbatim otherwise. Verified per entry, never assumed.
    const rule = ID_PREFIXES.findIndex((prefix) => prefix + slugify(s.name) === s.id);
    idRule[i] = rule + 1;
    if (rule < 0) {
      idRule[i] = 0;
      explicitIds.push(s.id);
    }

    category[i] = indexOf(categories, s.category);
    difficulty[i] = indexOf(difficulties, s.difficulty);
    cost[i] = indexOf(costs, costOf(s));
    provider[i] = indexOf(providers, s.source.provider);
    integrator[i] = indexOf(integrators, s.physics.integrator);

    // A "star" here is any body heavy enough that the renderer treats it as
    // self-luminous; the same threshold is used in src/render/materials.ts so
    // the filter and the picture agree.
    const stars = s.bodies.filter((b) => b.mass >= STAR_MASS_THRESHOLD_MSUN).length;
    starCount[i] = Math.min(35, stars);
    bodyCount[i] = Math.min(46655, s.bodies.length);

    const periods = orbitalPeriodRangeDays(s);
    const low = periods ? encodePeriodBucket(periods[0]) : PERIOD_BUCKET_NONE;
    const high = periods ? encodePeriodBucket(periods[1]) : PERIOD_BUCKET_NONE;
    minPeriod[i] = low;
    periodSpread[i] = high - low;

    const bits = s.tags.map((t) => indexOf(tags, t)).sort((a, b) => a - b);
    const key = bits.join(",");
    let setId = tagSetIds.get(key);
    if (setId === undefined) {
      setId = tagSets.length;
      tagSetIds.set(key, setId);
      tagSets.push(bits);
    }
    tagSet[i] = setId;
    featured[i] = s.featured ? 1 : 0;
  }

  // --- search index -------------------------------------------------------
  // Only terms NOT already visible to a scan over names, tags, category and
  // difficulty are indexed, because the manifest carries those and the client
  // searches them directly. What is left is summary prose, body names and
  // provider names. Measured: 166 terms instead of 6,072.
  const postings = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const s = scenarios[i];
    const free = new Set([
      ...tokenise(s.name),
      ...s.tags.flatMap(tokenise),
      ...tokenise(s.category),
      ...tokenise(s.difficulty),
    ]);
    const extra = new Set([
      ...tokenise(s.summary),
      ...s.bodies.flatMap((b) => tokenise(b.name)),
      ...tokenise(s.source.provider),
    ]);
    for (const token of extra) {
      if (free.has(token)) continue;
      let list = postings.get(token);
      if (list === undefined) postings.set(token, (list = []));
      list.push(i);
    }
  }

  const cap = Math.ceil(count * INDEX_MAX_POSTINGS_FRACTION);
  const index: Record<string, string> = {};
  const droppedTerms: string[] = [];
  for (const [token, list] of [...postings].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length > cap) {
      droppedTerms.push(token);
      continue;
    }
    index[token] = encodePostings(list);
  }

  const columns: PackedColumns = {
    category: encodeColumn(category, 1),
    difficulty: encodeColumn(difficulty, 1),
    cost: encodeColumn(cost, 1),
    provider: encodeColumn(provider, 1),
    integrator: encodeColumn(integrator, 1),
    starCount: encodeColumn(starCount, 1),
    bodyCount: encodeColumn(bodyCount, 3),
    minPeriod: encodeColumn(minPeriod, 2),
    periodSpread: encodeColumn(periodSpread, 2),
    tagSet: encodeColumn(tagSet, 2),
    featured: encodeColumn(featured, 1),
  };

  const shardCount = Math.ceil(count / DETAIL_SHARD_SIZE);
  const manifest: CatalogManifest = {
    formatVersion: CATALOG_FORMAT_VERSION,
    count,
    detailShardSize: DETAIL_SHARD_SIZE,
    detailShardCount: shardCount,
    periodBucket: {
      offset: PERIOD_BUCKET_OFFSET,
      perDecade: PERIOD_BUCKET_PER_DECADE,
    },
    dictionaries: { categories, difficulties, costs, providers, integrators, tags },
    tagSets,
    // Newline-joined rather than JSON arrays: no quotes, no commas, and one
    // split on load. Scenario names cannot contain newlines, which the
    // assertion below enforces.
    names: names.join("\n"),
    idRule: encodeColumn(idRule, 1),
    explicitIds: explicitIds.join("\n"),
    columns,
    index,
  };

  for (const value of [...explicitIds, ...names]) {
    if (value.includes("\n")) {
      console.error(`Scenario id or name contains a newline: ${JSON.stringify(value)}`);
      process.exit(1);
    }
  }

  // --- write --------------------------------------------------------------
  rmSync(CATALOG_OUT, { recursive: true, force: true });
  rmSync(SCENARIO_OUT, { recursive: true, force: true });
  mkdirSync(join(CATALOG_OUT, "details"), { recursive: true });
  mkdirSync(SCENARIO_OUT, { recursive: true });

  const manifestJson = JSON.stringify(manifest);
  writeFileSync(join(CATALOG_OUT, "manifest.json"), manifestJson, "utf8");

  for (let shard = 0; shard < shardCount; shard++) {
    const from = shard * DETAIL_SHARD_SIZE;
    const payload: DetailShard = {
      from,
      summaries: summaries.slice(from, from + DETAIL_SHARD_SIZE),
    };
    writeFileSync(
      join(CATALOG_OUT, "details", `${shard}.json`),
      JSON.stringify(payload),
      "utf8",
    );
  }

  for (const s of scenarios) {
    writeFileSync(join(SCENARIO_OUT, `${s.id}.json`), JSON.stringify(s), "utf8");
  }

  // --- enforce the budget -------------------------------------------------
  const rawBytes = Buffer.byteLength(manifestJson);
  const gzipBytes = gzipSync(Buffer.from(manifestJson), { level: 9 }).length;
  const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`;

  console.log(
    `Catalogue built: ${count} scenarios, ${Object.keys(index).length} index terms ` +
      `(${droppedTerms.length} dropped above ${cap} postings), ${tagSets.length} tag ` +
      `combinations, ${explicitIds.length} ids stored verbatim, ` +
      `${shardCount} detail shards, ` +
      `${featured.reduce<number>((a, b) => a + b, 0)} featured, ` +
      `categories: ${categories.join(", ")}`,
  );
  console.log(
    `Manifest: ${kb(rawBytes)} raw (budget ${kb(MANIFEST_BUDGET_RAW_BYTES)}), ` +
      `${kb(gzipBytes)} gzip (budget ${kb(MANIFEST_BUDGET_GZIP_BYTES)}).`,
  );

  const worstFraction = Math.max(
    rawBytes / MANIFEST_BUDGET_RAW_BYTES,
    gzipBytes / MANIFEST_BUDGET_GZIP_BYTES,
  );
  // Warn before the wall, not at it: a budget that only speaks when it is
  // already broken makes the next data source someone else's emergency.
  if (worstFraction > 0.85 && worstFraction <= 1) {
    console.warn(
      `\nWARNING: the manifest is at ${(worstFraction * 100).toFixed(0)}% of budget. ` +
        `The next substantial data source will exceed it. The remedy is to shard ` +
        `by category and fetch shards on demand, not to raise the number.`,
    );
  }

  if (rawBytes > MANIFEST_BUDGET_RAW_BYTES || gzipBytes > MANIFEST_BUDGET_GZIP_BYTES) {
    console.error(
      `\nThe manifest is over budget. Shard it by category and teach ` +
        `src/catalog to fetch shards on demand, or reduce what it carries. ` +
        `Do not simply raise the budget: it exists because a catalogue nobody ` +
        `can afford to download is a catalogue nobody uses.`,
    );
    process.exit(1);
  }
}

main();
