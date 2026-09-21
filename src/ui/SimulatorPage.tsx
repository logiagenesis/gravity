/**
 * Simulator.
 *
 * Two architectural rules are load-bearing here:
 *
 *  1. PER-FRAME BODY STATE NEVER ENTERS REACT. Snapshots go straight from the
 *     worker to the renderer via a ref. React state updates only for the
 *     throttled HUD, a few times a second.
 *  2. THE CANVAS IS NOT THE ONLY OUTPUT. A live table of bodies, the
 *     diagnostics, and the play state are all real semantic HTML, so the
 *     information is available without seeing the render.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { GravityScene } from "../render/scene";
import { SimulationClient } from "../worker/client";
import type { BodyMeta, SnapshotMessage } from "../worker/protocol";
import { INTEGRATOR_INFO, type IntegratorName } from "../sim/integrators";
import { DAYS_PER_JULIAN_YEAR } from "../sim/constants";
import type { Scenario } from "../schema/scenario";
import { Tabs } from "./components/Tabs";
import { LiveRegion } from "./components/LiveRegion";
import { saveScenario, storageAvailable } from "../storage/saved-scenarios";
import { buildShareUrl, exportScenarioFile, ShareLinkError } from "../share/link";

/** HUD refresh rate. Deliberately slow: it is for reading, not animation. */
const HUD_INTERVAL_MS = 250;

/** Drift above this is called out as untrustworthy. */
const DRIFT_WARN = 1e-4;
const DRIFT_BAD = 1e-2;

const SPEEDS = [
  { label: "0.25×", value: 0.25 },
  { label: "1×", value: 1 },
  { label: "10×", value: 10 },
  { label: "100×", value: 100 },
  { label: "1000×", value: 1000 },
];

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function formatDuration(days: number): string {
  if (!Number.isFinite(days)) return "—";
  const abs = Math.abs(days);
  if (abs < 1) return `${(days * 24).toFixed(2)} hours`;
  if (abs < DAYS_PER_JULIAN_YEAR) return `${days.toFixed(2)} days`;
  return `${(days / DAYS_PER_JULIAN_YEAR).toFixed(3)} years`;
}

function driftClass(drift: number): string {
  if (drift > DRIFT_BAD) return "drift-bad";
  if (drift > DRIFT_WARN) return "drift-warn";
  return "drift-good";
}

function formatScientific(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return Math.abs(value) < 1e-3 || Math.abs(value) >= 1e5
    ? value.toExponential(3)
    : value.toFixed(5);
}

interface SimulatorPageProps {
  scenario: Scenario;
  onBack: () => void;
}

export function SimulatorPage({ scenario, onBack }: SimulatorPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GravityScene | null>(null);
  const clientRef = useRef<SimulationClient | null>(null);
  /** Latest snapshot, held in a ref so it never triggers a React render. */
  const latestRef = useRef<SnapshotMessage | null>(null);
  const positionsRef = useRef<Float32Array | null>(null);

  const [bodies, setBodies] = useState<BodyMeta[]>([]);
  const [hud, setHud] = useState<SnapshotMessage | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [integrator, setIntegrator] = useState<IntegratorName>(
    scenario.physics.integrator,
  );
  const [showTrails, setShowTrails] = useState(!prefersReducedMotion());
  const [announcement, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("bodies");
  const [frameMs, setFrameMs] = useState(0);

  const speedId = useId();
  const integratorId = useId();

  // --- worker + renderer lifecycle ------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new GravityScene({ canvas, reducedMotion: prefersReducedMotion() });
    scene.setCameraDistance(scenario.camera?.distance ?? 5);
    scene.start();
    sceneRef.current = scene;

    const client = new SimulationClient({
      onSnapshot: (snapshot) => {
        // Hot path: copy into the renderer and give the buffer straight back.
        const view = new Float32Array(snapshot.positions);
        positionsRef.current = view;
        scene.setPositions(view);
        latestRef.current = snapshot;
      },
      onLoaded: (_id, meta) => {
        setBodies(meta);
        scene.setBodies(meta);
      },
      onCollision: (absorbed, survivor) => {
        setAnnounce(`${absorbed.join(" and ")} merged into ${survivor}.`);
      },
      onError: (message, detail) => {
        setError(detail ? `${message} ${detail}` : message);
      },
    });
    clientRef.current = client;
    client.load(scenario);

    const onResize = () => scene.resize();
    globalThis.addEventListener("resize", onResize);

    return () => {
      globalThis.removeEventListener("resize", onResize);
      client.dispose();
      scene.dispose();
      clientRef.current = null;
      sceneRef.current = null;
    };
  }, [scenario]);

  // --- throttled HUD --------------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      if (latestRef.current) setHud(latestRef.current);
      if (sceneRef.current) setFrameMs(sceneRef.current.frameMs);
    }, HUD_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    sceneRef.current?.setTrailsEnabled(showTrails);
  }, [showTrails]);

  // --- controls -------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    setPlaying((current) => {
      const next = !current;
      if (next) client.play();
      else client.pause();
      setAnnounce(next ? "Simulation playing." : "Simulation paused.");
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    clientRef.current?.reset();
    setPlaying(false);
    setAnnounce("Simulation reset to its starting conditions.");
  }, []);

  const handleStep = useCallback(() => {
    clientRef.current?.step(1);
    setPlaying(false);
    setAnnounce("Advanced one step.");
  }, []);

  const handleIntegrator = (name: IntegratorName) => {
    setIntegrator(name);
    clientRef.current?.setIntegrator(name);
    const info = INTEGRATOR_INFO.find((i) => i.name === name);
    setAnnounce(`Integrator changed to ${info?.label ?? name}.`);
  };

  const handleSpeed = (value: number) => {
    setSpeed(value);
    clientRef.current?.setSpeed(value);
  };

  // Keyboard shortcuts, announced in the help panel so they are discoverable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never hijack typing.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === " " || event.key === "k") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "r") {
        handleReset();
      } else if (event.key === ".") {
        handleStep();
      } else if (event.key === "+" || event.key === "=") {
        sceneRef.current?.zoomCamera(0.85);
      } else if (event.key === "-") {
        sceneRef.current?.zoomCamera(1.18);
      } else if (event.key === "ArrowLeft") {
        sceneRef.current?.orbitCamera(-0.08, 0);
      } else if (event.key === "ArrowRight") {
        sceneRef.current?.orbitCamera(0.08, 0);
      } else if (event.key === "ArrowUp") {
        sceneRef.current?.orbitCamera(0, 0.08);
      } else if (event.key === "ArrowDown") {
        sceneRef.current?.orbitCamera(0, -0.08);
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [togglePlay, handleReset, handleStep]);

  // --- sharing and persistence ---------------------------------------------
  const handleShare = async () => {
    try {
      const url = await buildShareUrl(scenario, globalThis.location.href.split("#")[0]);
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setAnnounce("Share link copied to the clipboard.");
      } catch {
        // Clipboard can be blocked; the link is shown regardless.
        setAnnounce("Share link created.");
      }
    } catch (caught) {
      setError(
        caught instanceof ShareLinkError
          ? caught.message
          : "Could not create a share link.",
      );
    }
  };

  const handleExport = () => {
    const blob = exportScenarioFile(scenario);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${scenario.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setAnnounce("Scenario exported.");
  };

  const handleSave = async () => {
    if (!storageAvailable()) {
      setSaveState("Local storage is not available in this browser mode.");
      return;
    }
    try {
      await saveScenario(scenario);
      setSaveState("Saved to this browser.");
      setAnnounce("Scenario saved locally.");
    } catch (caught) {
      setSaveState(
        caught instanceof Error
          ? `Could not save: ${caught.message}`
          : "Could not save.",
      );
    }
  };

  // --- derived --------------------------------------------------------------
  const integratorInfo = useMemo(
    () => INTEGRATOR_INFO.find((i) => i.name === integrator),
    [integrator],
  );

  const positions = positionsRef.current;

  /** A warning shown when the current settings are likely to misbehave. */
  const timestepWarning = useMemo(() => {
    if (!hud) return null;
    if (hud.energyDrift > DRIFT_BAD) {
      return (
        `Energy has drifted by ${(hud.energyDrift * 100).toFixed(2)}%. ` +
        `This result is no longer trustworthy — reduce the timestep, or switch to PEFRL.`
      );
    }
    if (!integratorInfo?.symplectic && hud.stepCount > 200_000) {
      return (
        `${integratorInfo?.label ?? "This integrator"} is not symplectic, so its energy ` +
        `error grows steadily over long runs. Verlet or PEFRL will hold up better.`
      );
    }
    return null;
  }, [hud, integratorInfo]);

  const bodiesPanel = (
    <>
      <p className="source-note">
        A live, readable equivalent of the 3D view. Positions are in astronomical units.
      </p>
      <table className="diagnostics">
        <caption className="visually-hidden">
          Bodies in the simulation with their current positions
        </caption>
        <thead>
          <tr>
            <th scope="col">Body</th>
            <th scope="col">Mass (M☉)</th>
            <th scope="col">x</th>
            <th scope="col">y</th>
            <th scope="col">z</th>
          </tr>
        </thead>
        <tbody>
          {bodies.map((body, index) => (
            <tr key={body.id}>
              <th scope="row">
                {body.name}
                {body.massless ? " (test particle)" : ""}
              </th>
              <td className="value">{formatScientific(body.mass)}</td>
              <td className="value">
                {positions ? formatScientific(positions[index * 3]) : "—"}
              </td>
              <td className="value">
                {positions ? formatScientific(positions[index * 3 + 1]) : "—"}
              </td>
              <td className="value">
                {positions ? formatScientific(positions[index * 3 + 2]) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const diagnosticsPanel = (
    <>
      <p className="source-note">
        Conservation diagnostics. In an exact integration these would never change, so
        the drift is a direct measure of how much to trust what you are watching.
      </p>
      <table className="diagnostics">
        <tbody>
          <tr>
            <th scope="row">Simulated time</th>
            <td className="value">{hud ? formatDuration(hud.simTimeDays) : "—"}</td>
          </tr>
          <tr>
            <th scope="row">Steps taken</th>
            <td className="value">
              {hud ? hud.stepCount.toLocaleString("en-GB") : "—"}
            </td>
          </tr>
          <tr>
            <th scope="row">Timestep</th>
            <td className="value">{hud ? `${hud.dt} d` : "—"}</td>
          </tr>
          <tr>
            <th scope="row">Total energy</th>
            <td className="value">{hud ? formatScientific(hud.energy) : "—"}</td>
          </tr>
          <tr>
            <th scope="row">Energy drift</th>
            <td className={`value ${hud ? driftClass(hud.energyDrift) : ""}`}>
              {hud ? hud.energyDrift.toExponential(2) : "—"}
            </td>
          </tr>
          <tr>
            <th scope="row">Angular momentum drift</th>
            <td className={`value ${hud ? driftClass(hud.angularMomentumDrift) : ""}`}>
              {hud ? hud.angularMomentumDrift.toExponential(2) : "—"}
            </td>
          </tr>
          <tr>
            <th scope="row">Force method</th>
            <td className="value">{hud?.forceMode ?? "—"}</td>
          </tr>
          <tr>
            <th scope="row">Worker step time</th>
            <td className="value">{hud ? `${hud.workerStepMs.toFixed(1)} ms` : "—"}</td>
          </tr>
          <tr>
            <th scope="row">Render frame time</th>
            <td className="value">{frameMs > 0 ? `${frameMs.toFixed(1)} ms` : "—"}</td>
          </tr>
        </tbody>
      </table>
    </>
  );

  const sourcePanel = (
    <dl className="source-note">
      <dt>Provider</dt>
      <dd>{scenario.source.provider}</dd>
      <dt>Reference</dt>
      <dd>{scenario.source.reference}</dd>
      <dt>Retrieved</dt>
      <dd>{scenario.source.retrievedAt}</dd>
      {scenario.source.url && (
        <>
          <dt>Link</dt>
          <dd>
            <a href={scenario.source.url} rel="noopener noreferrer" target="_blank">
              {scenario.source.url}
            </a>
          </dd>
        </>
      )}
      {scenario.source.notes && (
        <>
          <dt>Notes on this model</dt>
          <dd>{scenario.source.notes}</dd>
        </>
      )}
    </dl>
  );

  const helpPanel = (
    <table className="diagnostics">
      <caption className="visually-hidden">Keyboard shortcuts</caption>
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Space or K</th>
          <td>Play or pause</td>
        </tr>
        <tr>
          <th scope="row">R</th>
          <td>Reset</td>
        </tr>
        <tr>
          <th scope="row">.</th>
          <td>Advance one step</td>
        </tr>
        <tr>
          <th scope="row">Arrow keys</th>
          <td>Orbit the camera</td>
        </tr>
        <tr>
          <th scope="row">+ and −</th>
          <td>Zoom in and out</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <div>
      <p>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← All scenarios
        </button>
      </p>

      <h1>{scenario.name}</h1>
      <p>{scenario.summary}</p>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}
      {timestepWarning && (
        <div className="notice notice--warn" role="status">
          {timestepWarning}
        </div>
      )}

      <div className="sim-layout">
        <section className="viewport" aria-label="Simulation view">
          {/*
            The canvas is announced as an image with a description. The
            authoritative, readable version of this data is the Bodies table in
            the panel alongside, which is referenced here so a screen-reader
            user is pointed at it rather than left with nothing.
          */}
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`3D view of ${scenario.name}, showing ${bodies.length} bodies. A readable table of the same data is available in the Bodies panel.`}
          />

          <div className="transport">
            <button
              type="button"
              className="btn btn--primary"
              onClick={togglePlay}
              aria-pressed={playing}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="btn" onClick={handleStep}>
              Step
            </button>
            <button type="button" className="btn" onClick={handleReset}>
              Reset
            </button>

            <div className="field" style={{ margin: 0 }}>
              <label htmlFor={speedId}>Speed</label>
              <select
                id={speedId}
                value={speed}
                onChange={(event) => handleSpeed(Number(event.target.value))}
              >
                {SPEEDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn"
              aria-pressed={showTrails}
              onClick={() => setShowTrails((v) => !v)}
            >
              Trails
            </button>
          </div>
        </section>

        <div>
          <section className="panel" aria-labelledby="integrator-heading">
            <h2 id="integrator-heading">Integrator</h2>
            <div className="field">
              <label htmlFor={integratorId}>Method</label>
              <select
                id={integratorId}
                value={integrator}
                onChange={(event) =>
                  handleIntegrator(event.target.value as IntegratorName)
                }
                aria-describedby="integrator-guidance"
              >
                {INTEGRATOR_INFO.map((info) => (
                  <option key={info.name} value={info.name}>
                    {info.label} — order {info.order}
                    {info.symplectic ? ", symplectic" : ""}
                  </option>
                ))}
              </select>
              <p className="field-hint" id="integrator-guidance">
                {integratorInfo?.guidance}
              </p>
            </div>
          </section>

          <section className="panel" aria-label="Simulation details">
            <Tabs
              label="Simulation details"
              activeId={activeTab}
              onChange={setActiveTab}
              tabs={[
                { id: "bodies", label: "Bodies", content: bodiesPanel },
                { id: "diagnostics", label: "Diagnostics", content: diagnosticsPanel },
                { id: "source", label: "Source", content: sourcePanel },
                { id: "keys", label: "Keys", content: helpPanel },
              ]}
            />
          </section>

          <section className="panel" aria-labelledby="actions-heading">
            <h2 id="actions-heading">Save and share</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button type="button" className="btn" onClick={handleSave}>
                Save locally
              </button>
              <button type="button" className="btn" onClick={handleExport}>
                Export JSON
              </button>
              <button type="button" className="btn" onClick={() => void handleShare()}>
                Share link
              </button>
            </div>
            {saveState && <p className="field-hint">{saveState}</p>}
            {shareUrl && (
              <div className="field" style={{ marginTop: "0.75rem" }}>
                <label htmlFor="share-url">Shareable link</label>
                <input id="share-url" type="text" readOnly value={shareUrl} />
                <p className="field-hint">
                  The scenario travels in the link’s fragment, so it is never sent to a
                  server.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <LiveRegion message={announcement} />
    </div>
  );
}
