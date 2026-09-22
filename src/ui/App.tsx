/**
 * Application shell and router.
 *
 * Routes are REAL PATHS, not fragments. A fragment router is simpler and is
 * invisible to search engines, so 5,142 scenarios collapsed to one indexable
 * page. Every route is now a path a static host resolves from a prerendered
 * document (`scripts/prerender.ts`) and a crawler can follow.
 *
 * The fragment is still load-bearing, for one thing only: a share link carries
 * the whole scenario in it, because a fragment is never sent to the server.
 * The path says which page; the fragment carries a shared scenario. The two no
 * longer compete for the same space.
 *
 * Old `#/scenario/x` links are redirected once, on load, rather than keeping a
 * second router alive to serve them.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CataloguePage } from "./CataloguePage";
/*
 * The simulator pulls in Three.js, which is by far the largest dependency.
 * Lazy-loading it keeps the 3D engine out of the initial download for anyone
 * who is only browsing or searching the catalogue.
 */
const SimulatorPage = lazy(() =>
  import("./SimulatorPage").then((m) => ({ default: m.SimulatorPage })),
);
import { SavedPage } from "./SavedPage";
import { BuildPage } from "./BuildPage";
import { isEmbedded, fullSiteUrl } from "./embed";
import { AboutPage, PrivacyPage } from "./StaticPages";
import { loadCatalogue } from "../catalog";
import { decodeScenario, sharePayloadFromHash } from "../share/link";
import {
  href as routeHref,
  legacyHashRoute,
  normaliseBase,
  parseLocation,
  type Route,
} from "../routes";
import { getSavedScenario } from "../storage/saved-scenarios";
import type { Scenario } from "../schema/scenario";

/**
 * The base path the app is served from, fixed at build time.
 *
 * Vite substitutes this, so a deploy to `/gravity/` and a deploy to `/` both
 * produce correct links with no runtime detection.
 */
const BASE = normaliseBase(import.meta.env.BASE_URL);

/** An href for a route, base included. */
function href(route: Route): string {
  return routeHref(route, BASE);
}

/** The route the browser is currently showing. */
function currentRoute(): Route {
  return parseLocation(
    globalThis.location.pathname,
    globalThis.location.hash,
    BASE,
    sharePayloadFromHash,
  );
}

export function App() {
  /*
   * Read once. The embedding is a property of how the page was opened, not of
   * where the visitor has navigated to since, and the hash router changes the
   * hash constantly.
   */
  const [embedded] = useState(() => isEmbedded(globalThis.location.search));
  const [route, setRoute] = useState<Route>(() => currentRoute());
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // popstate for Back and Forward; hashchange because a share link only ever
    // changes the fragment, which does not fire popstate.
    const sync = () => setRoute(currentRoute());
    globalThis.addEventListener("popstate", sync);
    globalThis.addEventListener("hashchange", sync);
    return () => {
      globalThis.removeEventListener("popstate", sync);
      globalThis.removeEventListener("hashchange", sync);
    };
  }, []);

  /*
   * Redirect an old fragment route to its path, once, replacing the history
   * entry so Back does not bounce between the two spellings.
   */
  useEffect(() => {
    const target = legacyHashRoute(globalThis.location.hash);
    if (target === null) return;
    globalThis.history.replaceState(null, "", `${BASE}${target.replace(/^\//, "")}`);
    setRoute(currentRoute());
  }, []);

  // Resolve whatever the route points at into a validated scenario.
  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<Scenario | null> => {
      switch (route.kind) {
        case "scenario":
          return (await loadCatalogue()).scenario(route.id);
        case "savedScenario":
          return getSavedScenario(route.id);
        case "shared":
          return decodeScenario(route.payload);
        default:
          return null;
      }
    };

    setLoadError(null);
    // A scratch scenario is already in hand and has nothing to resolve from.
    // Falling through would clear it.
    if (route.kind === "scratch") return;

    const needsScenario =
      route.kind === "scenario" ||
      route.kind === "savedScenario" ||
      route.kind === "shared";

    if (!needsScenario) {
      setScenario(null);
      return;
    }

    setBusy(true);
    resolve()
      .then((result) => {
        if (!cancelled) setScenario(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setScenario(null);
        setLoadError(
          error instanceof Error ? error.message : "That scenario could not be opened.",
        );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [route]);

  /**
   * Go to a route.
   *
   * pushState, then set the route directly: pushState does NOT fire popstate,
   * so nothing else would notice. The fragment is cleared, because the only
   * thing that lives there is a share payload and it does not belong on the
   * page being navigated to.
   */
  const navigate = useCallback((target: Route) => {
    globalThis.history.pushState(null, "", href(target));
    setRoute(target);
  }, []);

  // Move focus to main on NAVIGATION, so keyboard and screen-reader users are
  // not silently left on a page they cannot tell changed.
  //
  // Deliberately skipped on first load: taking focus on mount would put it past
  // the skip link, so the first Tab would no longer reach it. The skip link
  // must be the first thing a keyboard user encounters.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [route]);

  const renderRoute = () => {
    if (busy) return <p role="status">Loading…</p>;

    if (loadError) {
      return (
        <div className="notice notice--error" role="alert">
          <p>
            <strong>That scenario could not be opened.</strong>
          </p>
          <p>{loadError}</p>
          <button
            type="button"
            className="btn"
            onClick={() => navigate({ kind: "catalogue" })}
          >
            Back to all scenarios
          </button>
        </div>
      );
    }

    const simulator = scenario ? (
      <Suspense fallback={<p role="status">Loading the simulator…</p>}>
        <SimulatorPage
          scenario={scenario}
          onBack={() => navigate({ kind: "catalogue" })}
        />
      </Suspense>
    ) : (
      <p role="status">Loading…</p>
    );

    switch (route.kind) {
      case "catalogue":
        return <CataloguePage onOpen={(id) => navigate({ kind: "scenario", id })} />;
      case "category":
        return (
          <CataloguePage
            category={route.id}
            onOpen={(id) => navigate({ kind: "scenario", id })}
          />
        );
      case "saved":
        return (
          <SavedPage
            onOpen={(id) => navigate({ kind: "savedScenario", id })}
            onOpenImported={(imported) => {
              setScenario(imported);
              navigate({ kind: "scratch" });
            }}
          />
        );
      case "build":
        return (
          <BuildPage
            onOpenSaved={(id) => navigate({ kind: "savedScenario", id })}
            onOpenScratch={(built) => {
              setScenario(built);
              navigate({ kind: "scratch" });
            }}
          />
        );
      case "scratch":
        // Reached directly, or after a reload, there is nothing to show: the
        // scenario lived in memory. Say so rather than showing a blank page.
        if (scenario === null) {
          return (
            <div className="notice" role="status">
              <p>
                <strong>Nothing to show here.</strong>
              </p>
              <p>
                This address holds a scenario that was built or imported in this tab,
                and it is not stored anywhere, so a reload loses it.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => navigate({ kind: "build" })}
              >
                Build another
              </button>
            </div>
          );
        }
        return simulator;
      case "about":
        return <AboutPage />;
      case "privacy":
        return <PrivacyPage />;
      default:
        return simulator;
    }
  };

  // The simulator takes over the viewport; every other route scrolls normally.
  const immersive =
    route.kind === "scenario" ||
    route.kind === "savedScenario" ||
    route.kind === "shared" ||
    route.kind === "scratch";

  const navLink = (href: string, label: string, active: boolean) => (
    <li>
      <a className="nav-link" href={href} aria-current={active ? "page" : undefined}>
        {label}
      </a>
    </li>
  );

  return (
    <div
      className="app"
      data-immersive={immersive && scenario !== null ? "true" : "false"}
      data-embed={embedded ? "true" : "false"}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {embedded ? (
        /*
         * Embedded: one line of attribution instead of a site header.
         *
         * It is not decoration. A simulation sitting inside somebody else's
         * page with no way to tell what it is, or to reach the sources behind
         * its numbers, is a page presenting this work as its own. The link
         * points at wherever this copy is deployed, derived from the page's
         * own base URL — we do not control the domain, so there is no correct
         * constant to hardcode.
         */
        <p className="embed-attribution">
          <a
            href={fullSiteUrl(import.meta.env.BASE_URL, globalThis.location.origin)}
            target="_blank"
            rel="noopener"
          >
            Gravity Simulator — open the full version
          </a>
        </p>
      ) : (
        <header className="site-header">
          <a className="brand" href={href({ kind: "catalogue" })}>
            <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
              <ellipse
                cx="32"
                cy="32"
                rx="26"
                ry="10"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.5"
                strokeWidth="3"
                transform="rotate(-20 32 32)"
              />
              <circle cx="32" cy="32" r="10" fill="#ffd27f" />
              <circle cx="56" cy="23" r="4" fill="#6b93d6" />
            </svg>
            <span>Gravity Simulator</span>
          </a>
          <nav aria-label="Main">
            <ul>
              {navLink(
                "#/",
                "Scenarios",
                route.kind === "catalogue" || route.kind === "category",
              )}
              {navLink(href({ kind: "build" }), "Build", route.kind === "build")}
              {navLink(href({ kind: "saved" }), "Saved", route.kind === "saved")}
              {navLink(href({ kind: "about" }), "About", route.kind === "about")}
            </ul>
          </nav>
        </header>
      )}

      <main className="main" id="main" tabIndex={-1}>
        {renderRoute()}
      </main>

      {!immersive && !embedded && (
        <footer className="site-footer">
          <p>
            An interactive n-body gravity simulator. Physics runs off the main thread,
            and the conservation diagnostics are shown so you can judge the results
            yourself.
          </p>
          <ul>
            <li>
              <a href={href({ kind: "about" })}>About</a>
            </li>
            <li>
              <a href={href({ kind: "privacy" })}>Privacy</a>
            </li>
          </ul>
        </footer>
      )}
    </div>
  );
}
