/**
 * Catalogue build.
 *
 * Reads data/scenarios/*.json, validates every one, and emits:
 *   src/catalog/generated/catalog.json       manifest (no body data)
 *   src/catalog/generated/search-index.json  inverted index for client search
 *   src/catalog/generated/scenarios/<id>.json  one file per scenario
 *
 * A MANIFEST, NOT PAGES. A comparable implementation compiled 4,435 scenarios
 * into 4,435 built pages and offered no search at all, so finding a named
 * system meant paging through 248 listing pages
 * (artifacts/03-current-site-audit.md §6). Here the catalogue is data, the
 * index is built once, and search runs client-side with no network.
 *
 * Any invalid scenario FAILS THE BUILD. Shipping a broken scenario is worse
 * than shipping one fewer scenario.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateAndParse } from "../src/schema/migrations";
import type { Scenario } from "../src/schema/scenario";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC_DIR = join(ROOT, "data", "scenarios");
const OUT_DIR = join(ROOT, "src", "catalog", "generated");

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

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  difficulty: Scenario["difficulty"];
  bodyCount: number;
  integrator: string;
  sourceProvider: string;
  /** Rough relative cost, so the catalogue can be filtered by how heavy a run is. */
  cost: "light" | "moderate" | "heavy";
}

function costOf(scenario: Scenario): CatalogEntry["cost"] {
  const n = scenario.bodies.length;
  // Direct force is O(n²) per step, and step count scales as 1/dt.
  const work = (n * n) / scenario.physics.dt;
  if (work < 5_000) return "light";
  if (work < 500_000) return "moderate";
  return "heavy";
}

function main(): void {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(
      `No scenarios found in ${SRC_DIR}. Run: npx tsx scripts/generate-scenarios.ts`,
    );
    process.exit(1);
  }

  const scenarios: Scenario[] = [];
  const failures: string[] = [];

  for (const file of files) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(SRC_DIR, file), "utf8"));
      scenarios.push(migrateAndParse(raw));
    } catch (error) {
      failures.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      "Scenario validation failed. The build is stopping rather than shipping broken data:\n",
    );
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
  }

  const ids = new Set<string>();
  for (const s of scenarios) {
    if (ids.has(s.id)) {
      console.error(
        `Duplicate scenario id "${s.id}". Ids must be unique across the catalogue.`,
      );
      process.exit(1);
    }
    ids.add(s.id);
  }

  scenarios.sort((a, b) => a.name.localeCompare(b.name, "en"));

  // Clean output so a deleted scenario cannot linger in the published bundle.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, "scenarios"), { recursive: true });

  const entries: CatalogEntry[] = scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    summary: s.summary,
    category: s.category,
    tags: s.tags,
    difficulty: s.difficulty,
    bodyCount: s.bodies.length,
    integrator: s.physics.integrator,
    sourceProvider: s.source.provider,
    cost: costOf(s),
  }));

  // Inverted index: token -> scenario ids. Body names are included so that
  // searching "trojan" or "ganymede" finds the scenario containing it.
  const index: Record<string, string[]> = {};
  for (const s of scenarios) {
    const text = [
      s.name,
      s.summary,
      s.category,
      s.difficulty,
      ...s.tags,
      ...s.bodies.map((b) => b.name),
      s.source.provider,
    ].join(" ");

    for (const token of new Set(tokenise(text))) {
      (index[token] ??= []).push(s.id);
    }
  }

  writeFileSync(join(OUT_DIR, "catalog.json"), JSON.stringify(entries), "utf8");
  writeFileSync(join(OUT_DIR, "search-index.json"), JSON.stringify(index), "utf8");
  for (const s of scenarios) {
    writeFileSync(
      join(OUT_DIR, "scenarios", `${s.id}.json`),
      JSON.stringify(s),
      "utf8",
    );
  }

  const categories = [...new Set(entries.map((e) => e.category))].sort();
  console.log(
    `Catalogue built: ${entries.length} scenarios, ${Object.keys(index).length} index terms, ` +
      `categories: ${categories.join(", ")}`,
  );
}

main();
