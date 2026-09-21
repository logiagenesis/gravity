/**
 * Application shell and hash router.
 *
 * Hash routing is deliberate. It keeps the whole product deployable as static
 * files with no server rewrite rules, and it is what makes share links work
 * without a backend: the scenario payload rides in the fragment, which is never
 * transmitted to the server (see src/share/link.ts).
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
import { AboutPage, PrivacyPage } from "./StaticPages";
import { loadScenario } from "../catalog";
import { decodeScenario, sharePayloadFromHash } from "../share/link";
import { getSavedScenario } from "../storage/saved-scenarios";
import type { Scenario } from "../schema/scenario";

type Route =
  | { kind: "catalogue" }
  | { kind: "scenario"; id: string }
  | { kind: "saved" }
  | { kind: "savedScenario"; id: string }
  | { kind: "shared"; payload: string }
  | { kind: "about" }
  | { kind: "privacy" };

function parseHash(hash: string): Route {
  const shared = sharePayloadFromHash(hash);
  if (shared) return { kind: "shared", payload: shared };

  const path = hash.replace(/^#\/?/, "");
  if (path === "" || path === "scenarios") return { kind: "catalogue" };
  if (path === "saved") return { kind: "saved" };
  if (path === "about") return { kind: "about" };
  if (path === "privacy") return { kind: "privacy" };

  const scenario = /^scenario\/([a-z0-9-]+)$/.exec(path);
  if (scenario) return { kind: "scenario", id: scenario[1] };

  const saved = /^saved\/(.+)$/.exec(path);
  if (saved) return { kind: "savedScenario", id: decodeURIComponent(saved[1]) };

  return { kind: "catalogue" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(globalThis.location.hash));
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(globalThis.location.hash));
    globalThis.addEventListener("hashchange", onHashChange);
    return () => globalThis.removeEventListener("hashchange", onHashChange);
  }, []);

  // Resolve whatever the route points at into a validated scenario.
  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<Scenario | null> => {
      switch (route.kind) {
        case "scenario":
          return loadScenario(route.id);
        case "savedScenario":
          return getSavedScenario(route.id);
        case "shared":
          return decodeScenario(route.payload);
        default:
          return null;
      }
    };

    setLoadError(null);
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

  const navigate = useCallback((hash: string) => {
    globalThis.location.hash = hash;
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
          <button type="button" className="btn" onClick={() => navigate("#/")}>
            Back to all scenarios
          </button>
        </div>
      );
    }

    switch (route.kind) {
      case "catalogue":
        return <CataloguePage onOpen={(id) => navigate(`#/scenario/${id}`)} />;
      case "saved":
        return (
          <SavedPage
            onOpen={(id) => navigate(`#/saved/${encodeURIComponent(id)}`)}
            onOpenImported={(imported) => {
              setScenario(imported);
              setRoute({ kind: "shared", payload: "" });
            }}
          />
        );
      case "about":
        return <AboutPage />;
      case "privacy":
        return <PrivacyPage />;
      default:
        return scenario ? (
          <Suspense fallback={<p role="status">Loading the simulator…</p>}>
            <SimulatorPage scenario={scenario} onBack={() => navigate("#/")} />
          </Suspense>
        ) : (
          <p role="status">Loading…</p>
        );
    }
  };

  // The simulator takes over the viewport; every other route scrolls normally.
  const immersive =
    route.kind === "scenario" ||
    route.kind === "savedScenario" ||
    route.kind === "shared";

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
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="site-header">
        <a className="brand" href="#/">
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
            {navLink("#/", "Scenarios", route.kind === "catalogue")}
            {navLink("#/saved", "Saved", route.kind === "saved")}
            {navLink("#/about", "About", route.kind === "about")}
          </ul>
        </nav>
      </header>

      <main className="main" id="main" tabIndex={-1}>
        {renderRoute()}
      </main>

      {!immersive && (
        <footer className="site-footer">
          <p>
            An interactive n-body gravity simulator. Physics runs off the main thread,
            and the conservation diagnostics are shown so you can judge the results
            yourself.
          </p>
          <ul>
            <li>
              <a href="#/about">About</a>
            </li>
            <li>
              <a href="#/privacy">Privacy</a>
            </li>
          </ul>
        </footer>
      )}
    </div>
  );
}
