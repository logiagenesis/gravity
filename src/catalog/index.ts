/**
 * Catalogue access and client-side search.
 *
 * The manifest and the inverted index are built at build time
 * (scripts/build-catalog.ts) and imported as JSON, so search is instant and
 * needs no network request. Individual scenarios are fetched lazily, because
 * only one is ever open at a time.
 */
import catalogData from "./generated/catalog.json";
import searchIndexData from "./generated/search-index.json";
import { migrateAndParse } from "../schema/migrations";
import type { Scenario } from "../schema/scenario";

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  bodyCount: number;
  integrator: string;
  sourceProvider: string;
  cost: "light" | "moderate" | "heavy";
}

export const catalog = catalogData as CatalogEntry[];
const searchIndex = searchIndexData as Record<string, string[]>;

export const categories: string[] = [...new Set(catalog.map((e) => e.category))].sort();
export const allTags: string[] = [...new Set(catalog.flatMap((e) => e.tags))].sort();

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Score entries against a query.
 *
 * Exact index hits score highest; a prefix match on an index term also counts,
 * so typing "jupi" finds "jupiter" before the word is complete. Every query
 * token must match something, so adding words narrows rather than widens.
 */
export function searchCatalog(query: string): CatalogEntry[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return catalog;

  const indexTerms = Object.keys(searchIndex);
  let candidates: Map<string, number> | null = null;

  for (const token of tokens) {
    const hits = new Map<string, number>();

    const exact = searchIndex[token];
    if (exact) for (const id of exact) hits.set(id, (hits.get(id) ?? 0) + 3);

    if (token.length >= 2) {
      for (const term of indexTerms) {
        if (term !== token && term.startsWith(token)) {
          for (const id of searchIndex[term]) hits.set(id, (hits.get(id) ?? 0) + 1);
        }
      }
    }

    if (hits.size === 0) return [];

    if (candidates === null) {
      candidates = hits;
    } else {
      // Intersect: every token must contribute.
      const merged = new Map<string, number>();
      for (const [id, score] of hits) {
        const previous = candidates.get(id);
        if (previous !== undefined) merged.set(id, previous + score);
      }
      candidates = merged;
      if (candidates.size === 0) return [];
    }
  }

  const byId = new Map(catalog.map((e) => [e.id, e]));
  return [...(candidates ?? new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => byId.get(id))
    .filter((e): e is CatalogEntry => e !== undefined);
}

export interface CatalogFilters {
  categories?: string[];
  difficulties?: string[];
  costs?: string[];
  tags?: string[];
  maxBodies?: number;
}

export function filterCatalog(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
): CatalogEntry[] {
  return entries.filter((entry) => {
    if (filters.categories?.length && !filters.categories.includes(entry.category)) {
      return false;
    }
    if (
      filters.difficulties?.length &&
      !filters.difficulties.includes(entry.difficulty)
    ) {
      return false;
    }
    if (filters.costs?.length && !filters.costs.includes(entry.cost)) return false;
    if (filters.tags?.length && !filters.tags.some((t) => entry.tags.includes(t))) {
      return false;
    }
    if (filters.maxBodies !== undefined && entry.bodyCount > filters.maxBodies) {
      return false;
    }
    return true;
  });
}

/** Lazily load and validate one scenario. Validation is not skipped for bundled data. */
const scenarioModules = import.meta.glob<{ default: unknown }>(
  "./generated/scenarios/*.json",
);

export async function loadScenario(id: string): Promise<Scenario> {
  const key = `./generated/scenarios/${id}.json`;
  const loader = scenarioModules[key];
  if (!loader) throw new Error(`No scenario in the catalogue with id "${id}".`);
  const module = await loader();
  return migrateAndParse(module.default);
}
