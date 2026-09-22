/**
 * Real URLs.
 *
 * Routing used to live in the fragment (`#/scenario/x`). That works in a
 * browser and is worthless everywhere else: crawlers discard the fragment, so
 * 5,142 scenarios collapsed to one indexable page, and a sitemap of fragment
 * URLs would have been thousands of duplicate entries carrying no information.
 * Every route is now a path that a server resolves and a crawler can follow.
 *
 * THE FRAGMENT IS NOT FREE, THOUGH. Share links deliberately carry the whole
 * scenario in the fragment, because a fragment is never sent to the server —
 * that is a privacy property, not an accident. So the split is: the PATH says
 * which page, the FRAGMENT carries a shared scenario. They no longer compete.
 *
 * BASE PATH. The site may be served from a sub-path (`/gravity/` on GitHub
 * Pages) or from a root. Every function here takes the base explicitly rather
 * than reading a global, so the same code is testable without a DOM and the
 * prerenderer can use it to write files.
 */

export type Route =
  | { kind: "catalogue" }
  | { kind: "category"; id: string }
  | { kind: "scenario"; id: string }
  | { kind: "build" }
  | { kind: "saved" }
  | { kind: "savedScenario"; id: string }
  | { kind: "about" }
  | { kind: "privacy" }
  /** A scenario carried in the fragment. */
  | { kind: "shared"; payload: string }
  /** A scenario held in memory: just built, or just imported. */
  | { kind: "scratch" }
  /** A path that matches nothing. Rendered as a real 404, not as the home page. */
  | { kind: "notFound"; path: string };

/** Ids in a URL are restricted so a path can never be ambiguous or injected. */
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Normalise a base to the "/…/" form every function here assumes. */
export function normaliseBase(base: string): string {
  if (base === "" || base === "/") return "/";
  const withLeading = base.startsWith("/") ? base : `/${base}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/**
 * The part of a pathname below the base, with no leading or trailing slash.
 *
 * Returns null when the pathname is not under the base at all, which is a
 * misconfiguration rather than a 404 and is worth telling apart.
 */
export function relativePath(pathname: string, base: string): string | null {
  const b = normaliseBase(base);
  const withSlash = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (!withSlash.startsWith(b)) return null;
  return withSlash.slice(b.length).replace(/^\/+|\/+$/g, "");
}

/**
 * Parse a location into a route.
 *
 * A share payload in the fragment wins over the path, because a share link is
 * `…/#<payload>` and its path is just the home page.
 */
export function parseLocation(
  pathname: string,
  hash: string,
  base: string,
  sharePayload: (hash: string) => string | null,
): Route {
  const shared = sharePayload(hash);
  if (shared !== null && shared !== "") return { kind: "shared", payload: shared };

  const path = relativePath(pathname, base);
  if (path === null) return { kind: "notFound", path: pathname };
  if (path === "") return { kind: "catalogue" };

  const segments = path.split("/");
  if (segments.length === 1) {
    switch (segments[0]) {
      case "scenarios":
        return { kind: "catalogue" };
      case "build":
        return { kind: "build" };
      case "saved":
        return { kind: "saved" };
      case "about":
        return { kind: "about" };
      case "privacy":
        return { kind: "privacy" };
      case "scratch":
        return { kind: "scratch" };
    }
  }

  if (segments.length === 2) {
    const [head, tail] = segments;
    if (head === "scenario" && ID.test(tail)) return { kind: "scenario", id: tail };
    if (head === "scenarios" && ID.test(tail)) return { kind: "category", id: tail };
    if (head === "saved") {
      // Saved ids are user data, not catalogue slugs, so they are percent-
      // encoded rather than restricted.
      const id = safeDecode(tail);
      if (id !== null && id !== "") return { kind: "savedScenario", id };
    }
  }

  return { kind: "notFound", path: pathname };
}

function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    // A malformed escape is a bad URL, not a crash.
    return null;
  }
}

/**
 * The rooted path for a route, WITHOUT the base.
 *
 * Trailing slashes are deliberate and consistent: a static host serves
 * `/scenario/x/` from `scenario/x/index.html`, and mixing the two forms is how
 * a site ends up with every page indexed twice.
 */
export function routePath(route: Route): string {
  switch (route.kind) {
    case "catalogue":
      return "/";
    case "category":
      return `/scenarios/${route.id}/`;
    case "scenario":
      return `/scenario/${route.id}/`;
    case "build":
      return "/build/";
    case "saved":
      return "/saved/";
    case "savedScenario":
      return `/saved/${encodeURIComponent(route.id)}/`;
    case "about":
      return "/about/";
    case "privacy":
      return "/privacy/";
    case "scratch":
      return "/scratch/";
    case "shared":
      return "/";
    case "notFound":
      return route.path;
  }
}

/** An href for a route, ready to put in an anchor. */
export function href(route: Route, base: string): string {
  const path = routePath(route);
  return `${normaliseBase(base)}${path.replace(/^\//, "")}`;
}

/**
 * Translate an old fragment route to its path equivalent, or null.
 *
 * Every `#/scenario/x` link shared before this change still has to work. The
 * app redirects them once, on load, rather than keeping two routers alive.
 * Share links are excluded: their fragment is the payload, not a route.
 */
export function legacyHashRoute(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const path = hash.slice(2).replace(/\/+$/, "");
  if (path === "" || path === "scenarios") return "/";
  if (["build", "saved", "about", "privacy", "scratch"].includes(path)) {
    return `/${path}/`;
  }
  const scenario = /^scenario\/([a-z0-9][a-z0-9-]*)$/.exec(path);
  if (scenario) return `/scenario/${scenario[1]}/`;
  const category = /^category\/([a-z0-9][a-z0-9-]*)$/.exec(path);
  if (category) return `/scenarios/${category[1]}/`;
  const saved = /^saved\/(.+)$/.exec(path);
  if (saved) {
    const id = safeDecode(saved[1]);
    if (id !== null && id !== "") return `/saved/${encodeURIComponent(id)}/`;
  }
  return null;
}
