/**
 * Reference-frame transforms.
 *
 * PHYSICS STAYS INERTIAL. These transforms are applied to a copy of the
 * positions on their way to the renderer, never to the simulation state. That
 * separation matters: a rotating frame is not an inertial frame, so integrating
 * in one would require fictitious forces and would quietly change the answer.
 * Here it is presentation only, which is both correct and reversible.
 *
 * Frames:
 *   inertial    — raw simulation coordinates
 *   barycentric — origin at the system centre of mass
 *   body        — origin at a chosen body
 *   rotating    — co-rotating with a chosen PAIR, so the line joining them is
 *                 fixed along +x. This is what makes Lagrange points, Trojan
 *                 clouds and horseshoe orbits legible: in an inertial view they
 *                 are a blur, in the rotating frame they stand still.
 */

export type FrameKind = "inertial" | "barycentric" | "body" | "rotating";

export interface FrameSpec {
  kind: FrameKind;
  /** Index of the origin body for "body", and the primary for "rotating". */
  primaryIndex?: number;
  /** Index of the secondary body for "rotating". */
  secondaryIndex?: number;
}

/**
 * Write frame-transformed positions into `out`.
 *
 * @param positions interleaved xyz, length >= count*3
 * @param masses    per-body mass, length >= count
 * @param out       destination, length >= count*3. May alias `positions`.
 */
export function applyFrame(
  positions: Float32Array | Float64Array,
  masses: Float64Array | Float32Array,
  count: number,
  spec: FrameSpec,
  out: Float32Array,
): void {
  const n = count * 3;

  if (spec.kind === "inertial") {
    for (let i = 0; i < n; i++) out[i] = positions[i];
    return;
  }

  // --- work out the origin -------------------------------------------------
  let ox = 0;
  let oy = 0;
  let oz = 0;

  if (spec.kind === "barycentric") {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const m = masses[i];
      if (m <= 0) continue;
      const k = i * 3;
      ox += m * positions[k];
      oy += m * positions[k + 1];
      oz += m * positions[k + 2];
      total += m;
    }
    if (total > 0) {
      ox /= total;
      oy /= total;
      oz /= total;
    }
  } else {
    const p = spec.primaryIndex ?? 0;
    if (p >= 0 && p < count) {
      const k = p * 3;
      ox = positions[k];
      oy = positions[k + 1];
      oz = positions[k + 2];
    }
  }

  if (spec.kind !== "rotating") {
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      out[k] = positions[k] - ox;
      out[k + 1] = positions[k + 1] - oy;
      out[k + 2] = positions[k + 2] - oz;
    }
    return;
  }

  // --- rotating frame ------------------------------------------------------
  // Build an orthonormal basis in which the primary→secondary vector is +x and
  // the orbital plane is the xy-plane, then express every body in that basis.
  const s = spec.secondaryIndex ?? 1;
  if (s < 0 || s >= count || s === spec.primaryIndex) {
    // Nothing sensible to rotate about; degrade to a body-centred view rather
    // than emitting NaN.
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      out[k] = positions[k] - ox;
      out[k + 1] = positions[k + 1] - oy;
      out[k + 2] = positions[k + 2] - oz;
    }
    return;
  }

  const sk = s * 3;
  let ex = positions[sk] - ox;
  let ey = positions[sk + 1] - oy;
  let ez = positions[sk + 2] - oz;
  const separation = Math.hypot(ex, ey, ez);
  if (separation === 0) {
    for (let i = 0; i < n; i++)
      out[i] = positions[i] - (i % 3 === 0 ? ox : i % 3 === 1 ? oy : oz);
    return;
  }
  ex /= separation;
  ey /= separation;
  ez /= separation;

  // Pick a reference "up" that is not parallel to the separation vector, so the
  // cross product is well conditioned at every orientation.
  let ux = 0;
  let uy = 0;
  let uz = 1;
  if (Math.abs(ez) > 0.9) {
    ux = 1;
    uy = 0;
    uz = 0;
  }

  // zAxis = normalise(e × up)  — the orbital-plane normal
  let zx = ey * uz - ez * uy;
  let zy = ez * ux - ex * uz;
  let zz = ex * uy - ey * ux;
  const zLen = Math.hypot(zx, zy, zz) || 1;
  zx /= zLen;
  zy /= zLen;
  zz /= zLen;

  // yAxis = z × x, completing a right-handed orthonormal basis.
  const yx = zy * ez - zz * ey;
  const yy = zz * ex - zx * ez;
  const yz = zx * ey - zy * ex;

  for (let i = 0; i < count; i++) {
    const k = i * 3;
    const dx = positions[k] - ox;
    const dy = positions[k + 1] - oy;
    const dz = positions[k + 2] - oz;
    // Project onto the rotating basis.
    out[k] = dx * ex + dy * ey + dz * ez;
    out[k + 1] = dx * yx + dy * yy + dz * yz;
    out[k + 2] = dx * zx + dy * zy + dz * zz;
  }
}

/** Human-readable label for a frame, used in the UI and announcements. */
export function describeFrame(spec: FrameSpec, names: readonly string[]): string {
  switch (spec.kind) {
    case "inertial":
      return "Inertial";
    case "barycentric":
      return "Barycentric";
    case "body":
      return `Centred on ${names[spec.primaryIndex ?? 0] ?? "body"}`;
    case "rotating":
      return `Rotating: ${names[spec.primaryIndex ?? 0] ?? "?"} – ${
        names[spec.secondaryIndex ?? 1] ?? "?"
      }`;
  }
}
