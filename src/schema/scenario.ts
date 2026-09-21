/**
 * Versioned scenario schema.
 *
 * Every scenario that enters the simulation passes through `parseScenario`,
 * whatever its origin: bundled catalogue, imported file, share link, or
 * IndexedDB. A comparable implementation had no runtime validation at all and
 * spread parsed JSON straight into application state
 * (artifacts/03-current-site-audit.md §12.3).
 *
 * `source` is MANDATORY. A scenario that cannot say where its numbers came
 * from is not publishable here — it is the cheapest trust signal available and
 * its absence is what makes a simulator feel like a toy.
 */
import { z } from "zod";

/** Current schema version. Increment when making a breaking change, and add a migration. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * A finite number. Uses Zod's built-in `.finite()` rather than `.refine()` so
 * the result stays a ZodNumber and `.positive()` / `.nonnegative()` can still
 * be chained onto it. NaN and +/-Infinity are rejected here rather than
 * silently poisoning the integrator downstream.
 */
const finite = (label: string) =>
  z.number({ invalid_type_error: `${label} must be a number` }).finite({
    message: `${label} must be finite`,
  });

export const vector3Schema = z.object({
  x: finite("x"),
  y: finite("y"),
  z: finite("z"),
});

export const sourceSchema = z.object({
  /** e.g. "NASA JPL Horizons", "NASA Exoplanet Archive", "Chenciner & Montgomery (2000)" */
  provider: z.string().min(1, "source.provider is required"),
  /** Identifier within the provider: object designation, query, DOI. */
  reference: z.string().min(1, "source.reference is required"),
  /** ISO date the values were retrieved, so staleness is visible. */
  retrievedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "retrievedAt must be YYYY-MM-DD"),
  url: z.string().url().optional(),
  notes: z.string().optional(),
});

export const bodySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Solar masses. Zero denotes a massless test particle. */
  mass: finite("mass").nonnegative("mass cannot be negative"),
  /** AU. Used for collision contact and for rendering scale. */
  radius: finite("radius").positive("radius must be positive"),
  position: vector3Schema,
  /** AU per day. */
  velocity: vector3Schema,
  massless: z.boolean().optional(),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "colour must be a #rrggbb hex string")
    .optional(),
});

export const physicsSchema = z.object({
  /** Omit to use the exact AU/M☉/day value derived from the Gaussian constant. */
  g: finite("g").positive().optional(),
  /** Plummer softening length ε, in AU. */
  softening: finite("softening").nonnegative().default(0),
  integrator: z.enum(["verlet", "pefrl", "rk4"]).default("verlet"),
  /** Simulation timestep, in days. */
  dt: finite("dt").positive("dt must be positive"),
  forceMode: z.enum(["auto", "direct", "barnes-hut"]).default("auto"),
  theta: finite("theta").positive().max(2).default(0.5),
  collisions: z.boolean().default(true),
});

export const scenarioSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case"),
    name: z.string().min(1),
    summary: z.string().min(1, "summary is required so the catalogue is searchable"),
    category: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
    source: sourceSchema,
    physics: physicsSchema,
    bodies: z.array(bodySchema).min(2, "a scenario needs at least two bodies"),
    camera: z
      .object({
        distance: finite("camera.distance").positive().default(5),
        target: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((scenario, ctx) => {
    // Body ids must be unique: they key rendering, labels and camera focus.
    const seen = new Set<string>();
    for (const body of scenario.bodies) {
      if (seen.has(body.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate body id "${body.id}"`,
          path: ["bodies"],
        });
      }
      seen.add(body.id);
    }

    // At least one body must have mass, or there is no gravity to simulate.
    const hasMass = scenario.bodies.some((b) => b.mass > 0 && b.massless !== true);
    if (!hasMass) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one body must have non-zero mass",
        path: ["bodies"],
      });
    }

    // A camera target, if given, must name a real body.
    if (scenario.camera?.target !== undefined) {
      const target = scenario.camera.target;
      if (!scenario.bodies.some((b) => b.id === target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `camera.target "${target}" does not match any body id`,
          path: ["camera", "target"],
        });
      }
    }
  });

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioBody = z.infer<typeof bodySchema>;
export type ScenarioSource = z.infer<typeof sourceSchema>;

export class ScenarioValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Scenario is not valid:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ScenarioValidationError";
    this.issues = issues;
  }
}

/**
 * Validate an unknown value as a current-version scenario.
 * Throws ScenarioValidationError with every problem listed, not just the first.
 */
export function parseScenario(input: unknown): Scenario {
  const result = scenarioSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    });
    throw new ScenarioValidationError(issues);
  }
  return result.data;
}

/** Non-throwing variant for bulk validation in the build pipeline. */
export function safeParseScenario(
  input: unknown,
): { ok: true; scenario: Scenario } | { ok: false; issues: string[] } {
  try {
    return { ok: true, scenario: parseScenario(input) };
  } catch (error) {
    if (error instanceof ScenarioValidationError)
      return { ok: false, issues: error.issues };
    throw error;
  }
}
