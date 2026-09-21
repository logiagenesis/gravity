/**
 * Wire format for the catalogue, shared by the build script and the client.
 *
 * Keeping encoder and decoder in one module is what stops them drifting
 * apart: a period bucket written with one offset and read with another
 * silently mis-sorts the whole catalogue, and nothing would fail loudly.
 *
 * WHY FIXED-WIDTH BASE-36 TEXT rather than base64 typed arrays. Measured on
 * the real catalogue of 4,439 scenarios: base64 costs 15.4 kB gzipped for the
 * facet columns, fixed-width base-36 costs 10.5 kB, and the raw bytes the
 * browser must parse drop from 107 kB to 67 kB. Base64 re-aligns every third
 * byte onto a different character boundary, which defeats the compressor on
 * columns that are mostly long runs of the same small integer. Base-36 keeps
 * one value on one character boundary, so a run of identical values is a run
 * of identical bytes.
 */

/** Bump when the shape below changes; the client refuses an unknown version. */
export const CATALOG_FORMAT_VERSION = 1;

/**
 * Summaries per detail shard. A page of results fetches only the shards its
 * visible cards fall in, so the worst case is bounded by the page size rather
 * than by the size of the catalogue.
 */
export const DETAIL_SHARD_SIZE = 500;

/**
 * Orbital periods are stored as one base-36 pair on a logarithmic scale,
 * because a range filter over periods spanning hours to millennia is
 * inherently coarse and four bytes per scenario would be four bytes wasted.
 *
 *   bucket = round(log10(days) * PER_DECADE) + OFFSET
 *
 * At 16 buckets per decade the quantisation error is under 8%, and the range
 * covered is 10^-6 to 10^9 days, which comfortably contains every orbit from
 * a close binary to a wide comet.
 */
export const PERIOD_BUCKET_PER_DECADE = 16;
export const PERIOD_BUCKET_OFFSET = 96;
/** Sentinel: no bound orbit, or no satellite to measure. */
export const PERIOD_BUCKET_NONE = 0;

/**
 * Mass above which the catalogue counts a body as a star.
 *
 * This is the hydrogen-burning limit, so "1 star" means one star and a
 * brown-dwarf host counts as none. An earlier version used 0.02 M☉ (21
 * Jupiter masses), which is below the limit and therefore counted 53 systems
 * as having two stars when the second object was a brown dwarf; at the real
 * limit no system in the snapshot has more than one, and 25 have none, which
 * is the truth about those systems rather than a rounding of it.
 *
 * The renderer's threshold for what to draw as glowing is DIFFERENT and lower
 * (the deuterium-burning limit), because brown dwarfs are self-luminous even
 * though they are not stars. See src/render/materials.ts.
 */
export { HYDROGEN_BURNING_LIMIT_MSUN as STAR_MASS_THRESHOLD_MSUN } from "../sim/constants";

/**
 * Prefixes tried when reconstructing an id from a name.
 *
 * Ids are omitted from the manifest when `id === prefix + slugify(name)` for
 * one of these, which is true for all but a handful of entries and is worth
 * tens of kilobytes gzipped. The build VERIFIES each reconstruction against
 * the real id and falls back to storing the id verbatim when it does not
 * match, so a change to either side costs bytes but can never produce a wrong
 * id — which is exactly how the missing "binary-" prefix showed up: as 399
 * verbatim ids and a manifest 7 kB from its budget, not as a wrong link.
 */
export const ID_PREFIXES = ["", "exo-", "binary-"] as const;

/** Shared with the scenario generators so reconstruction stays exact. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function encodePeriodBucket(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return PERIOD_BUCKET_NONE;
  const bucket =
    Math.round(Math.log10(days) * PERIOD_BUCKET_PER_DECADE) + PERIOD_BUCKET_OFFSET;
  // Clamp into 1..255; 0 is reserved for "none".
  return Math.min(255, Math.max(1, bucket));
}

/** Days, or null when the entry has no bound satellite. */
export function decodePeriodBucket(bucket: number): number | null {
  if (bucket === PERIOD_BUCKET_NONE) return null;
  return Math.pow(10, (bucket - PERIOD_BUCKET_OFFSET) / PERIOD_BUCKET_PER_DECADE);
}

/** Fixed-width base-36, one value per entry, most significant digit first. */
export function encodeColumn(values: ArrayLike<number>, width: number): string {
  const parts = new Array<string>(values.length);
  for (let i = 0; i < values.length; i++) {
    const text = values[i].toString(36);
    if (text.length > width) {
      throw new RangeError(
        `Value ${values[i]} at index ${i} needs ${text.length} base-36 digits, ` +
          `but the column is ${width} wide.`,
      );
    }
    parts[i] = text.padStart(width, "0");
  }
  return parts.join("");
}

export function decodeColumn(text: string, width: number, count: number): Uint32Array {
  if (text.length !== width * count) {
    throw new RangeError(
      `Column is ${text.length} characters, expected ${width * count} ` +
        `(${count} entries at width ${width}).`,
    );
  }
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = parseInt(text.slice(i * width, (i + 1) * width), 36);
  }
  return out;
}

/**
 * Facet columns. Every value is an index into a dictionary or a small
 * integer, and every column is aligned with every other and with `names`.
 */
export interface PackedColumns {
  /** Width 1: index into dictionaries.categories */
  category: string;
  /** Width 1: index into dictionaries.difficulties */
  difficulty: string;
  /** Width 1: index into dictionaries.costs */
  cost: string;
  /** Width 1: index into dictionaries.providers */
  provider: string;
  /** Width 1: index into dictionaries.integrators */
  integrator: string;
  /** Width 1: bodies at or above STAR_MASS_THRESHOLD_MSUN, saturating at 35 */
  starCount: string;
  /** Width 3: total bodies, saturating at 46655 */
  bodyCount: string;
  /** Width 2: shortest satellite period, as a period bucket */
  minPeriod: string;
  /**
   * Width 2: longest period MINUS shortest, as a bucket difference.
   *
   * Stored as a difference because 3,458 of 4,439 systems have a single
   * satellite and therefore a difference of zero, which compresses to
   * nothing. Measured: 4.2 kB gzipped as an absolute value, 1.5 kB as a
   * difference.
   */
  periodSpread: string;
  /** Width 2: index into `tagSets` */
  tagSet: string;
  /** Width 1: 1 for hand-authored scenarios the catalogue leads with. */
  featured: string;
}

export interface CatalogDictionaries {
  categories: string[];
  difficulties: string[];
  costs: string[];
  providers: string[];
  integrators: string[];
  tags: string[];
}

export interface CatalogManifest {
  formatVersion: number;
  count: number;
  detailShardSize: number;
  detailShardCount: number;
  periodBucket: { offset: number; perDecade: number };
  dictionaries: CatalogDictionaries;
  /**
   * Distinct tag combinations, each a list of indices into
   * `dictionaries.tags`. Only 89 combinations occur across 4,439 scenarios,
   * so naming the combination costs far less than a bitset per entry.
   */
  tagSets: number[][];
  /** Newline-joined, aligned with every column. */
  names: string;
  /** Width 1: 0 means "look in explicitIds", otherwise ID_PREFIXES[rule - 1]. */
  idRule: string;
  /** Newline-joined ids, in entry order, for entries whose rule is 0 only. */
  explicitIds: string;
  columns: PackedColumns;
  /**
   * token -> delta-encoded base-36 entry indices.
   *
   * Only terms that a scan over names, tags, category and difficulty would
   * MISS are present: the client already has those strings and searches them
   * directly, so indexing them again would pay twice for one capability.
   */
  index: Record<string, string>;
}

export interface DetailShard {
  from: number;
  summaries: string[];
}

/** "0.5.3" means entry indices 0, 5, 8. */
export function decodePostings(packed: string): number[] {
  if (packed === "") return [];
  const out: number[] = [];
  let previous = 0;
  for (const part of packed.split(".")) {
    previous += parseInt(part, 36);
    out.push(previous);
  }
  return out;
}

export function encodePostings(indices: readonly number[]): string {
  let previous = 0;
  const parts = new Array<string>(indices.length);
  for (let i = 0; i < indices.length; i++) {
    parts[i] = (indices[i] - previous).toString(36);
    previous = indices[i];
  }
  return parts.join(".");
}
