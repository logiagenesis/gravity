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
import { COLLISION_MODE_INFO, type CollisionMode } from "../sim/collisions";
import { simulationWarnings } from "../sim/warnings";
import { DriftChart, type DriftSample } from "./components/DriftChart";
import { BodyEditor } from "./components/BodyEditor";
import {
  EMPTY_HISTORY,
  canRedo,
  canUndo,
  commitRedo,
  commitUndo,
  nextRedo,
  nextUndo,
  recordEdit,
  type EditHistory,
} from "./edit-history";
import type { ScenarioEdit } from "../sim/edits";
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

/** Rolling window of drift samples. Old samples fall off the front. */
const DRIFT_HISTORY_LENGTH = 180;

function appendSample(
  history: readonly DriftSample[],
  sample: DriftSample,
): DriftSample[] {
  const next = [...history, sample];
  return next.length > DRIFT_HISTORY_LENGTH
    ? next.slice(next.length - DRIFT_HISTORY_LENGTH)
    : next;
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
  /**
   * Rolling history of the conservation errors.
   *
   * Sampled at the HUD's rate, not per frame: the point is a trend over
   * minutes, and 60 Hz would fill the buffer in four seconds while making the
   * line noisier rather than more informative.
   */
  const [driftHistory, setDriftHistory] = useState<{
    energy: DriftSample[];
    angular: DriftSample[];
  }>({ energy: [], angular: [] });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [collisionMode, setCollisionMode] = useState<CollisionMode>(
    scenario.physics.collisionMode,
  );
  /*
   * Timestep and softening are held as TEXT while being typed.
   *
   * A number input bound to a number cannot hold "0.", "1e-" or an empty box,
   * so typing a value mid-way through either snaps back or pushes a nonsense
   * value into the engine on every keystroke. Text in, parsed out, and only a
   * finite positive value is ever sent.
   */
  const [timestepText, setTimestepText] = useState(String(scenario.physics.dt));
  const [softeningText, setSofteningText] = useState(
    String(scenario.physics.softening),
  );
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
  const [history, setHistory] = useState<EditHistory>(EMPTY_HISTORY);
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
  const collisionId = useId();
  const timestepId = useId();
  const softeningId = useId();

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
    let lastResets = 0;
    let lastStep = -1;
    const timer = setInterval(() => {
      const snapshot = latestRef.current;
      if (snapshot) {
        setHud(snapshot);
        // Only record when the simulation has actually advanced, so a paused
        // run does not scroll a flat line across the chart and push the
        // interesting history off the end.
        if (snapshot.stepCount !== lastStep) {
          const rebaselined = snapshot.baselineResets > lastResets;
          lastResets = snapshot.baselineResets;
          lastStep = snapshot.stepCount;
          setDriftHistory((history) => ({
            energy: appendSample(history.energy, {
              simDays: snapshot.simTimeDays,
              value: snapshot.energyDrift,
              rebaselined,
            }),
            angular: appendSample(history.angular, {
              simDays: snapshot.simTimeDays,
              value: snapshot.angularMomentumDrift,
              rebaselined,
            }),
          }));
        }
      }
      if (sceneRef.current) setFrameMs(sceneRef.current.frameMs);
    }, HUD_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // A reset or a new scenario starts a new history; keeping the old one would
  // draw a trend across two different runs.
  useEffect(() => {
    setDriftHistory({ energy: [], angular: [] });
  }, [scenario]);

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

  // A new scenario brings its own framing and its own contact mode with it.
  useEffect(() => {
    setFocusIndex(initialFocus);
  }, [initialFocus]);

  useEffect(() => {
    setCollisionMode(scenario.physics.collisionMode);
    setTimestepText(String(scenario.physics.dt));
    setSofteningText(String(scenario.physics.softening));
  }, [scenario]);

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
    // Reset restores the published scenario, so the recorded edits no longer
    // describe anything that happened and undoing them would corrupt it.
    setHistory(EMPTY_HISTORY);
    setAnnounce("Simulation reset to its starting conditions.");
  }, []);

  const handleStep = useCallback(() => {
    clientRef.current?.step(1);
    setPlaying(false);
    setAnnounce("Advanced one step.");
  }, []);

  const handleTimestep = (text: string) => {
    setTimestepText(text);
    const value = Number(text);
    if (Number.isFinite(value) && value > 0) clientRef.current?.setTimestep(value);
  };

  const handleSoftening = (text: string) => {
    setSofteningText(text);
    const value = Number(text);
    if (Number.isFinite(value) && value >= 0) clientRef.current?.setSoftening(value);
  };

  /**
   * Save the current view as a PNG, captioned with the scenario's name and
   * the source its numbers came from.
   *
   * The citation travels with the picture deliberately: an image of a
   * simulation shared without saying where its data came from is exactly the
   * kind of unsourced claim this project exists not to make.
   */
  const handleExportImage = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const citation = [scenario.source.provider, scenario.source.reference]
      .filter((part) => part.trim() !== "")
      .join(" — ");
    let url: string;
    try {
      url = scene.capturePng({ title: scenario.name, citation });
    } catch {
      setSaveState("The image could not be captured in this browser.");
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scenario.id}.png`;
    link.click();
    setSaveState("Image saved.");
    setAnnounce("Image saved.");
  };

  /**
   * Apply an edit and record it for undo.
   *
   * The history moves only AFTER the worker confirms. The worker validates
   * before it writes, so a rejected edit leaves the simulation untouched — and
   * a history that had already moved would then offer an undo for something
   * that never happened.
   */
  const handleEdit = useCallback(async (edit: ScenarioEdit) => {
    const client = clientRef.current;
    if (!client) throw new Error("The simulation is not running.");
    const result = await client.applyEdit(edit);
    setHistory((current) => recordEdit(current, result));
    setAnnounce(
      edit.kind === "remove"
        ? "Body removed."
        : edit.kind === "update"
          ? "Body updated."
          : "Body added.",
    );
  }, []);

  const handleUndo = useCallback(() => {
    const client = clientRef.current;
    const edit = nextUndo(history);
    if (!client || edit === null) return;
    void client.applyEdit(edit).then(
      () => {
        setHistory(commitUndo);
        setAnnounce("Edit undone.");
      },
      (caught: unknown) => {
        // An undo that cannot be applied is a bug, not a user error, so it
        // says so rather than silently leaving the buttons out of step.
        setError(
          `Undo failed: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      },
    );
  }, [history]);

  const handleRedo = useCallback(() => {
    const client = clientRef.current;
    const edit = nextRedo(history);
    if (!client || edit === null) return;
    void client.applyEdit(edit).then(
      () => {
        setHistory(commitRedo);
        setAnnounce("Edit redone.");
      },
      (caught: unknown) => {
        setError(
          `Redo failed: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      },
    );
  }, [history]);

  const loadBodyDetail = useCallback(
    (id: string) => clientRef.current?.requestBodyDetail(id) ?? Promise.resolve(null),
    [],
  );

  const handleCollisionMode = (mode: CollisionMode) => {
    setCollisionMode(mode);
    clientRef.current?.setCollisionMode(mode);
    const info = COLLISION_MODE_INFO.find((i) => i.mode === mode);
    setAnnounce(`On contact: ${info?.label ?? mode}.`);
  };

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
  /*
   * Warnings about the run's own trustworthiness.
   *
   * Derived from the HUD snapshot rather than held in state, so they cannot
   * go stale, and recomputed at the HUD's rate (a few times a second) rather
   * than per frame.
   */
  const warnings = useMemo(
    () =>
      hud === null
        ? []
        : simulationWarnings({
            integrator: hud.integrator,
            dt: hud.dt,
            shortestPeriodDays: hud.shortestPeriodDays,
            softening: hud.softening,
            closestApproachAu: hud.closestApproachAu,
            theta: hud.theta,
            peakSubsteps: hud.peakSubsteps,
            stepCount: hud.stepCount,
            energyDrift: hud.energyDrift,
          }),
    [hud],
  );

  const collisionInfo = useMemo(
    () => COLLISION_MODE_INFO.find((i) => i.mode === collisionMode),
    [collisionMode],
  );
  const positions = positionsRef.current;

  /*
   * Show the z column only when something is actually out of the plane.
   *
   * The panel is 392px wide at every viewport, and five numeric columns do not
   * fit: z was clipped at the right edge. Most catalogue scenarios are
   * coplanar by construction, so that clipped column was a column of zeros —
   * it cost the information in x and y to show nothing. The real ephemerides
   * from Horizons are not coplanar, and there it appears.
   */
  const hasOutOfPlane =
    positions !== null && bodies.some((_, index) => positions[index * 3 + 2] !== 0);

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
        {hasOutOfPlane ? "" : " Every body is in the z = 0 plane."}
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
            {hasOutOfPlane && <th scope="col">z</th>}
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
              {hasOutOfPlane && (
                <td className="value">
                  {positions ? formatScientific(positions[index * 3 + 2]) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  const diagnosticsPanel = (
    <>
      <div className="drift-charts">
        <DriftChart
          samples={driftHistory.energy}
          label="Energy error"
          summary={
            `Relative energy error over time, on a logarithmic scale from 1e-16 to 1. ` +
            `Currently ${hud ? hud.energyDrift.toExponential(1) : "unknown"}.`
          }
        />
        <DriftChart
          samples={driftHistory.angular}
          label="Angular momentum error"
          summary={
            `Relative angular momentum error over time, on a logarithmic scale from ` +
            `1e-16 to 1. Currently ` +
            `${hud ? hud.angularMomentumDrift.toExponential(1) : "unknown"}.`
          }
        />
      </div>
      {warnings.length > 0 && (
        <ul className="warnings" aria-label="Warnings about this simulation">
          {warnings.map((warning) => (
            <li key={warning.id} className={`warning warning--${warning.severity}`}>
              <strong>{warning.title}</strong>
              <span>{warning.detail}</span>
            </li>
          ))}
        </ul>
      )}
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
          {/* Shown only once it is doing something, so it reads as "an
              encounter is happening" rather than as permanent clutter. */}
          {hud !== null && hud.peakSubsteps > 1 && (
            <tr>
              <th scope="row">Substeps (now / peak)</th>
              <td className="value">
                {hud.lastSubsteps} / {hud.peakSubsteps}
              </td>
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
        <label htmlFor={collisionId}>On contact</label>
        <div className="select">
          <select
            id={collisionId}
            value={collisionMode}
            onChange={(event) =>
              handleCollisionMode(event.target.value as CollisionMode)
            }
            aria-describedby="collision-guidance"
          >
            {COLLISION_MODE_INFO.map((info) => (
              <option key={info.mode} value={info.mode}>
                {info.label}
              </option>
            ))}
          </select>
        </div>
        {/* Each mode obeys a different conservation law, and the reader is
            told which BEFORE they wonder why the energy readout jumped. */}
        <p className="field-hint" id="collision-guidance">
          {collisionInfo?.conserves}
        </p>
      </div>

      <div className="field">
        <label htmlFor={timestepId}>Timestep (days)</label>
        <input
          id={timestepId}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={timestepText}
          onChange={(event) => handleTimestep(event.target.value)}
          aria-describedby="timestep-hint"
        />
        <p className="field-hint" id="timestep-hint">
          {hud !== null && hud.shortestPeriodDays !== null && hud.dt > 0
            ? `${(hud.shortestPeriodDays / hud.dt).toFixed(0)} steps per orbit of the ` +
              `fastest body. Below about 20, the shape of the orbit is not resolved.`
            : "Smaller is more accurate and slower."}
        </p>
      </div>

      <div className="field">
        <label htmlFor={softeningId}>Softening (AU)</label>
        <input
          id={softeningId}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={softeningText}
          onChange={(event) => handleSoftening(event.target.value)}
          aria-describedby="softening-hint"
        />
        <p className="field-hint" id="softening-hint">
          Replaces the force at short range with a weaker, finite one, so two bodies
          passing very close cannot produce an infinite acceleration. Zero is exact
          Newtonian gravity.
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

  const editorPanel = (
    <>
      <p className="source-note">
        Change the system and watch what happens. Edits apply to the running simulation
        rather than restarting it, so you can remove a planet mid-orbit and see the rest
        respond. Reset restores the published scenario.
      </p>
      <BodyEditor
        bodies={bodies}
        loadDetail={loadBodyDetail}
        applyEdit={handleEdit}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        editCount={hud?.editCount ?? 0}
      />
    </>
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
        <button type="button" className="btn" onClick={handleExportImage}>
          Save image
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
              { id: "edit", label: "Edit", content: editorPanel },
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
