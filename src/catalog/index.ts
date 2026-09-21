/**
 * Catalogue access: search, facet filtering, sorting, and lazy loading.
 *
 * The catalogue is STATIC DATA fetched at runtime, not JavaScript modules.
 * With 4,439 scenarios the previous `import.meta.glob` approach made the
 * bundler emit one chunk per scenario; here the JavaScript bundle is a
 * constant size and the data is one cacheable request
 * (see scripts/build-catalog.ts for the format and its byte budget).
 *
 * Entries are kept as COLUMNS, not objects. Search, filter and sort all run
 * over Int32Array index lists, and a `CatalogEntry` object is materialised
 * only for the handful of cards actually on screen. At 4,439 entries that is
 * the difference between ~1.3 MB of objects and ~130 kB of strings.
 */
import {
  CATALOG_FORMAT_VERSION,
  ID_PREFIXES,
  decodeColumn,
  decodePeriodBucket,
  decodePostings,
  slugify,
  type CatalogManifest,
  type DetailShard,
} from "./format";
import { migrateAndParse } from "../schema/migrations";
import type { Scenario } from "../schema/scenario";

export type Difficulty = "beginner" | "intermediate" | "advanced";
export type Cost = "light" | "moderate" | "heavy";

export interface CatalogEntry {
  /** Position in the catalogue; the key for every operation here. */
  index: number;
  id: string;
  name: string;
  category: string;
  difficulty: Difficulty;
  cost: Cost;
  provider: string;
  integrator: string;
  bodyCount: number;
  starCount: number;
  /** Bodies below the star mass threshold. */
  satelliteCount: number;
  tags: string[];
  /** Hand-authored; the catalogue leads with these. */
  featured: boolean;
  /** Shortest satellite period in days, or null when nothing is in a bound orbit. */
  minPeriodDays: number | null;
  maxPeriodDays: number | null;
}

export interface CatalogFilters {
  categories?: readonly string[];
  difficulties?: readonly string[];
  costs?: readonly string[];
  providers?: readonly string[];
  tags?: readonly string[];
  minBodies?: number;
  maxBodies?: number;
  starCounts?: readonly number[];
  /** Inclusive bounds in days. An entry matches when its range overlaps. */
  minPeriodDays?: number;
  maxPeriodDays?: number;
}

export type SortKey = "name" | "bodies" | "period" | "difficulty" | "featured";
export type SortDirection = "asc" | "desc";

/** Base path the app is served from; "/" in dev, "/<repo>/" on GitHub Pages. */
function basePath(): string {
  const base: unknown = import.meta.env?.BASE_URL;
  return typeof base === "string" && base.length > 0 ? base : "/";
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${basePath()}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export class Catalogue {
  readonly count: number;
  readonly categories: readonly string[];
  readonly difficulties: readonly string[];
  readonly costs: readonly string[];
  readonly providers: readonly string[];
  readonly integrators: readonly string[];
  readonly tags: readonly string[];

  private readonly names: string[];
  /** Lowercased once, because every keystroke searches all of them. */
  private readonly lowerNames: string[];
  private readonly ids: string[];
  private readonly tagSets: readonly (readonly number[])[];
  private readonly col: Record<string, Uint32Array>;
  private readonly index: Record<string, string>;
  private readonly detailShardSize: number;
  private readonly detailShards = new Map<number, string[]>();
  private readonly scenarioCache = new Map<string, Scenario>();

  constructor(manifest: CatalogManifest) {
    if (manifest.formatVersion !== CATALOG_FORMAT_VERSION) {
      throw new Error(
        `Catalogue format ${manifest.formatVersion} is not the ${CATALOG_FORMAT_VERSION} ` +
          `this build understands. The data and the app are out of step; rebuild with ` +
          `npm run data:build.`,
      );
    }

    this.count = manifest.count;
    const d = manifest.dictionaries;
    this.categories = d.categories;
    this.difficulties = d.difficulties;
    this.costs = d.costs;
    this.providers = d.providers;
    this.integrators = d.integrators;
    this.tags = d.tags;
    this.tagSets = manifest.tagSets;
    this.detailShardSize = manifest.detailShardSize;
    this.index = manifest.index;

    this.names = manifest.names.split("\n");
    if (this.names.length !== this.count) {
      throw new Error(
        `Catalogue says it holds ${this.count} scenarios but carries ${this.names.length} names.`,
      );
    }
    this.lowerNames = this.names.map((n) => n.toLowerCase());

    const c = manifest.columns;
    this.col = {
      category: decodeColumn(c.category, 1, this.count),
      difficulty: decodeColumn(c.difficulty, 1, this.count),
      cost: decodeColumn(c.cost, 1, this.count),
      provider: decodeColumn(c.provider, 1, this.count),
      integrator: decodeColumn(c.integrator, 1, this.count),
      starCount: decodeColumn(c.starCount, 1, this.count),
      bodyCount: decodeColumn(c.bodyCount, 3, this.count),
      minPeriod: decodeColumn(c.minPeriod, 2, this.count),
      periodSpread: decodeColumn(c.periodSpread, 2, this.count),
      tagSet: decodeColumn(c.tagSet, 2, this.count),
      featured: decodeColumn(c.featured, 1, this.count),
      idRule: decodeColumn(manifest.idRule, 1, this.count),
    };

    // Ids are reconstructed from names where the build proved that exact,
    // and read from the verbatim list otherwise.
    const explicit =
      manifest.explicitIds === "" ? [] : manifest.explicitIds.split("\n");
    let taken = 0;
    this.ids = new Array<string>(this.count);
    for (let i = 0; i < this.count; i++) {
      const rule = this.col.idRule[i];
      this.ids[i] =
        rule === 0 ? explicit[taken++] : ID_PREFIXES[rule - 1] + slugify(this.names[i]);
    }
    if (taken !== explicit.length) {
      throw new Error(
        `Catalogue carries ${explicit.length} verbatim ids but ${taken} entries ask for one.`,
      );
    }
  }

  entry(i: number): CatalogEntry {
    if (i < 0 || i >= this.count) throw new RangeError(`No catalogue entry at ${i}.`);
    const stars = this.col.starCount[i];
    const bodies = this.col.bodyCount[i];
    const low = this.col.minPeriod[i];
    const high = low === 0 ? 0 : low + this.col.periodSpread[i];
    return {
      index: i,
      id: this.ids[i],
      name: this.names[i],
      category: this.categories[this.col.category[i]],
      difficulty: this.difficulties[this.col.difficulty[i]] as Difficulty,
      cost: this.costs[this.col.cost[i]] as Cost,
      provider: this.providers[this.col.provider[i]],
      integrator: this.integrators[this.col.integrator[i]],
      bodyCount: bodies,
      starCount: stars,
      satelliteCount: bodies - stars,
      tags: this.tagSets[this.col.tagSet[i]].map((t) => this.tags[t]),
      featured: this.col.featured[i] === 1,
      minPeriodDays: decodePeriodBucket(low),
      maxPeriodDays: decodePeriodBucket(high),
    };
  }

  /** Index of the entry with this id, or -1. */
  indexOfId(id: string): number {
    return this.ids.indexOf(id);
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  /** Every entry, in catalogue order (by name). */
  all(): Int32Array {
    const out = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) out[i] = i;
    return out;
  }

  private tagIndicesOf(i: number): readonly number[] {
    return this.tagSets[this.col.tagSet[i]];
  }

  /**
   * Score entries against a free-text query.
   *
   * Every query token must match something, so adding words narrows rather
   * than widens. A token matches a name (word-prefix scores higher than a
   * bare substring), a tag, a category, a provider, or a term in the built
   * index — which holds only what the names and tags do not already cover.
   */
  search(query: string): Int32Array {
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9+-]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return this.all();

    let carried: Map<number, number> | null = null;

    for (const token of tokens) {
      const hits = new Map<number, number>();
      const add = (i: number, score: number) =>
        hits.set(i, Math.max(hits.get(i) ?? 0, score));

      for (let i = 0; i < this.count; i++) {
        const name = this.lowerNames[i];
        if (name === token) add(i, 10);
        else if (name.startsWith(token)) add(i, 6);
        else {
          const at = name.indexOf(token);
          // A match at a word boundary beats one in the middle of a word.
          if (at === 0) add(i, 6);
          else if (at > 0) add(i, /[^a-z0-9]/.test(name[at - 1]) ? 4 : 2);
        }
      }

      const matchingTags = new Set<number>();
      this.tags.forEach((tag, t) => {
        if (tag.includes(token)) matchingTags.add(t);
      });
      if (matchingTags.size > 0) {
        for (let i = 0; i < this.count; i++) {
          for (const t of this.tagIndicesOf(i)) {
            if (matchingTags.has(t)) {
              add(i, 3);
              break;
            }
          }
        }
      }

      const dictionaryHit = (values: readonly string[], column: Uint32Array) => {
        const wanted = new Set<number>();
        values.forEach((v, k) => {
          if (v.toLowerCase().includes(token)) wanted.add(k);
        });
        if (wanted.size === 0) return;
        for (let i = 0; i < this.count; i++) if (wanted.has(column[i])) add(i, 3);
      };
      dictionaryHit(this.categories, this.col.category);
      dictionaryHit(this.providers, this.col.provider);
      dictionaryHit(this.difficulties, this.col.difficulty);

      const exact = this.index[token];
      if (exact !== undefined) for (const i of decodePostings(exact)) add(i, 3);
      if (token.length >= 2) {
        for (const term of Object.keys(this.index)) {
          if (term !== token && term.startsWith(token)) {
            for (const i of decodePostings(this.index[term])) add(i, 2);
          }
        }
      }

      if (hits.size === 0) return new Int32Array(0);

      if (carried === null) {
        carried = hits;
      } else {
        // Intersect: every token must contribute.
        const merged = new Map<number, number>();
        for (const [i, score] of hits) {
          const previous = carried.get(i);
          if (previous !== undefined) merged.set(i, previous + score);
        }
        if (merged.size === 0) return new Int32Array(0);
        carried = merged;
      }
    }

    const ordered = [...(carried ?? new Map<number, number>())].sort(
      (a, b) => b[1] - a[1] || this.names[a[0]].localeCompare(this.names[b[0]], "en"),
    );
    const out = new Int32Array(ordered.length);
    for (let k = 0; k < ordered.length; k++) out[k] = ordered[k][0];
    return out;
  }

  /** Indices of the hand-authored scenarios, in catalogue order. */
  featured(): Int32Array {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) if (this.col.featured[i] === 1) out.push(i);
    return Int32Array.from(out);
  }

  filter(indices: Int32Array, filters: CatalogFilters): Int32Array {
    const wanted = (list: readonly string[] | undefined, dict: readonly string[]) => {
      if (!list || list.length === 0) return null;
      const set = new Set<number>();
      for (const value of list) {
        const at = dict.indexOf(value);
        if (at >= 0) set.add(at);
      }
      return set;
    };
    const categories = wanted(filters.categories, this.categories);
    const difficulties = wanted(filters.difficulties, this.difficulties);
    const costs = wanted(filters.costs, this.costs);
    const providers = wanted(filters.providers, this.providers);
    const tagBits = wanted(filters.tags, this.tags);
    const starCounts =
      filters.starCounts && filters.starCounts.length > 0
        ? new Set(filters.starCounts)
        : null;

    const out: number[] = [];
    for (const i of indices) {
      if (categories && !categories.has(this.col.category[i])) continue;
      if (difficulties && !difficulties.has(this.col.difficulty[i])) continue;
      if (costs && !costs.has(this.col.cost[i])) continue;
      if (providers && !providers.has(this.col.provider[i])) continue;
      if (starCounts && !starCounts.has(this.col.starCount[i])) continue;

      const bodies = this.col.bodyCount[i];
      if (filters.minBodies !== undefined && bodies < filters.minBodies) continue;
      if (filters.maxBodies !== undefined && bodies > filters.maxBodies) continue;

      if (tagBits) {
        // Any of the selected tags, so widening the tag selection widens the
        // result — the behaviour a checkbox group leads people to expect.
        const has = this.tagIndicesOf(i).some((t) => tagBits.has(t));
        if (!has) continue;
      }

      if (filters.minPeriodDays !== undefined || filters.maxPeriodDays !== undefined) {
        const low = this.col.minPeriod[i];
        if (low === 0) continue; // nothing in a bound orbit: cannot match a period
        const lowDays = decodePeriodBucket(low);
        const highDays = decodePeriodBucket(low + this.col.periodSpread[i]);
        if (lowDays === null || highDays === null) continue;
        // Overlap test, so a system counts if ANY of its orbits is in range.
        if (filters.maxPeriodDays !== undefined && lowDays > filters.maxPeriodDays)
          continue;
        if (filters.minPeriodDays !== undefined && highDays < filters.minPeriodDays)
          continue;
      }

      out.push(i);
    }
    return Int32Array.from(out);
  }

  /**
   * Sort a result list. Relevance order is preserved by NOT calling this;
   * the catalogue page only sorts when the reader picks a sort explicitly.
   */
  sort(indices: Int32Array, key: SortKey, direction: SortDirection): Int32Array {
    const sign = direction === "asc" ? 1 : -1;
    const value = (i: number): number => {
      switch (key) {
        case "bodies":
          return this.col.bodyCount[i];
        case "period":
          // Entries with no bound orbit sort last in both directions rather
          // than pretending to a period of zero.
          return this.col.minPeriod[i] === 0 ? Infinity * sign : this.col.minPeriod[i];
        case "difficulty":
          return this.col.difficulty[i];
        case "featured":
          // Descending on this key means featured first.
          return this.col.featured[i];
        case "name":
          return 0;
      }
    };
    const out = Array.from(indices);
    out.sort((a, b) => {
      if (key !== "name") {
        const diff = value(a) - value(b);
        if (diff !== 0) return sign * diff;
        // The direction applies to the chosen key, NOT to the tie-break.
        // "Most bodies" descending must not also list every equally-sized
        // system backwards through the alphabet.
        return this.names[a].localeCompare(this.names[b], "en");
      }
      return sign * this.names[a].localeCompare(this.names[b], "en");
    });
    return Int32Array.from(out);
  }

  /** Counts per value of a facet, over an arbitrary result list. */
  facetCounts(
    indices: Int32Array,
    facet: "category" | "difficulty" | "cost",
  ): number[] {
    const dict =
      facet === "category"
        ? this.categories
        : facet === "difficulty"
          ? this.difficulties
          : this.costs;
    const counts = new Array<number>(dict.length).fill(0);
    for (const i of indices) counts[this.col[facet][i]] += 1;
    return counts;
  }

  /** Counts per tag over an arbitrary result list, highest first. */
  tagCounts(indices: Int32Array): { tag: string; count: number }[] {
    const counts = new Array<number>(this.tags.length).fill(0);
    for (const i of indices) for (const t of this.tagIndicesOf(i)) counts[t] += 1;
    return this.tags
      .map((tag, t) => ({ tag, count: counts[t] }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "en"));
  }

  /** Counts per number of stars, for the star-count filter. */
  starCountBuckets(indices: Int32Array): Map<number, number> {
    const out = new Map<number, number>();
    for (const i of indices) {
      const stars = this.col.starCount[i];
      out.set(stars, (out.get(stars) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Summaries for the entries about to be shown.
   *
   * Only the shards those entries fall in are fetched, so the cost is bounded
   * by the size of one page of results, not by the size of the catalogue.
   */
  async summaries(indices: readonly number[]): Promise<Map<number, string>> {
    const needed = new Set<number>();
    for (const i of indices) {
      const shard = Math.floor(i / this.detailShardSize);
      if (!this.detailShards.has(shard)) needed.add(shard);
    }

    await Promise.all(
      [...needed].map(async (shard) => {
        const payload = await fetchJson<DetailShard>(`catalog/details/${shard}.json`);
        this.detailShards.set(shard, payload.summaries);
      }),
    );

    const out = new Map<number, string>();
    for (const i of indices) {
      const shard = Math.floor(i / this.detailShardSize);
      const summary = this.detailShards.get(shard)?.[i - shard * this.detailShardSize];
      if (summary !== undefined) out.set(i, summary);
    }
    return out;
  }

  /**
   * One scenario, fetched and VALIDATED. Validation is not skipped for data
   * this build produced: the file is served statically and could be stale,
   * hand-edited or cached from an older format.
   */
  async scenario(id: string): Promise<Scenario> {
    const cached = this.scenarioCache.get(id);
    if (cached) return cached;
    if (!this.has(id)) {
      throw new Error(`No scenario in the catalogue with id "${id}".`);
    }
    const raw = await fetchJson<unknown>(`scenarios/${encodeURIComponent(id)}.json`);
    const scenario = migrateAndParse(raw);
    this.scenarioCache.set(id, scenario);
    return scenario;
  }
}

let loading: Promise<Catalogue> | null = null;

/** Load the catalogue once per session; concurrent callers share one request. */
export function loadCatalogue(): Promise<Catalogue> {
  loading ??= fetchJson<CatalogManifest>("catalog/manifest.json").then(
    (manifest) => new Catalogue(manifest),
  );
  return loading;
}

/** Test seam: drop the memoised catalogue. */
export function resetCatalogue(): void {
  loading = null;
}

export type { CatalogManifest } from "./format";
