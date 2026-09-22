/**
 * Real URLs.
 *
 * Routing is the thing a static host and a crawler both have to agree with, so
 * these tests care about the base path, the trailing slash, and what happens to
 * a path that matches nothing — the three places a hash router never had to be
 * right.
 */
import { describe, it, expect } from "vitest";
import {
  href,
  legacyHashRoute,
  normaliseBase,
  parseLocation,
  relativePath,
  routePath,
  type Route,
} from "../src/routes";
import { sharePayloadFromHash } from "../src/share/link";

const parse = (pathname: string, hash = "", base = "/") =>
  parseLocation(pathname, hash, base, sharePayloadFromHash);

describe("normaliseBase", () => {
  it("accepts every spelling of the same base", () => {
    expect(normaliseBase("/")).toBe("/");
    expect(normaliseBase("")).toBe("/");
    expect(normaliseBase("/gravity/")).toBe("/gravity/");
    expect(normaliseBase("/gravity")).toBe("/gravity/");
    expect(normaliseBase("gravity")).toBe("/gravity/");
  });
});

describe("relativePath", () => {
  it("strips the base", () => {
    expect(relativePath("/gravity/scenario/x/", "/gravity/")).toBe("scenario/x");
    expect(relativePath("/gravity/", "/gravity/")).toBe("");
    expect(relativePath("/gravity", "/gravity/")).toBe("");
  });

  it("works at the root", () => {
    expect(relativePath("/scenario/x/", "/")).toBe("scenario/x");
    expect(relativePath("/", "/")).toBe("");
  });

  it("is null for a path outside the base, which is not the same as a 404", () => {
    expect(relativePath("/elsewhere/", "/gravity/")).toBeNull();
  });
});

describe("parseLocation", () => {
  it("reads every route, with and without a trailing slash", () => {
    const cases: Array<[string, Route]> = [
      ["/", { kind: "catalogue" }],
      ["/scenarios/", { kind: "catalogue" }],
      ["/build/", { kind: "build" }],
      ["/saved/", { kind: "saved" }],
      ["/about/", { kind: "about" }],
      ["/privacy/", { kind: "privacy" }],
      ["/scratch/", { kind: "scratch" }],
      ["/scenario/exo-trappist-1/", { kind: "scenario", id: "exo-trappist-1" }],
      ["/scenario/exo-trappist-1", { kind: "scenario", id: "exo-trappist-1" }],
      ["/scenarios/exoplanets/", { kind: "category", id: "exoplanets" }],
    ];
    for (const [path, expected] of cases) {
      expect(parse(path), path).toEqual(expected);
    }
  });

  it("reads the same routes under a base path", () => {
    expect(parse("/gravity/scenario/sun-and-earth/", "", "/gravity/")).toEqual({
      kind: "scenario",
      id: "sun-and-earth",
    });
    expect(parse("/gravity/", "", "/gravity/")).toEqual({ kind: "catalogue" });
  });

  it("decodes a saved id, which is user data rather than a slug", () => {
    expect(parse("/saved/My%20System/")).toEqual({
      kind: "savedScenario",
      id: "My System",
    });
  });

  it("does not fall back to the home page for an unknown path", () => {
    // The old router returned the catalogue for anything it did not recognise,
    // which meant a mistyped URL answered 200 with the wrong page. A static
    // host and a crawler both need to be told it is not there.
    expect(parse("/nonsense/")).toEqual({ kind: "notFound", path: "/nonsense/" });
    expect(parse("/scenario/")).toEqual({ kind: "notFound", path: "/scenario/" });
    expect(parse("/scenario/UPPER/")).toEqual({
      kind: "notFound",
      path: "/scenario/UPPER/",
    });
    expect(parse("/scenario/a/b/")).toEqual({
      kind: "notFound",
      path: "/scenario/a/b/",
    });
  });

  it("treats a path outside the base as not found", () => {
    expect(parse("/somewhere-else/", "", "/gravity/").kind).toBe("notFound");
  });

  it("lets a share payload in the fragment win over the path", () => {
    // A share link is the home page plus a payload; the path says nothing.
    const route = parse("/", "#/shared/s1.eyJhIjoxfQ");
    expect(route.kind).toBe("shared");
  });

  it("ignores a fragment that is not a share payload", () => {
    expect(parse("/about/", "#main")).toEqual({ kind: "about" });
  });
});

describe("routePath and href", () => {
  it("round-trips every route", () => {
    const routes: Route[] = [
      { kind: "catalogue" },
      { kind: "category", id: "stars" },
      { kind: "scenario", id: "sun-and-earth" },
      { kind: "build" },
      { kind: "saved" },
      { kind: "about" },
      { kind: "privacy" },
      { kind: "scratch" },
    ];
    for (const route of routes) {
      expect(parse(routePath(route)), routePath(route)).toEqual(route);
    }
  });

  it("always ends a directory path with a slash", () => {
    // A static host serves /scenario/x/ from scenario/x/index.html, and mixing
    // the two spellings is how every page gets indexed twice.
    for (const route of [
      { kind: "scenario", id: "x" } as const,
      { kind: "category", id: "y" } as const,
      { kind: "about" } as const,
    ]) {
      expect(routePath(route).endsWith("/")).toBe(true);
    }
    expect(routePath({ kind: "catalogue" })).toBe("/");
  });

  it("prefixes the base exactly once", () => {
    expect(href({ kind: "scenario", id: "x" }, "/gravity/")).toBe(
      "/gravity/scenario/x/",
    );
    expect(href({ kind: "catalogue" }, "/gravity/")).toBe("/gravity/");
    expect(href({ kind: "catalogue" }, "/")).toBe("/");
    expect(href({ kind: "about" }, "/")).toBe("/about/");
  });

  it("encodes a saved id that is not URL-safe", () => {
    const path = routePath({ kind: "savedScenario", id: "a/b c" });
    expect(path).toBe("/saved/a%2Fb%20c/");
    expect(parse(path)).toEqual({ kind: "savedScenario", id: "a/b c" });
  });
});

describe("legacyHashRoute", () => {
  it("translates every old fragment route, so shared links keep working", () => {
    expect(legacyHashRoute("#/")).toBe("/");
    expect(legacyHashRoute("#/scenarios")).toBe("/");
    expect(legacyHashRoute("#/about")).toBe("/about/");
    expect(legacyHashRoute("#/build")).toBe("/build/");
    expect(legacyHashRoute("#/scenario/sun-and-earth")).toBe(
      "/scenario/sun-and-earth/",
    );
    expect(legacyHashRoute("#/category/stars")).toBe("/scenarios/stars/");
    expect(legacyHashRoute("#/saved/My%20System")).toBe("/saved/My%20System/");
  });

  it("leaves a share payload alone, because its fragment is not a route", () => {
    expect(legacyHashRoute("#/shared/s1.eyJhIjoxfQ")).toBeNull();
    expect(legacyHashRoute("")).toBeNull();
    expect(legacyHashRoute("#main")).toBeNull();
  });

  it("returns null for a fragment route that means nothing", () => {
    expect(legacyHashRoute("#/nonsense")).toBeNull();
  });
});
