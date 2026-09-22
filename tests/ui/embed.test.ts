/**
 * Chrome-less embedding.
 *
 * The parsing is small and the consequences are not: a false positive hides
 * the site's own navigation from someone who did not ask for that.
 */
import { describe, it, expect } from "vitest";
import { isEmbedded, fullSiteUrl } from "../../src/ui/embed";

describe("isEmbedded", () => {
  it("accepts the obvious affirmatives", () => {
    for (const search of ["?embed=1", "?embed=true", "?embed=yes"]) {
      expect(isEmbedded(search), search).toBe(true);
    }
  });

  it("accepts it alongside other parameters, in any position", () => {
    expect(isEmbedded("?utm_source=lesson&embed=1")).toBe(true);
    expect(isEmbedded("?embed=1&theme=dark")).toBe(true);
  });

  it("rejects anything else, rather than guessing", () => {
    // A stray ?embed=0 hiding the navigation would be a silent trap.
    for (const search of [
      "",
      "?",
      "?embed=0",
      "?embed=false",
      "?embed",
      "?embed=",
      "?embedded=1",
      "?noembed=1",
    ]) {
      expect(isEmbedded(search), JSON.stringify(search)).toBe(false);
    }
  });

  it("does not care whether the leading question mark is there", () => {
    expect(isEmbedded("embed=1")).toBe(true);
  });
});

describe("fullSiteUrl", () => {
  it("resolves the base path against the page's own origin", () => {
    // Never a hardcoded domain: we do not control where this is deployed.
    expect(fullSiteUrl("/gravity/", "https://example.org")).toBe(
      "https://example.org/gravity/",
    );
    expect(fullSiteUrl("/", "https://example.org")).toBe("https://example.org/");
  });

  it("falls back to the origin when the base is unusable", () => {
    expect(fullSiteUrl("", "https://example.org")).toBe("https://example.org/");
  });
});
