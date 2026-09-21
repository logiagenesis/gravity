/**
 * Guided experiments.
 *
 * The brief asks for a learner-first product, and the difference between a
 * simulator and a teaching tool is whether it tells you what to try. Each of
 * these is one click, applies to a specific scenario, and comes with the
 * question it answers and the thing to watch — posed BEFORE it runs, so the
 * learner makes a prediction rather than reading a result.
 *
 * They are ordinary edits, so they go through the same validation and the same
 * undo stack as anything typed into the editor by hand. Nothing here is a
 * special path through the engine, which is why "undo" works on an experiment
 * without a line of code to make it.
 *
 * Every relative change (twice the mass, half the distance) is a `scale` edit
 * resolved in the worker against the state it is about to write, because the
 * simulation keeps running and a fraction of a position read a moment ago is a
 * fraction of somewhere the body no longer is.
 */
import type { ScenarioEdit } from "../sim/edits";

export interface Experiment {
  id: string;
  /** The scenario this makes sense on. */
  scenarioId: string;
  title: string;
  /** The question, posed before the edit runs. */
  question: string;
  /** What to watch, so the learner knows where to look. */
  watchFor: string;
  /** The physics. Available before as well as after, for anyone who wants it. */
  explanation: string;
  edits: ScenarioEdit[];
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: "remove-jupiter",
    scenarioId: "jupiter-trojan-points",
    title: "Remove Jupiter",
    question:
      "The Greeks and Trojans sit 60° ahead of and behind Jupiter. What holds them there — Jupiter, or the Sun?",
    watchFor:
      "The two asteroid groups. Do they stay in their triangles, or spread out along their orbit?",
    explanation:
      "They spread out. The L4 and L5 points exist only because of the combined pull of TWO massive bodies: the Sun holds the asteroids in orbit, but it is Jupiter that makes those particular points stable. Remove Jupiter and they become ordinary bodies on a 5.2 AU orbit, drifting apart because nothing keeps them bunched.",
    edits: [{ kind: "remove", id: "jupiter" }],
  },
  {
    id: "double-earth-mass",
    scenarioId: "earth-and-moon",
    title: "Double the Earth's mass",
    question:
      "If the Earth were twice as heavy, would the Moon orbit faster or slower — and would it stay the same distance away?",
    watchFor: "How long the Moon takes to go round, and how far out it gets.",
    explanation:
      "It speeds up and falls inward. At the instant the mass doubles the Moon's speed is unchanged, but the pull on it is twice as strong, so that speed is no longer enough to hold it at that distance: the orbit becomes an ellipse whose far point is where the Moon was when you pressed the button.",
    edits: [{ kind: "scale", id: "earth", mass: 2 }],
  },
  {
    id: "halve-the-sun",
    scenarioId: "inner-solar-system",
    title: "Halve the Sun's mass",
    question:
      "What happens to four planets if the Sun suddenly loses half its mass? Do they escape, or settle into wider orbits?",
    watchFor:
      "All four planets at once, and the Diagnostics tab: the total energy is what decides whether anything escapes.",
    explanation:
      "They swing out into much wider, very eccentric orbits, but stay bound — just barely. A circular orbit has exactly half the kinetic energy needed to escape, so halving the central mass halves the depth of the well and leaves each planet marginally bound, right at the boundary between an ellipse and a parabola. Take away slightly more than half and they are free.",
    edits: [{ kind: "scale", id: "sun", mass: 0.5 }],
  },
  {
    id: "nudge-the-figure-eight",
    scenarioId: "figure-eight-choreography",
    title: "Nudge it by one part in ten thousand",
    question:
      "The figure-eight is an exact solution. How exact does it have to be? This changes one body's speed by 0.01%.",
    watchFor:
      "The shape of the path. Count how many times round it goes before the pattern stops repeating.",
    explanation:
      "It holds for a while and then falls apart. The figure-eight is a genuine periodic solution of the three-body problem, but it is only marginally stable: a tiny error grows exponentially, so the trajectory stays close for a few periods and then diverges completely. That is Lyapunov instability, and it is the same reason the solar system's distant future cannot be predicted exactly — only the timescale differs.",
    edits: [{ kind: "scale", id: "body-a", speed: 1.0001 }],
  },
  {
    id: "rogue-star",
    scenarioId: "inner-solar-system",
    title: "Send a star through",
    question:
      "A half-solar-mass star crosses the inner solar system. Is one close pass enough to tear a planet loose?",
    watchFor:
      "Mars and the Earth as the intruder crosses, and the energy reading in Diagnostics.",
    explanation:
      "It depends entirely on how close it comes and how slowly it moves. A star passing at several AU reshapes the planets' orbits without unbinding them, because it is gone before it can do much work; a slow, close pass can strip a planet away completely. This is why stellar encounters matter a great deal for planetary systems in dense clusters and hardly at all for ours, which lives somewhere sparse.",
    edits: [
      {
        kind: "add",
        body: {
          id: "rogue-star",
          name: "Rogue star",
          // Half a solar mass: a red dwarf, the commonest kind of star there is.
          mass: 0.5,
          radius: 0.0025,
          // In from 6 AU, aimed across the inner system at roughly the speed
          // of a nearby star's drift relative to the Sun.
          position: { x: -6, y: -3, z: 0 },
          velocity: { x: 0.011, y: 0.0055, z: 0 },
          colour: "#ff9a6b",
        },
      },
    ],
  },
  {
    id: "move-the-moon-closer",
    scenarioId: "earth-and-moon",
    title: "Move the Moon to half its distance",
    question:
      "Halve the Moon's distance from the Earth and leave its speed alone. Does it settle into a smaller circle?",
    watchFor: "Where the Moon goes next. Is the new path a circle, or something else?",
    explanation:
      "It does not settle — it falls into a narrow ellipse and swings straight back out to about where it started. A circular orbit at half the distance needs √2 times MORE speed, and the Moon still has its old speed, which at that distance is too slow. The point you move a body to becomes the far end of its new orbit, which is why halving a distance without touching the velocity never gives you a smaller circle.",
    edits: [{ kind: "scale", id: "moon", relativeTo: "earth", separation: 0.5 }],
  },
];

/** The experiments available for one scenario, in catalogue order. */
export function experimentsFor(scenarioId: string): Experiment[] {
  return EXPERIMENTS.filter((experiment) => experiment.scenarioId === scenarioId);
}
