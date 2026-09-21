/**
 * Build your own system.
 *
 * Deliberately NOT a blank canvas. The schema requires two bodies because
 * gravity requires two bodies, and a form that starts with nothing would ask
 * a learner to type six numbers before anything moves. Each template is a
 * working system that already does something the moment it opens, and the
 * body editor takes it from there.
 *
 * A built scenario is SAVED before it opens, where the browser allows it, so
 * that a reload does not throw the work away and so it turns up under "Saved"
 * where somebody would go looking for it.
 */
import { useState } from "react";
import type { Scenario } from "../schema/scenario";
import { CURRENT_SCHEMA_VERSION } from "../schema/scenario";
import { parseScenario } from "../schema/scenario";
import { G_AU3_PER_MSUN_DAY2 } from "../sim/constants";
import { saveScenario, storageAvailable } from "../storage/saved-scenarios";

interface BuildPageProps {
  /** Open a scenario that has been saved, by its stored id. */
  onOpenSaved: (id: string) => void;
  /** Open a scenario that could not be saved, holding it in memory. */
  onOpenScratch: (scenario: Scenario) => void;
}

interface Template {
  id: string;
  title: string;
  description: string;
  build: () => Scenario;
}

/** Circular speed for a body at `radius` about a primary of `mass`. */
function circularSpeed(mass: number, radius: number): number {
  return Math.sqrt((G_AU3_PER_MSUN_DAY2 * mass) / radius);
}

/** A unique id that is stable within a session and readable in a URL. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The parts every template shares.
 *
 * The source block is filled in honestly: these numbers are not measured, they
 * are constructed, and the citation says so. A made-up system that claimed a
 * provider would be exactly the kind of unsourced claim the rest of this
 * project goes to some trouble to avoid.
 */
function base(name: string, summary: string) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId("built"),
    name,
    summary,
    category: "what-if",
    tags: ["built-here"],
    difficulty: "beginner" as const,
    featured: false,
    source: {
      provider: "Constructed",
      reference: "Built in the simulator",
      retrievedAt: today(),
      notes:
        "Not a real system. The masses and distances were chosen to be easy to " +
        "reason about, not to match anything observed.",
    },
  };
}

const TEMPLATES: Template[] = [
  {
    id: "star-and-planet",
    title: "A star and a planet",
    description:
      "One solar mass at the centre, an Earth-sized planet on a circular orbit at 1 AU. The usual starting point: add more planets and watch them perturb each other.",
    build: () =>
      parseScenario({
        ...base(
          "A star and a planet",
          "One star and one planet on a circular orbit at 1 AU, built as a starting point.",
        ),
        physics: {
          softening: 0,
          integrator: "verlet",
          dt: 0.5,
          forceMode: "auto",
          theta: 0.5,
          collisionMode: "merge",
        },
        camera: { target: "star" },
        bodies: [
          {
            id: "star",
            name: "Star",
            mass: 1,
            radius: 0.00465,
            position: { x: 0, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            colour: "#ffd27f",
          },
          {
            id: "planet",
            name: "Planet",
            mass: 3.003e-6,
            radius: 4.26e-5,
            position: { x: 1, y: 0, z: 0 },
            velocity: { x: 0, y: circularSpeed(1 + 3.003e-6, 1), z: 0 },
            colour: "#6b93d6",
          },
        ],
      }),
  },
  {
    id: "binary-pair",
    title: "A pair of stars",
    description:
      "Two half-solar-mass stars circling their common centre 1 AU apart. Nothing is at rest and nothing is at the origin, which is what a real binary looks like.",
    build: () => {
      // Each star orbits the barycentre at half the separation, at half the
      // relative speed, so the pair has no net momentum and stays centred.
      const separation = 1;
      const relative = circularSpeed(1, separation);
      return parseScenario({
        ...base(
          "A pair of stars",
          "Two half-solar-mass stars circling their common centre of mass, 1 AU apart.",
        ),
        physics: {
          softening: 0,
          integrator: "verlet",
          dt: 0.5,
          forceMode: "auto",
          theta: 0.5,
          collisionMode: "merge",
        },
        bodies: [
          {
            id: "star-a",
            name: "Star A",
            mass: 0.5,
            radius: 0.0035,
            position: { x: -separation / 2, y: 0, z: 0 },
            velocity: { x: 0, y: -relative / 2, z: 0 },
            colour: "#ffd27f",
          },
          {
            id: "star-b",
            name: "Star B",
            mass: 0.5,
            radius: 0.0035,
            position: { x: separation / 2, y: 0, z: 0 },
            velocity: { x: 0, y: relative / 2, z: 0 },
            colour: "#ffb56b",
          },
        ],
      });
    },
  },
  {
    id: "dropped-from-rest",
    title: "Two bodies, dropped from rest",
    description:
      "Half a solar mass each, 2 AU apart, no motion at all. They fall straight together and merge after about six months. The simplest thing gravity does.",
    build: () =>
      parseScenario({
        ...base(
          "Two bodies, dropped from rest",
          "Two half-solar-mass bodies released 2 AU apart with no motion, falling straight together.",
        ),
        physics: {
          softening: 0,
          integrator: "verlet",
          // They accelerate hard at the end, which is what the adaptive
          // sub-stepping is for; the outer step stays comfortable.
          dt: 0.5,
          forceMode: "auto",
          theta: 0.5,
          collisionMode: "merge",
        },
        bodies: [
          {
            id: "left",
            name: "Left",
            mass: 0.5,
            radius: 0.0035,
            position: { x: -1, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            colour: "#ffd27f",
          },
          {
            id: "right",
            name: "Right",
            mass: 0.5,
            radius: 0.0035,
            position: { x: 1, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            colour: "#9fd0ff",
          },
        ],
      }),
  },
];

export function BuildPage({ onOpenSaved, onOpenScratch }: BuildPageProps) {
  const [error, setError] = useState<string | null>(null);

  const start = async (template: Template) => {
    setError(null);
    let scenario: Scenario;
    try {
      scenario = template.build();
    } catch (caught) {
      // A template that does not validate is a bug here, not a user error.
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }

    if (!storageAvailable()) {
      onOpenScratch(scenario);
      return;
    }
    try {
      await saveScenario(scenario);
      onOpenSaved(scenario.id);
    } catch {
      // Storage exists but refused. Open it anyway rather than losing it, and
      // let the person export a file from the Share tab if they want to keep it.
      onOpenScratch(scenario);
    }
  };

  return (
    <div>
      <h1>Build your own</h1>
      <p className="lede">
        Start from one of these and change anything: add bodies, move them, give them
        different masses. Everything you build stays in this browser — nothing is
        uploaded.
      </p>
      <p className="field-hint">
        There is no blank option, because gravity needs two things to act between. Each
        of these already does something the moment it opens.
      </p>

      {error !== null && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}

      <ul className="build-templates">
        {TEMPLATES.map((template) => (
          <li key={template.id} className="build-template">
            <h2>{template.title}</h2>
            <p>{template.description}</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void start(template)}
            >
              Start from this
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Exported for the tests, which check every template validates and is sane. */
export const BUILD_TEMPLATES = TEMPLATES;
