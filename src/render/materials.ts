/**
 * Procedural body materials.
 *
 * NO TEXTURE DOWNLOADS. Every surface here is generated in the fragment shader
 * from the body's own parameters. That keeps the bundle small, keeps the
 * "zero third-party requests" promise intact, and sidesteps image licensing
 * entirely — a real constraint given the clean-room rule.
 *
 * Each material shades by the direction to the primary light (the star), which
 * is what produces a day/night terminator instead of the flat, uniformly-lit
 * discs the previous renderer drew.
 */
import * as THREE from "three";
import { DEUTERIUM_BURNING_LIMIT_MSUN } from "../sim/constants";

export type BodyClass = "star" | "gas-giant" | "rocky" | "ice" | "moon";

/**
 * Infer a body's visual class from its physical parameters.
 *
 * This is a VISUAL classification, deliberately not the catalogue's
 * star/not-a-star one. What matters for drawing is whether an object emits
 * its own light, and a brown dwarf does; what matters for a catalogue facet
 * labelled "stars" is whether it is a star, and a brown dwarf is not. The two
 * boundaries are different quantities and are kept apart on purpose.
 *
 * Thresholds in solar masses:
 *   > deuterium-burning limit (0.0124 M☉, 13 M_Jup) — self-luminous; draw as
 *                 a star. This is the IAU planet/brown-dwarf boundary.
 *   > 2e-5      — above roughly half a Neptune: gas giant.
 *   otherwise   — rocky, unless flagged as a moon.
 */
export function inferBodyClass(massSolar: number, explicit?: string): BodyClass {
  if (
    explicit === "star" ||
    explicit === "gas-giant" ||
    explicit === "rocky" ||
    explicit === "ice" ||
    explicit === "moon"
  ) {
    return explicit;
  }
  if (massSolar > DEUTERIUM_BURNING_LIMIT_MSUN) return "star";
  if (massSolar > 2e-5) return "gas-giant";
  return "rocky";
}

/**
 * Approximate RGB for a blackbody temperature, used for star colour.
 * Piecewise fit to the familiar O-B-A-F-G-K-M progression; good enough to make
 * a hot star blue-white and a cool one orange, which is the point.
 */
export function starColour(temperatureK: number): THREE.Color {
  const t = Math.max(1000, Math.min(40000, temperatureK));
  let r: number;
  let g: number;
  let b: number;
  if (t <= 6600) {
    r = 1;
    g = Math.min(1, Math.max(0, 0.39 * Math.log(t / 100) - 0.63));
    b =
      t <= 1900 ? 0 : Math.min(1, Math.max(0, 0.543 * Math.log(t / 100 - 10) - 1.196));
  } else {
    r = Math.min(1, Math.max(0, 1.29 * Math.pow(t / 100 - 60, -0.1332)));
    g = Math.min(1, Math.max(0, 1.13 * Math.pow(t / 100 - 60, -0.0755)));
    b = 1;
  }
  return new THREE.Color(r, g, b);
}

/** Shared noise helpers, injected into every procedural fragment shader. */
const NOISE_GLSL = /* glsl */ `
  // Cheap 3D value noise. Not the prettiest, but it is dependency-free,
  // deterministic, and fast enough to run per-fragment on a phone.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export interface ProceduralUniforms {
  uLightPos: { value: THREE.Vector3 };
  uColor: { value: THREE.Color };
  uSeed: { value: number };
  uTime: { value: number };
}

function makeUniforms(colour: THREE.Color, seed: number): ProceduralUniforms {
  return {
    uLightPos: { value: new THREE.Vector3(0, 0, 0) },
    uColor: { value: colour },
    uSeed: { value: seed },
    uTime: { value: 0 },
  };
}

/** Lighting term shared by every non-emissive body. */
const LIGHTING_GLSL = /* glsl */ `
  vec3 L = normalize(uLightPos - vWorld);
  float lambert = max(dot(normalize(vNormal), L), 0.0);
  // A soft wrap keeps the night side readable rather than pure black, and
  // widens the terminator so it looks like a planet rather than a cut-out.
  float lit = pow(clamp(lambert * 0.9 + 0.12, 0.0, 1.0), 0.85);
  vec3 night = base * 0.06;
`;

function fragmentFor(bodyClass: BodyClass): string {
  const common = `
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying vec3 vLocal;
    uniform vec3 uLightPos;
    uniform vec3 uColor;
    uniform float uSeed;
    uniform float uTime;
    ${NOISE_GLSL}
    void main() {
  `;

  switch (bodyClass) {
    case "star":
      // Emissive: granulation plus limb darkening. No lighting term — it IS
      // the light source.
      return `${common}
        vec3 p = normalize(vLocal) * 6.0 + uSeed;
        float gran = fbm(p + vec3(uTime * 0.03));
        vec3 base = uColor * (0.85 + 0.35 * gran);
        // Limb darkening: the edge of a star's disc really is dimmer.
        float mu = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
        base *= (0.55 + 0.45 * pow(mu, 0.55));
        gl_FragColor = vec4(base * 1.6, 1.0);
      }`;

    case "gas-giant":
      // Latitudinal banding, warped by noise so the bands are not perfect rings.
      return `${common}
        vec3 n = normalize(vLocal);
        float lat = n.y;
        float warp = fbm(n * 3.0 + uSeed) * 0.35;
        float bands = sin((lat * 9.0 + warp) * 3.14159);
        bands = bands * 0.5 + 0.5;
        float detail = fbm(n * 14.0 + uSeed * 2.0) * 0.18;
        vec3 base = mix(uColor * 0.62, uColor * 1.18, bands) + detail;
        ${LIGHTING_GLSL}
        gl_FragColor = vec4(mix(night, base, lit), 1.0);
      }`;

    case "ice":
      return `${common}
        vec3 n = normalize(vLocal);
        float cracks = smoothstep(0.42, 0.5, fbm(n * 9.0 + uSeed));
        vec3 base = mix(uColor * 1.05, uColor * 0.7, cracks);
        ${LIGHTING_GLSL}
        gl_FragColor = vec4(mix(night, base, lit), 1.0);
      }`;

    case "moon":
      return `${common}
        vec3 n = normalize(vLocal);
        float craters = fbm(n * 16.0 + uSeed);
        float maria = smoothstep(0.52, 0.62, fbm(n * 3.0 + uSeed * 3.0));
        vec3 base = uColor * (0.72 + 0.45 * craters) * mix(1.0, 0.68, maria);
        ${LIGHTING_GLSL}
        gl_FragColor = vec4(mix(night, base, lit), 1.0);
      }`;

    default:
      // Rocky: continents and highlands.
      return `${common}
        vec3 n = normalize(vLocal);
        float land = fbm(n * 4.0 + uSeed);
        float rough = fbm(n * 18.0 + uSeed * 5.0) * 0.22;
        vec3 low = uColor * 0.62;
        vec3 high = uColor * 1.25;
        vec3 base = mix(low, high, smoothstep(0.38, 0.62, land)) + rough;
        ${LIGHTING_GLSL}
        gl_FragColor = vec4(mix(night, base, lit), 1.0);
      }`;
  }
}

export interface BodyMaterial {
  material: THREE.ShaderMaterial;
  uniforms: ProceduralUniforms;
  bodyClass: BodyClass;
}

export function createBodyMaterial(
  bodyClass: BodyClass,
  colour: THREE.Color,
  seed: number,
): BodyMaterial {
  const uniforms = makeUniforms(colour, seed);
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: fragmentFor(bodyClass),
  });
  return { material, uniforms, bodyClass };
}

/**
 * Radial-gradient sprite texture for a star's glow, drawn to a canvas at
 * runtime. Generated rather than downloaded, for the same reasons as above.
 */
export function createGlowTexture(size = 128): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.18, "rgba(255,240,205,0.55)");
    gradient.addColorStop(0.45, "rgba(255,200,120,0.16)");
    gradient.addColorStop(1, "rgba(255,180,90,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
