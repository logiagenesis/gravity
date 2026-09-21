/**
 * The catalogue wire format.
 *
 * These are the encoders the build writes with and the client reads back. A
 * silent disagreement between them would not crash anything: it would just
 * quietly serve the wrong facts, which is worse.
 */
import { describe, it, expect } from "vitest";
import {
  PERIOD_BUCKET_NONE,
  PERIOD_BUCKET_OFFSET,
  decodeColumn,
  decodePeriodBucket,
  decodePostings,
  encodeColumn,
  encodePeriodBucket,
  encodePostings,
  slugify,
} from "../../src/catalog/format";

describe("fixed-width base-36 columns", () => {
  it("round-trips every value it claims to hold", () => {
    const values = [0, 1, 35, 36, 1295, 46655];
    const encoded = encodeColumn(values, 3);
    expect(encoded).toHaveLength(values.length * 3);
    expect([...decodeColumn(encoded, 3, values.length)]).toEqual(values);
  });

  it("keeps identical values as identical bytes, which is the point", () => {
    // The encoding exists because runs of one value compress; if the width
    // were not fixed, a run would not be a run.
    expect(encodeColumn([7, 7, 7], 1)).toBe("777");
    expect(encodeColumn([7, 7, 7], 2)).toBe("070707");
  });

  it("refuses a value too wide for the column rather than truncating it", () => {
    expect(() => encodeColumn([36], 1)).toThrow(/needs 2 base-36 digits/);
  });

  it("refuses a column whose length does not match the entry count", () => {
    expect(() => decodeColumn("0123", 1, 5)).toThrow(/expected 5/);
  });
});

describe("period buckets", () => {
  it("reserves zero for 'no bound orbit'", () => {
    expect(encodePeriodBucket(0)).toBe(PERIOD_BUCKET_NONE);
    expect(encodePeriodBucket(-1)).toBe(PERIOD_BUCKET_NONE);
    expect(encodePeriodBucket(Number.NaN)).toBe(PERIOD_BUCKET_NONE);
    expect(decodePeriodBucket(PERIOD_BUCKET_NONE)).toBeNull();
  });

  it("puts one day at the offset, by construction", () => {
    expect(encodePeriodBucket(1)).toBe(PERIOD_BUCKET_OFFSET);
  });

  it("round-trips within the quantisation error the format promises", () => {
    // 16 buckets per decade means a half-bucket worst case, which is
    // 10^(1/32) - 1 = 7.5%. Assert that bound rather than a looser one.
    for (const days of [0.041, 0.5, 1, 11.86, 365.25, 60182, 9.2e5]) {
      const back = decodePeriodBucket(encodePeriodBucket(days));
      expect(back).not.toBeNull();
      expect(Math.abs((back as number) - days) / days).toBeLessThan(0.075);
    }
  });

  it("saturates rather than wrapping outside the representable range", () => {
    expect(encodePeriodBucket(1e-30)).toBe(1);
    expect(encodePeriodBucket(1e30)).toBe(255);
  });
});

describe("posting lists", () => {
  it("round-trips", () => {
    const indices = [0, 1, 5, 4438];
    expect(decodePostings(encodePostings(indices))).toEqual(indices);
  });

  it("encodes gaps, not absolute positions", () => {
    // 0, 5, 8 -> gaps 0, 5, 3. Small gaps are what make the list compress.
    expect(encodePostings([0, 5, 8])).toBe("0.5.3");
  });

  it("handles an empty list", () => {
    expect(encodePostings([])).toBe("");
    expect(decodePostings("")).toEqual([]);
  });
});

describe("slugify", () => {
  it("is the rule the exoplanet pipeline builds ids with", () => {
    expect(slugify("11 Com")).toBe("11-com");
    expect(slugify("HD 189733")).toBe("hd-189733");
    expect(slugify("Kepler-90")).toBe("kepler-90");
  });

  it("strips leading and trailing separators", () => {
    expect(slugify("  *HAT-P-7*  ")).toBe("hat-p-7");
  });

  it("bounds the length, so an id cannot grow without limit", () => {
    expect(slugify("a".repeat(200))).toHaveLength(80);
  });
});
