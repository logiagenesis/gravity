/**
 * Procedural starfield.
 *
 * Generated from a seeded PRNG, not downloaded. A cube-map or 4K panorama would
 * be the usual approach and would cost megabytes and a licensing decision; this
 * costs a few hundred kilobytes of GPU buffer and nothing else.
 *
 * Stars are placed on a large sphere and rendered as points with a realistic
 * magnitude distribution: many faint, few bright. Colour follows a rough
 * spectral-class spread so the field is not uniformly white.
 */
import * as THREE from "three";

/** Deterministic PRNG so the sky is identical on every load and every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StarfieldOptions {
  /** Number of stars. Adaptive quality lowers this on slow devices. */
  count: number;
  /** Radius of the sphere the stars sit on, in scene units. */
  radius: number;
  seed?: number;
}

export function createStarfield(options: StarfieldOptions): THREE.Points {
  const { count, radius, seed = 20260921 } = options;
  const random = mulberry32(seed);

  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const colour = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Uniform on a sphere: acos of a uniform cosine avoids clustering at poles.
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const k = i * 3;
    positions[k] = radius * s * Math.cos(theta);
    positions[k + 1] = radius * u;
    positions[k + 2] = radius * s * Math.sin(theta);

    // Magnitude: the vast majority of visible stars are faint. Raising a
    // uniform to a power skews the distribution that way without a lookup.
    const brightness = Math.pow(random(), 2.6);

    // Spectral spread, weighted towards cool stars as the real sky is.
    const spectral = random();
    if (spectral > 0.96)
      colour.setRGB(0.72, 0.8, 1.0); // hot blue-white
    else if (spectral > 0.82)
      colour.setRGB(0.92, 0.95, 1.0); // white
    else if (spectral > 0.55)
      colour.setRGB(1.0, 0.98, 0.9); // yellow-white
    else colour.setRGB(1.0, 0.86, 0.72); // orange-red

    const intensity = 0.42 + 0.78 * brightness;
    colours[k] = colour.r * intensity;
    colours[k + 1] = colour.g * intensity;
    colours[k + 2] = colour.b * intensity;

    sizes[i] = 0.9 + brightness * 3.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Additive so overlapping stars brighten rather than occlude.
    blending: THREE.AdditiveBlending,
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Fixed pixel size: stars are at "infinity", so they must not scale
        // with zoom the way scene geometry does.
        gl_PointSize = aSize;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        // Round off the square point sprite and soften its edge.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float alpha = 1.0 - smoothstep(0.55, 1.0, r);
        if (alpha <= 0.01) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  // The sky is always behind everything and must never be culled away.
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}
