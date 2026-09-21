/**
 * The catalogue client: search ranking, facet filtering, sorting, and the id
 * reconstruction that keeps 4,432 ids out of the manifest.
 *
 * Built from a hand-written manifest rather than the generated one, so a
 * failure here points at the logic and not at the data.
 */
import { describe, it, expect } from "vitest";
import { Catalogue } from "../../src/catalog";
import {
  CATALOG_FORMAT_VERSION,
  encodeColumn,
  encodePeriodBucket,
  encodePostings,
  type CatalogManifest,
} from "../../src/catalog/format";

interface Fixture {
  id: string;
  name: string;
  category: number;
  difficulty: number;
  cost: number;
  provider: number;
  integrator: number;
  stars: number;
  bodies: number;
  minPeriodDays: number;
  maxPeriodDays: number;
  tagSet: number;
}

/** Sorted by name, exactly as the build emits them. */
const FIXTURES: Fixture[] = [
  {
    id: "exo-kepler-90",
    name: "Kepler-90",
    category: 0,
    difficulty: 1,
    cost: 1,
    provider: 0,
    integrator: 0,
    stars: 1,
    bodies: 9,
    minPeriodDays: 7,
    maxPeriodDays: 331,
    tagSet: 1,
  },
  {
    id: "sun-and-earth",
    name: "The Sun and the Earth",
    category: 1,
    difficulty: 0,
    cost: 0,
    provider: 1,
    integrator: 0,
    stars: 1,
    bodies: 2,
    minPeriodDays: 365.25,
    maxPeriodDays: 365.25,
    tagSet: 0,
  },
  {
    id: "exo-trappist-1",
    name: "TRAPPIST-1",
    category: 0,
    difficulty: 1,
    cost: 1,
    provider: 0,
    integrator: 0,
    stars: 1,
    bodies: 8,
    minPeriodDays: 1.51,
    maxPeriodDays: 18.77,
    tagSet: 1,
  },
];

function buildManifest(overrides: Partial<CatalogManifest> = {}): CatalogManifest {
  const count = FIXTURES.length;
  const low = FIXTURES.map((f) => encodePeriodBucket(f.minPeriodDays));
  const high = FIXTURES.map((f) => encodePeriodBucket(f.maxPeriodDays));
  return {
    formatVersion: CATALOG_FORMAT_VERSION,
    count,
    detailShardSize: 500,
    detailShardCount: 1,
    periodBucket: { offset: 96, perDecade: 16 },
    dictionaries: {
      categories: ["exoplanets", "solar-system"],
      difficulties: ["beginner", "intermediate", "advanced"],
      costs: ["light", "moderate", "heavy"],
      providers: ["NASA Exoplanet Archive", "NASA NSSDCA"],
      integrators: ["verlet"],
      tags: ["exoplanet", "multi-planet", "solar-system"],
    },
    tagSets: [[2], [0, 1]],
    names: FIXTURES.map((f) => f.name).join("\n"),
    // Kepler-90 and TRAPPIST-1 are reconstructed as "exo-" + slug(name);
    // "The Sun and the Earth" does not slug to "sun-and-earth", so it is
    // stored verbatim.
    idRule: encodeColumn([2, 0, 2], 1),
    explicitIds: "sun-and-earth",
    columns: {
      category: encodeColumn(
        FIXTURES.map((f) => f.category),
        1,
      ),
      difficulty: encodeColumn(
        FIXTURES.map((f) => f.difficulty),
        1,
      ),
      cost: encodeColumn(
        FIXTURES.map((f) => f.cost),
        1,
      ),
      provider: encodeColumn(
        FIXTURES.map((f) => f.provider),
        1,
      ),
      integrator: encodeColumn(
        FIXTURES.map((f) => f.integrator),
        1,
      ),
      starCount: encodeColumn(
        FIXTURES.map((f) => f.stars),
        1,
      ),
      bodyCount: encodeColumn(
        FIXTURES.map((f) => f.bodies),
        3,
      ),
      minPeriod: encodeColumn(low, 2),
      periodSpread: encodeColumn(
        high.map((h, i) => h - low[i]),
        2,
      ),
      tagSet: encodeColumn(
        FIXTURES.map((f) => f.tagSet),
        2,
      ),
      // Only the hand-authored Sun and Earth is featured.
      featured: encodeColumn([0, 1, 0], 1),
    },
    index: { habitable: encodePostings([2]) },
    ...overrides,
  };
}

const catalogue = () => new Catalogue(buildManifest());

describe("manifest integrity", () => {
  it("refuses a format version it does not understand", () => {
    expect(() => new Catalogue(buildManifest({ formatVersion: 99 }))).toThrow(
      /not the 1 this build understands/,
    );
  });

  it("refuses a manifest whose name count contradicts its own count", () => {
    expect(() => new Catalogue(buildManifest({ count: 4 }))).toThrow(
      /holds 4 scenarios but carries 3 names/,
    );
  });

  it("refuses a manifest with verbatim ids nothing asks for", () => {
    expect(
      () => new Catalogue(buildManifest({ explicitIds: "sun-and-earth\nstray-id" })),
    ).toThrow(/2 verbatim ids but 1 entries ask for one/);
  });
});

describe("ids", () => {
  it("reconstructs a prefixed id from the name", () => {
    expect(catalogue().entry(0).id).toBe("exo-kepler-90");
    expect(catalogue().entry(2).id).toBe("exo-trappist-1");
  });

  it("uses the verbatim id where the name does not produce it", () => {
    expect(catalogue().entry(1).id).toBe("sun-and-earth");
  });

  it("finds an entry by id", () => {
    expect(catalogue().indexOfId("sun-and-earth")).toBe(1);
    expect(catalogue().indexOfId("no-such-thing")).toBe(-1);
    expect(catalogue().has("exo-trappist-1")).toBe(true);
  });
});

describe("entry", () => {
  it("decodes every facet back to the value the build put in", () => {
    const entry = catalogue().entry(0);
    expect(entry).toMatchObject({
      index: 0,
      name: "Kepler-90",
      category: "exoplanets",
      difficulty: "intermediate",
      cost: "moderate",
      provider: "NASA Exoplanet Archive",
      bodyCount: 9,
      starCount: 1,
      satelliteCount: 8,
    });
    expect(entry.tags).toEqual(["exoplanet", "multi-planet"]);
    // Periods are quantised to 16 buckets per decade, so assert the RELATIVE
    // error the format promises (7.5%) rather than an absolute tolerance,
    // which would be far too tight at 331 days and far too loose at 7.
    const within = (actual: number | null, expected: number) => {
      expect(actual).not.toBeNull();
      expect(Math.abs((actual as number) - expected) / expected).toBeLessThan(0.075);
    };
    within(entry.minPeriodDays, 7);
    within(entry.maxPeriodDays, 331);
  });

  it("refuses an index outside the catalogue", () => {
    expect(() => catalogue().entry(3)).toThrow(/No catalogue entry at 3/);
  });
});

describe("search", () => {
  it("returns everything for an empty query", () => {
    expect(catalogue().search("   ")).toHaveLength(3);
  });

  it("ranks an exact name above a partial one", () => {
    const hits = [...catalogue().search("kepler")];
    expect(hits[0]).toBe(0);
  });

  it("finds a scenario by a term only the index carries", () => {
    // "habitable" appears in TRAPPIST-1's summary, not in its name or tags.
    expect([...catalogue().search("habitable")]).toEqual([2]);
  });

  it("finds a scenario by tag", () => {
    expect([...catalogue().search("multi-planet")].sort()).toEqual([0, 2]);
  });

  it("finds a scenario by data source", () => {
    expect([...catalogue().search("nssdca")]).toEqual([1]);
  });

  it("narrows rather than widens as tokens are added", () => {
    const one = catalogue().search("exoplanet");
    const two = catalogue().search("exoplanet trappist");
    expect(two.length).toBeLessThan(one.length);
    expect([...two]).toEqual([2]);
  });

  it("returns nothing, rather than everything, when a token matches nothing", () => {
    expect(catalogue().search("zzzznotathing")).toHaveLength(0);
    expect(catalogue().search("kepler zzzznotathing")).toHaveLength(0);
  });
});

describe("filter", () => {
  const all = () => catalogue().all();

  it("is a no-op when no facet is selected", () => {
    expect(catalogue().filter(all(), {})).toHaveLength(3);
  });

  it("filters by category", () => {
    const out = catalogue().filter(all(), { categories: ["solar-system"] });
    expect([...out]).toEqual([1]);
  });

  it("filters by data source", () => {
    const out = catalogue().filter(all(), { providers: ["NASA NSSDCA"] });
    expect([...out]).toEqual([1]);
  });

  it("treats several tags as a union, so ticking more shows more", () => {
    const one = catalogue().filter(all(), { tags: ["solar-system"] });
    const two = catalogue().filter(all(), { tags: ["solar-system", "multi-planet"] });
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(3);
  });

  it("filters by body count range", () => {
    expect([...catalogue().filter(all(), { maxBodies: 2 })]).toEqual([1]);
    expect([...catalogue().filter(all(), { minBodies: 9 })]).toEqual([0]);
  });

  it("filters by star count", () => {
    expect(catalogue().filter(all(), { starCounts: [1] })).toHaveLength(3);
    expect(catalogue().filter(all(), { starCounts: [2] })).toHaveLength(0);
  });

  it("matches a period band when ANY orbit in the system falls inside it", () => {
    // TRAPPIST-1 spans 1.5 to 18.8 days, so it matches a 10-to-100-day band
    // even though its shortest orbit is well under 10 days.
    const out = catalogue().filter(all(), { minPeriodDays: 10, maxPeriodDays: 100 });
    expect([...out].sort()).toEqual([0, 2]);
  });

  it("excludes a system whose whole range is outside the band", () => {
    const out = catalogue().filter(all(), { minPeriodDays: 1000, maxPeriodDays: 2000 });
    expect([...out]).toEqual([]);
  });

  it("intersects across different facets", () => {
    const out = catalogue().filter(all(), {
      categories: ["exoplanets"],
      minBodies: 9,
    });
    expect([...out]).toEqual([0]);
  });
});

describe("featured", () => {
  it("lists the hand-authored scenarios", () => {
    expect([...catalogue().featured()]).toEqual([1]);
    expect(catalogue().entry(1).featured).toBe(true);
    expect(catalogue().entry(0).featured).toBe(false);
  });

  it("sorts them to the front, with name as the tie-break", () => {
    const c = catalogue();
    expect([...c.sort(c.all(), "featured", "desc")]).toEqual([1, 0, 2]);
  });
});

describe("sort", () => {
  it("sorts by name in both directions", () => {
    const c = catalogue();
    expect([...c.sort(c.all(), "name", "asc")]).toEqual([0, 1, 2]);
    expect([...c.sort(c.all(), "name", "desc")]).toEqual([2, 1, 0]);
  });

  it("sorts by body count", () => {
    const c = catalogue();
    expect([...c.sort(c.all(), "bodies", "desc")]).toEqual([0, 2, 1]);
    expect([...c.sort(c.all(), "bodies", "asc")]).toEqual([1, 2, 0]);
  });

  it("breaks ties alphabetically whichever way the key is pointed", () => {
    // A descending primary key must not silently reverse the alphabet for
    // everything it ties on.
    const c = new Catalogue(
      buildManifest({
        columns: { ...buildManifest().columns, bodyCount: encodeColumn([5, 5, 5], 3) },
      }),
    );
    expect([...c.sort(c.all(), "bodies", "desc")]).toEqual([0, 1, 2]);
    expect([...c.sort(c.all(), "bodies", "asc")]).toEqual([0, 1, 2]);
  });

  it("sorts by shortest orbit", () => {
    const c = catalogue();
    expect([...c.sort(c.all(), "period", "asc")]).toEqual([2, 0, 1]);
  });
});

describe("facet counts", () => {
  it("counts a facet over an arbitrary result list", () => {
    const c = catalogue();
    expect(c.facetCounts(c.all(), "category")).toEqual([2, 1]);
    expect(c.facetCounts(c.all(), "difficulty")).toEqual([1, 2, 0]);
  });

  it("counts tags, highest first, omitting tags nothing carries", () => {
    const c = catalogue();
    expect(c.tagCounts(c.all())).toEqual([
      { tag: "exoplanet", count: 2 },
      { tag: "multi-planet", count: 2 },
      { tag: "solar-system", count: 1 },
    ]);
  });

  it("counts stars", () => {
    const c = catalogue();
    expect([...c.starCountBuckets(c.all())]).toEqual([[1, 3]]);
  });
});
