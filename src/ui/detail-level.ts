/**
 * How much of the simulator to show.
 *
 * One setting, three levels, and it genuinely changes what is on screen —
 * a label that only relabelled things would be worse than nothing.
 *
 * WHAT IS NEVER HIDDEN. The warnings about a run's trustworthiness, the
 * citation for its data, and the bodies themselves appear at every level. A
 * beginner is not someone who should be told less about whether the numbers
 * can be believed; they are someone with fewer dials. Hiding a warning to
 * keep a screen tidy would make the simulator lie by omission to exactly the
 * person least able to notice.
 *
 * WHAT IS HIDDEN, and why that is the right cut. The levels do not hide
 * FEATURES, they hide NUMERICAL METHOD. "Timestep" and "Softening" are not
 * advanced versions of something simpler — they are the controls that let you
 * silently ruin a simulation, and they mean nothing until you know what a
 * timestep is. Everything a learner acts with (play, experiments, editing,
 * the camera, saving and sharing) is present at every level.
 */
/** Exported so tests can set the level without clicking through the UI. */
export const DETAIL_LEVEL_STORAGE_KEY = "gravity-simulator:detail-level";

export const DETAIL_LEVELS = ["beginner", "educational", "advanced"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Learner-first, but not so bare that the conservation diagnostics vanish. */
export const DEFAULT_DETAIL_LEVEL: DetailLevel = "educational";

export interface DetailLevelInfo {
  level: DetailLevel;
  label: string;
  description: string;
}

export const DETAIL_LEVEL_INFO: DetailLevelInfo[] = [
  {
    level: "beginner",
    label: "Explore",
    description: "Run it, change it, and watch. No numerical settings to get wrong.",
  },
  {
    level: "educational",
    label: "Learn",
    description:
      "Adds the conservation diagnostics, the choice of integrator and what happens on contact.",
  },
  {
    level: "advanced",
    label: "Full control",
    description:
      "Adds the timestep, softening length, force method and the performance readouts.",
  },
];

/**
 * A thing the interface can show.
 *
 * `diagnostics` — the energy and angular-momentum drift, and their charts.
 * `method` — integrator, timestep, contact behaviour, reference frame.
 * `numerics` — softening, force method, timings, substep counts.
 *
 * The TIMESTEP sits with the method, not with the numerics, and that is a
 * judgement rather than an accident. It is the single most teachable number
 * here — the field says how many steps per orbit the current value gives, and
 * a classroom watching an orbit fall apart at fifteen has learned the lesson
 * the warning system exists to give. Softening, opening angle and frame
 * timings are implementation, and belong a level up.
 */
export type DetailFeature = "diagnostics" | "method" | "numerics";

const REQUIRED: Record<DetailFeature, DetailLevel> = {
  diagnostics: "educational",
  method: "educational",
  numerics: "advanced",
};

/** True when `level` is at least as detailed as `feature` requires. */
export function shows(level: DetailLevel, feature: DetailFeature): boolean {
  return DETAIL_LEVELS.indexOf(level) >= DETAIL_LEVELS.indexOf(REQUIRED[feature]);
}

function isDetailLevel(value: unknown): value is DetailLevel {
  return DETAIL_LEVELS.includes(value as DetailLevel);
}

/**
 * The stored level, or the default.
 *
 * Every access is guarded. `localStorage` is not merely empty in a private
 * window or with site data blocked — reading the property can throw — and a
 * setting is never worth a blank page.
 */
export function readDetailLevel(): DetailLevel {
  try {
    const stored = localStorage.getItem(DETAIL_LEVEL_STORAGE_KEY);
    return isDetailLevel(stored) ? stored : DEFAULT_DETAIL_LEVEL;
  } catch {
    return DEFAULT_DETAIL_LEVEL;
  }
}

/** Persist the level. Silently does nothing where storage is unavailable. */
export function writeDetailLevel(level: DetailLevel): void {
  try {
    localStorage.setItem(DETAIL_LEVEL_STORAGE_KEY, level);
  } catch {
    // A preference that cannot be remembered still has to work for this visit.
  }
}
