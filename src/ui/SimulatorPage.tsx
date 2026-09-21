/**
 * Simulator.
 *
 * THE CANVAS IS THE PRODUCT. The previous version put a small viewport inside a
 * scrolling document, which read as a prototype. Here the canvas fills the
 * viewport and every control is an overlay that can be collapsed out of the way.
 *
 * Two architectural rules remain load-bearing:
 *
 *  1. PER-FRAME BODY STATE NEVER ENTERS REACT. Snapshots go straight from the
 *     worker to the renderer via a ref. React state updates only for the
 *     throttled HUD, a few times a second.
 *  2. THE CANVAS IS NOT THE ONLY OUTPUT. A live table of bodies, the
 *     diagnostics and the play state are real semantic HTML, so the information
 *     is available without seeing the render.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { GravityScene, type ScaleMode } from "../render/scene";
import { describeFrame, type FrameKind, type FrameSpec } from "../render/frames";
import { CameraControls } from "../render/controls";
import { SimulationClient } from "../worker/client";
import type { BodyMeta, SnapshotMessage } from "../worker/protocol";
import { INTEGRATOR_INFO, type IntegratorName } from "../sim/integrators";
import { DAYS_PER_JULIAN_YEAR } from "../sim/constants";
import type { Scenario } from "../schema/scenario";
import { Tabs } from "./components/Tabs";
import { LiveRegion } from "./components/LiveRegion";
import { Dialog } from "./components/Dialog";
import { saveScenario, storageAvailable } from "../storage/saved-scenarios";
import { buildShareUrl, exportScenarioFile, ShareLinkError } from "../share/link";

/** HUD refresh rate. Deliberately slow: it is for reading, not animation. */
const HUD_INTERVAL_MS = 250;

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
  if (abs < 1) return `${(days * 24).toFixed(2)} h`;
  if (abs < DAYS_PER_JULIAN_YEAR) return `${days.toFixed(1)} d`;
  return `${(days / DAYS_PER_JULIAN_YEAR).toFixed(2)} yr`;
}

function driftClass(drift: number): string {
  if (drift > DRIFT_BAD) return "drift-bad";
  if (drift > DRIFT_WARN) return "drift-warn";
  return "drift-good";
}

/**
 * Compact fixed-width-ish number for the body table.
 *
 * Four significant figures. The table has five columns in a panel that is
 * about 390px wide on a phone, and at five decimal places the last column was
 * being clipped in the M4 screenshot. Four figures is more than the eye can
 * use from a live readout and is honest about the precision anyone can
 * actually read off a running simulation.
 */
function formatScientific(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return Math.abs(value) < 1e-3 || Math.abs(value) >= 1e5
    ? value.toExponential(2)
    : value.toFixed(4);
}

interface SimulatorPageProps {
  scenario: Scenario;
  onBack: () => void;
}

export function SimulatorPage({ scenario, onBack }: SimulatorPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GravityScene | null>(null);
  const controlsRef = useRef<CameraControls | null>(null);
  const clientRef = useRef<SimulationClient | null>(null);
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
  const [panelOpen, setPanelOpen] = useState(
    // Closed by default on a phone: the first thing a visitor should see is the
    // simulation, not a table of numbers covering half the screen.
    () =>
      !(typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("bodies");
  const [frameMs, setFrameMs] = useState(0);
  const [frameKind, setFrameKind] = useState<FrameKind>("inertial");
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [secondaryIndex, setSecondaryIndex] = useState(1);
  /*
   * The scenario's own camera target, resolved to a body index.
   *
   * `camera.target` has been in the schema (and validated against the body
   * ids) since the beginning, but nothing ever read it: the camera always
   * framed the origin. That was invisible while every scenario was centred on
   * its own primary, and obvious the moment the Horizons scenarios arrived —
   * "Webb at L2" opened looking at the Sun from 0.05 AU away.
   */
  const initialFocus = useMemo(() => {
    const target = scenario.camera?.target;
    if (target === undefined) return null;
    const index = scenario.bodies.findIndex((body) => body.id === target);
    return index >= 0 ? index : null;
  }, [scenario]);

  const [focusIndex, setFocusIndex] = useState<number | null>(initialFocus);
  const [showLabels, setShowLabels] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showBarycentre, setShowBarycentre] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("legible");

  const speedId = useId();
  const integratorId = useId();
  const panelId = useId();
  const frameId = useId();
  const scaleId = useId();

  // --- worker + renderer lifecycle ------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const labelContainer = labelsRef.current;
    if (!labelContainer) return;

    const scene = new GravityScene({
      canvas,
      labelContainer,
      reducedMotion: prefersReducedMotion(),
    });
    scene.setCameraDistance(scenario.camera?.distance ?? 5);
    scene.start();
    sceneRef.current = scene;

    const controls = new CameraControls(canvas, scene);
    controlsRef.current = controls;

    const client = new SimulationClient({
      onSnapshot: (snapshot) => {
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
    // The canvas is sized by CSS, so observe the element rather than the window.
    const observer = new ResizeObserver(() => scene.resize());
    observer.observe(canvas);

    return () => {
      globalThis.removeEventListener("resize", onResize);
      observer.disconnect();
      controls.dispose();
      client.dispose();
      scene.dispose();
      controlsRef.current = null;
      clientRef.current = null;
      sceneRef.current = null;
    };
  }, [scenario]);

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

  useEffect(() => {
    sceneRef.current?.setLabelsEnabled(showLabels);
  }, [showLabels]);

  useEffect(() => {
    sceneRef.current?.setGridVisible(showGrid);
  }, [showGrid]);

  useEffect(() => {
    sceneRef.current?.setBarycentreVisible(showBarycentre);
  }, [showBarycentre]);

  useEffect(() => {
    sceneRef.current?.setScaleMode(scaleMode);
  }, [scaleMode]);

  useEffect(() => {
    sceneRef.current?.setFocus(focusIndex);
  }, [focusIndex]);

  // A new scenario brings its own framing with it.
  useEffect(() => {
    setFocusIndex(initialFocus);
  }, [initialFocus]);

  useEffect(() => {
    const spec: FrameSpec = { kind: frameKind, primaryIndex, secondaryIndex };
    sceneRef.current?.setFrame(spec);
  }, [frameKind, primaryIndex, secondaryIndex]);

  // Resize when the panel opens or closes: the canvas box changes.
  useEffect(() => {
    const id = setTimeout(() => sceneRef.current?.resize(), 60);
    return () => clearTimeout(id);
  }, [panelOpen]);

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
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
      } else if (event.key === "?") {
        setHelpOpen(true);
      } else if (event.key === "f") {
        sceneRef.current?.fitAll();
        setAnnounce("View fitted to all bodies.");
      } else if (event.key === "l") {
        setShowLabels((v) => !v);
      } else if (event.key === "c") {
        sceneRef.current?.recentreCamera();
        setFocusIndex(null);
        setAnnounce("Camera recentred.");
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
      setPanelOpen(true);
      setActiveTab("share");
      try {
        await navigator.clipboard.writeText(url);
        setAnnounce("Share link copied to the clipboard.");
      } catch {
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

  // --- panel content --------------------------------------------------------
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
            <tr key={body.id} data-focused={focusIndex === index ? "true" : undefined}>
              <th scope="row">
                <button
                  type="button"
                  className="body-focus"
                  aria-pressed={focusIndex === index}
                  onClick={() => {
                    const next = focusIndex === index ? null : index;
                    setFocusIndex(next);
                    setAnnounce(
                      next === null
                        ? "Camera no longer following a body."
                        : `Camera following ${body.name}.`,
                    );
                  }}
                >
                  {body.name}
                  {body.massless ? " (test particle)" : ""}
                </button>
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
        In an exact integration these would never change, so the drift is a direct
        measure of how much to trust what you are watching.
      </p>
      {hud !== null && hud.baselineResets > 0 && (
        <p className="source-note">
          The baseline has been reset {hud.baselineResets}{" "}
          {hud.baselineResets === 1 ? "time" : "times"} because bodies merged. A merge
          is perfectly inelastic, so it changes the total energy for real — the drift
          below is measured since the most recent merge, not since the start.
        </p>
      )}
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
          {hud !== null && hud.baselineResets > 0 && (
            <tr>
              <th scope="row">Baseline resets</th>
              <td className="value">{hud.baselineResets}</td>
            </tr>
          )}
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

  const bodyOptions = bodies.map((body, index) => (
    <option key={body.id} value={index}>
      {body.name}
    </option>
  ));

  const settingsPanel = (
    <>
      <div className="field">
        <label htmlFor={integratorId}>Integrator</label>
        <div className="select">
          <select
            id={integratorId}
            value={integrator}
            onChange={(event) => handleIntegrator(event.target.value as IntegratorName)}
            aria-describedby="integrator-guidance"
          >
            {INTEGRATOR_INFO.map((info) => (
              <option key={info.name} value={info.name}>
                {info.label} — order {info.order}
                {info.symplectic ? ", symplectic" : ""}
              </option>
            ))}
          </select>
        </div>
        <p className="field-hint" id="integrator-guidance">
          {integratorInfo?.guidance}
        </p>
      </div>

      <div className="field">
        <label htmlFor={frameId}>Reference frame</label>
        <div className="select">
          <select
            id={frameId}
            value={frameKind}
            onChange={(event) => {
              const kind = event.target.value as FrameKind;
              setFrameKind(kind);
              setAnnounce(
                `Reference frame: ${describeFrame(
                  { kind, primaryIndex, secondaryIndex },
                  bodies.map((b) => b.name),
                )}.`,
              );
            }}
            aria-describedby="frame-hint"
          >
            <option value="inertial">Inertial</option>
            <option value="barycentric">Barycentric</option>
            <option value="body">Centred on a body</option>
            <option value="rotating">Rotating with a pair</option>
          </select>
        </div>
        <p className="field-hint" id="frame-hint">
          {frameKind === "rotating"
            ? "The line joining the pair is held fixed. This is what makes Lagrange points and Trojan clouds stand still instead of blurring."
            : frameKind === "barycentric"
              ? "Origin at the system centre of mass."
              : frameKind === "body"
                ? "Origin at the chosen body."
                : "Raw simulation coordinates."}
        </p>
      </div>

      {(frameKind === "body" || frameKind === "rotating") && (
        <div className="field">
          <label htmlFor={`${frameId}-primary`}>
            {frameKind === "rotating" ? "Primary" : "Centre on"}
          </label>
          <div className="select">
            <select
              id={`${frameId}-primary`}
              value={primaryIndex}
              onChange={(event) => setPrimaryIndex(Number(event.target.value))}
            >
              {bodyOptions}
            </select>
          </div>
        </div>
      )}

      {frameKind === "rotating" && (
        <div className="field">
          <label htmlFor={`${frameId}-secondary`}>Secondary</label>
          <div className="select">
            <select
              id={`${frameId}-secondary`}
              value={secondaryIndex}
              onChange={(event) => setSecondaryIndex(Number(event.target.value))}
            >
              {bodyOptions}
            </select>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor={scaleId}>Body size</label>
        <div className="select">
          <select
            id={scaleId}
            value={scaleMode}
            onChange={(event) => setScaleMode(event.target.value as ScaleMode)}
            aria-describedby="scale-hint"
          >
            <option value="legible">Legible (enlarged to stay visible)</option>
            <option value="true">True scale</option>
          </select>
        </div>
        <p className="field-hint" id="scale-hint">
          {scaleMode === "legible"
            ? "Bodies below a few pixels are drawn larger so they stay visible. Display only — the physics uses the true radius."
            : "True physical radii. At solar-system scale most bodies become smaller than one pixel."}
        </p>
      </div>

      <div className="field">
        <span className="field-label">Show</span>
        <div className="toggle-row">
          <button
            type="button"
            className="btn"
            aria-pressed={showTrails}
            onClick={() => setShowTrails((v) => !v)}
          >
            Trails
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={showLabels}
            onClick={() => setShowLabels((v) => !v)}
          >
            Labels
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={showBarycentre}
            onClick={() => setShowBarycentre((v) => !v)}
          >
            Barycentre
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={showGrid}
            onClick={() => setShowGrid((v) => !v)}
          >
            Grid
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Camera</span>
        <div className="toggle-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              sceneRef.current?.fitAll();
              setAnnounce("View fitted to all bodies.");
            }}
          >
            Fit all
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              sceneRef.current?.recentreCamera();
              setFocusIndex(null);
              setAnnounce("Camera recentred.");
            }}
          >
            Recentre
          </button>
        </div>
        <p className="field-hint">
          {focusIndex !== null && bodies[focusIndex]
            ? `Following ${bodies[focusIndex].name}. Select it again in the Bodies tab to stop.`
            : "Select a body in the Bodies tab to follow it."}
        </p>
      </div>
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

  const sharePanel = (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
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
        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <label htmlFor="share-url">Shareable link</label>
          <input id="share-url" type="text" readOnly value={shareUrl} />
          <p className="field-hint">
            The scenario travels in the link’s fragment, so it is never sent to a
            server.
          </p>
        </div>
      )}
    </>
  );

  return (
    <div className="sim" data-panel={panelOpen ? "open" : "closed"}>
      <canvas
        ref={canvasRef}
        className="sim__canvas"
        role="img"
        aria-label={`3D view of ${scenario.name}, showing ${bodies.length} bodies. A readable table of the same data is in the Bodies panel.`}
      />

      <div className="sim__labels" ref={labelsRef} />

      <div className="sim__head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Scenarios
        </button>
        <div className="sim__title">
          <h1>{scenario.name}</h1>
          <p>{scenario.summary}</p>
        </div>
        <div className="sim__tools" role="group" aria-label="View controls">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setHelpOpen(true)}
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            aria-label={panelOpen ? "Hide details panel" : "Show details panel"}
          >
            {panelOpen ? "▸" : "◂"}
          </button>
        </div>
      </div>

      <div className="sim__warnings">
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
      </div>

      <div className="sim__transport" role="group" aria-label="Playback controls">
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

        <div className="select">
          <label htmlFor={speedId} className="visually-hidden">
            Speed
          </label>
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

        <span className="sim__clock" aria-live="off">
          {hud ? formatDuration(hud.simTimeDays) : "—"}
        </span>
      </div>

      <aside
        className="sim__panel"
        id={panelId}
        hidden={!panelOpen}
        aria-label="Simulation details"
      >
        <div className="sim__panel-head">
          <span className="field-label">Details</span>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => setPanelOpen(false)}
            aria-label="Hide details panel"
          >
            ✕
          </button>
        </div>
        <div className="sim__panel-body">
          <Tabs
            label="Simulation details"
            activeId={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: "bodies", label: "Bodies", content: bodiesPanel },
              { id: "diagnostics", label: "Diagnostics", content: diagnosticsPanel },
              { id: "settings", label: "View", content: settingsPanel },
              { id: "source", label: "Source", content: sourcePanel },
              { id: "share", label: "Share", content: sharePanel },
            ]}
          />
        </div>
      </aside>

      <Dialog
        open={helpOpen}
        title="Keyboard and pointer"
        onClose={() => setHelpOpen(false)}
      >
        <table className="diagnostics">
          <tbody>
            <tr>
              <th scope="row">
                <kbd>Space</kbd> / <kbd>K</kbd>
              </th>
              <td>Play or pause</td>
            </tr>
            <tr>
              <th scope="row">
                <kbd>R</kbd>
              </th>
              <td>Reset to starting conditions</td>
            </tr>
            <tr>
              <th scope="row">
                <kbd>.</kbd>
              </th>
              <td>Advance one step</td>
            </tr>
            <tr>
              <th scope="row">
                <kbd>C</kbd>
              </th>
              <td>Recentre the camera</td>
            </tr>
            <tr>
              <th scope="row">Arrow keys</th>
              <td>Orbit the camera</td>
            </tr>
            <tr>
              <th scope="row">
                <kbd>+</kbd> / <kbd>−</kbd>
              </th>
              <td>Zoom in and out</td>
            </tr>
            <tr>
              <th scope="row">
                <kbd>?</kbd>
              </th>
              <td>Open this dialog</td>
            </tr>
            <tr>
              <th scope="row">Drag</th>
              <td>Orbit · one finger on touch</td>
            </tr>
            <tr>
              <th scope="row">Shift + drag</th>
              <td>Pan · two fingers on touch</td>
            </tr>
            <tr>
              <th scope="row">Wheel / pinch</th>
              <td>Zoom</td>
            </tr>
          </tbody>
        </table>
      </Dialog>

      <LiveRegion message={announcement} />
    </div>
  );
}
