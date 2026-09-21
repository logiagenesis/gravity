/**
 * Three.js renderer.
 *
 * Reads the most recent snapshot and draws it. Holds no simulation state and
 * performs no physics: if snapshots stop arriving it keeps drawing the last one.
 *
 * Quality is ADAPTIVE and driven by measured frame time, not guessed. Two
 * separate mechanisms:
 *
 *   - Body count picks the representation. Up to DETAILED_BODY_LIMIT each body
 *     gets its own procedurally-shaded mesh; above that they collapse into one
 *     InstancedMesh with a cheap material, because a thousand shader programs
 *     is not a thing any GPU enjoys.
 *   - Measured frame time scales starfield density, trail length and device
 *     pixel ratio, so a slow device degrades gracefully instead of stuttering.
 */
import * as THREE from "three";
import type { BodyMeta } from "../worker/protocol";
import { applyFrame, type FrameSpec } from "./frames";
import {
  createBodyMaterial,
  createGlowTexture,
  inferBodyClass,
  starColour,
  type BodyMaterial,
} from "./materials";
import { createStarfield } from "./starfield";
import { LabelLayer, type LabelPlacement } from "./labels";

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  labelContainer: HTMLElement;
  reducedMotion: boolean;
}

/** Above this body count, individual shader meshes are replaced by instancing. */
const DETAILED_BODY_LIMIT = 64;
const MAX_TRAIL_POINTS = 512;
const STARFIELD_RADIUS = 900;

export type ScaleMode = "legible" | "true";

export class GravityScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private labels: LabelLayer;

  /** Detailed path: one mesh per body. */
  private bodyMeshes: THREE.Mesh[] = [];
  private bodyMaterials: BodyMaterial[] = [];
  private glowSprites: Map<number, THREE.Sprite> = new Map();
  /** Instanced path, used above DETAILED_BODY_LIMIT. */
  private instanced: THREE.InstancedMesh | null = null;

  private trails: THREE.LineSegments | null = null;
  private trailPositions: Float32Array | null = null;
  private trailAlphas: Float32Array | null = null;
  private trailHistory: Float32Array | null = null;
  private trailCursor = 0;
  private trailFilled = 0;
  private trailLength = 240;

  private starfield: THREE.Points | null = null;
  private starCount = 5200;
  private barycentreMarker: THREE.Points | null = null;
  private planeGrid: THREE.GridHelper | null = null;

  private meta: BodyMeta[] = [];
  private maxRadius = 0;
  private masses = new Float64Array(0);

  private dummy = new THREE.Object3D();
  private colour = new THREE.Color();
  private projected = new THREE.Vector3();

  /** Raw snapshot positions, and the frame-transformed copy actually drawn. */
  private raw: Float32Array | null = null;
  private display: Float32Array | null = null;

  private frameHandle: number | null = null;
  private disposed = false;

  private targetDistance = 5;
  private azimuth = 0.6;
  private elevation = 0.45;
  private lookTarget = new THREE.Vector3(0, 0, 0);
  /** Smoothed follow target, so focus transitions glide rather than snap. */
  private desiredTarget = new THREE.Vector3(0, 0, 0);

  private frame: FrameSpec = { kind: "inertial" };
  private focusIndex: number | null = null;
  private scaleMode: ScaleMode = "legible";
  private trailsEnabled = true;
  private showGrid = false;
  private showBarycentre = false;
  private reducedMotion: boolean;

  /** Smoothed frame time in ms. Drives every adaptive decision. */
  frameMs = 0;
  private lastFrameAt = 0;
  private qualityCooldown = 0;

  /**
   * Minimum apparent RADIUS in CSS pixels, for the smallest body on screen.
   *
   * 3.2px was too small: bodies were visible but only just, and the procedural
   * surface shading — the whole point of M3 — was invisible at that size. At
   * this value the Sun renders ~25px across and a terrestrial planet ~11px, so
   * the terminator and the surface banding actually read.
   */
  private static readonly MIN_APPARENT_RADIUS_PX = 4.5;
  /** Multipliers applied to the floor for the smallest and largest body. */
  private static readonly SIZE_SPREAD_MIN = 0.8;
  private static readonly SIZE_SPREAD_RANGE = 2.0;

  constructor(options: SceneOptions) {
    this.reducedMotion = options.reducedMotion;
    this.trailsEnabled = !options.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.setClearColor(0x03050b, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1e-6, 1e9);

    this.labels = new LabelLayer(options.labelContainer);

    this.starfield = createStarfield({
      count: this.starCount,
      radius: STARFIELD_RADIUS,
    });
    this.scene.add(this.starfield);

    this.resize();
  }

  // --- configuration --------------------------------------------------------

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) this.setTrailsEnabled(false);
  }
  get prefersReducedMotion(): boolean {
    return this.reducedMotion;
  }

  setTrailsEnabled(value: boolean): void {
    this.trailsEnabled = value && !this.reducedMotion;
    if (this.trails) this.trails.visible = this.trailsEnabled;
    if (!this.trailsEnabled) {
      this.trailCursor = 0;
      this.trailFilled = 0;
    }
  }
  get isTrailsEnabled(): boolean {
    return this.trailsEnabled;
  }

  setLabelsEnabled(value: boolean): void {
    this.labels.setEnabled(value);
  }
  get isLabelsEnabled(): boolean {
    return this.labels.isEnabled;
  }

  setScaleMode(mode: ScaleMode): void {
    this.scaleMode = mode;
  }
  get currentScaleMode(): ScaleMode {
    return this.scaleMode;
  }

  setFrame(spec: FrameSpec): void {
    this.frame = spec;
    // Trail history is expressed in the old frame and would smear; drop it.
    this.trailCursor = 0;
    this.trailFilled = 0;
  }
  get currentFrame(): FrameSpec {
    return this.frame;
  }

  /** Focus and follow a body, or pass null to stop following. */
  setFocus(index: number | null): void {
    this.focusIndex = index;
    if (index === null) this.desiredTarget.set(0, 0, 0);
  }
  get currentFocus(): number | null {
    return this.focusIndex;
  }

  setGridVisible(value: boolean): void {
    this.showGrid = value;
    if (this.planeGrid) this.planeGrid.visible = value;
  }
  get isGridVisible(): boolean {
    return this.showGrid;
  }

  setBarycentreVisible(value: boolean): void {
    this.showBarycentre = value;
    if (this.barycentreMarker) this.barycentreMarker.visible = value;
  }
  get isBarycentreVisible(): boolean {
    return this.showBarycentre;
  }

  setCameraDistance(distance: number): void {
    this.targetDistance = Math.max(1e-9, distance);
  }
  orbitCamera(deltaAzimuth: number, deltaElevation: number): void {
    this.azimuth += deltaAzimuth;
    this.elevation = Math.max(
      -Math.PI / 2 + 0.05,
      Math.min(Math.PI / 2 - 0.05, this.elevation + deltaElevation),
    );
  }
  zoomCamera(factor: number): void {
    this.targetDistance = Math.max(1e-9, this.targetDistance * factor);
  }

  panCamera(deltaX: number, deltaY: number): void {
    // Panning is an explicit choice to stop following.
    this.focusIndex = null;
    const height = this.renderer.domElement.clientHeight || 1;
    const worldPerPixel =
      (2 * this.targetDistance * Math.tan((this.camera.fov * Math.PI) / 360)) / height;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    this.desiredTarget.addScaledVector(right, -deltaX * worldPerPixel);
    this.desiredTarget.addScaledVector(up, deltaY * worldPerPixel);
  }

  recentreCamera(): void {
    this.focusIndex = null;
    this.desiredTarget.set(0, 0, 0);
  }

  /** Frame every body in view. */
  fitAll(): void {
    const positions = this.display;
    const count = Math.min(this.meta.length, positions ? positions.length / 3 : 0);
    if (!positions || count === 0) return;

    let maxDistance = 0;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const d = Math.hypot(
        positions[k] - this.desiredTarget.x,
        positions[k + 1] - this.desiredTarget.y,
        positions[k + 2] - this.desiredTarget.z,
      );
      if (d > maxDistance) maxDistance = d;
    }
    // A little margin so the outermost body is not flush against the edge.
    this.targetDistance = Math.max(1e-9, maxDistance * 2.4 + this.maxRadius * 4);
  }

  // --- body set -------------------------------------------------------------

  setBodies(meta: BodyMeta[]): void {
    this.meta = meta;
    this.maxRadius = meta.reduce((max, b) => Math.max(max, b.radius), 0);
    this.masses = new Float64Array(meta.map((b) => b.mass));
    this.disposeBodies();
    if (meta.length === 0) return;

    const detailed = meta.length <= DETAILED_BODY_LIMIT;

    if (detailed) {
      const geometry = new THREE.SphereGeometry(1, 32, 20);
      meta.forEach((body, index) => {
        const bodyClass = inferBodyClass(body.mass);
        const base =
          bodyClass === "star"
            ? starColour(5772) // Sun-like default; temperature arrives with the pipeline
            : new THREE.Color(body.colour);
        const material = createBodyMaterial(bodyClass, base, index * 7.13 + 1.7);
        const mesh = new THREE.Mesh(geometry, material.material);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.bodyMeshes.push(mesh);
        this.bodyMaterials.push(material);

        if (bodyClass === "star") {
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: createGlowTexture(),
              color: base,
              transparent: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          sprite.renderOrder = 2;
          this.scene.add(sprite);
          this.glowSprites.set(index, sprite);
        }
      });
    } else {
      const geometry = new THREE.SphereGeometry(1, 12, 8);
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geometry, material, meta.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      meta.forEach((body, index) => {
        this.colour.set(body.colour);
        mesh.setColorAt(index, this.colour);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.instanced = mesh;
      this.scene.add(mesh);
    }

    this.labels.setLabels(meta.map((b) => b.name));
    this.buildTrails(meta.length);
    this.buildMarkers();
  }

  private buildTrails(bodyCount: number): void {
    const segments = bodyCount * this.trailLength * 2;
    this.trailPositions = new Float32Array(segments * 3);
    this.trailAlphas = new Float32Array(segments);
    this.trailHistory = new Float32Array(bodyCount * MAX_TRAIL_POINTS * 3);
    this.trailCursor = 0;
    this.trailFilled = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailPositions, 3),
    );
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.trailAlphas, 1));

    // A shader material, because LineBasicMaterial's vertexColors carry no
    // alpha and the trail needs to fade along its length.
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x8fb8ff) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.002) discard;
          gl_FragColor = vec4(uColor, vAlpha * 0.75);
        }
      `,
    });

    this.trails = new THREE.LineSegments(geometry, material);
    this.trails.frustumCulled = false;
    this.trails.visible = this.trailsEnabled;
    this.scene.add(this.trails);
  }

  private buildMarkers(): void {
    // Barycentre: a single bright point, drawn on top.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(3), 3),
    );
    const material = new THREE.PointsMaterial({
      color: 0xffd166,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
    });
    this.barycentreMarker = new THREE.Points(geometry, material);
    this.barycentreMarker.frustumCulled = false;
    this.barycentreMarker.renderOrder = 5;
    this.barycentreMarker.visible = this.showBarycentre;
    this.scene.add(this.barycentreMarker);

    this.planeGrid = new THREE.GridHelper(20, 20, 0x2a3445, 0x1b2436);
    (this.planeGrid.material as THREE.Material).transparent = true;
    (this.planeGrid.material as THREE.Material).opacity = 0.35;
    this.planeGrid.visible = this.showGrid;
    this.scene.add(this.planeGrid);
  }

  /** Hand the renderer new positions. Cheap: stores the reference only. */
  setPositions(positions: Float32Array): void {
    this.raw = positions;
  }

  // --- adaptive quality -----------------------------------------------------

  private adaptQuality(): void {
    if (this.qualityCooldown > 0) {
      this.qualityCooldown--;
      return;
    }
    // 22ms ≈ below 45fps; 13ms ≈ comfortably above 60fps.
    if (this.frameMs > 22 && this.starCount > 900) {
      this.rebuildStarfield(Math.max(900, Math.round(this.starCount * 0.6)));
      this.trailLength = Math.max(60, Math.round(this.trailLength * 0.7));
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() - 0.25));
      this.qualityCooldown = 120;
    } else if (this.frameMs > 0 && this.frameMs < 13 && this.starCount < 6500) {
      this.rebuildStarfield(Math.min(6500, Math.round(this.starCount * 1.25)));
      this.qualityCooldown = 240;
    }
  }

  private rebuildStarfield(count: number): void {
    if (count === this.starCount) return;
    this.starCount = count;
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
    }
    this.starfield = createStarfield({ count, radius: STARFIELD_RADIUS });
    this.scene.add(this.starfield);
  }

  // --- frame loop -----------------------------------------------------------

  private updateTrails(positions: Float32Array, bodyCount: number): void {
    if (!this.trails || !this.trailPositions || !this.trailHistory || !this.trailAlphas)
      return;
    if (!this.trailsEnabled || this.reducedMotion) return;

    for (let i = 0; i < bodyCount; i++) {
      const dst = (i * MAX_TRAIL_POINTS + this.trailCursor) * 3;
      this.trailHistory[dst] = positions[i * 3];
      this.trailHistory[dst + 1] = positions[i * 3 + 1];
      this.trailHistory[dst + 2] = positions[i * 3 + 2];
    }
    this.trailCursor = (this.trailCursor + 1) % MAX_TRAIL_POINTS;
    if (this.trailFilled < MAX_TRAIL_POINTS) this.trailFilled++;

    const span = Math.min(this.trailFilled, this.trailLength);
    let out = 0;
    let alphaOut = 0;

    for (let i = 0; i < bodyCount; i++) {
      for (let s = 0; s < span - 1; s++) {
        const aIdx =
          (this.trailCursor - span + s + MAX_TRAIL_POINTS * 2) % MAX_TRAIL_POINTS;
        const bIdx = (aIdx + 1) % MAX_TRAIL_POINTS;
        const a = (i * MAX_TRAIL_POINTS + aIdx) * 3;
        const b = (i * MAX_TRAIL_POINTS + bIdx) * 3;
        // Fade from transparent at the tail to opaque at the head.
        const alpha = span <= 1 ? 1 : s / (span - 1);
        this.trailPositions[out++] = this.trailHistory[a];
        this.trailPositions[out++] = this.trailHistory[a + 1];
        this.trailPositions[out++] = this.trailHistory[a + 2];
        this.trailPositions[out++] = this.trailHistory[b];
        this.trailPositions[out++] = this.trailHistory[b + 1];
        this.trailPositions[out++] = this.trailHistory[b + 2];
        this.trailAlphas[alphaOut++] = alpha;
        this.trailAlphas[alphaOut++] = alpha;
      }
    }
    this.trailPositions.fill(0, out);
    this.trailAlphas.fill(0, alphaOut);
    this.trails.geometry.getAttribute("position").needsUpdate = true;
    this.trails.geometry.getAttribute("aAlpha").needsUpdate = true;
  }

  private renderFrame = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    if (this.lastFrameAt !== 0) {
      // Exponential smoothing: a single slow frame should not thrash quality.
      const delta = now - this.lastFrameAt;
      this.frameMs = this.frameMs === 0 ? delta : this.frameMs * 0.9 + delta * 0.1;
    }
    this.lastFrameAt = now;
    this.adaptQuality();

    const raw = this.raw;
    const bodyCount = raw ? Math.min(this.meta.length, Math.floor(raw.length / 3)) : 0;
    /** Filled in by the position pass; used again by the label pass. */
    let radiusForLabels: ((index: number) => number) | null = null;
    let pixelsPerWorldUnit = 0;

    if (raw && bodyCount > 0) {
      if (!this.display || this.display.length < bodyCount * 3) {
        this.display = new Float32Array(bodyCount * 3);
      }
      applyFrame(raw, this.masses, bodyCount, this.frame, this.display);
      const positions = this.display;

      // Follow the focused body in the CURRENT frame.
      if (this.focusIndex !== null && this.focusIndex < bodyCount) {
        const k = this.focusIndex * 3;
        this.desiredTarget.set(positions[k], positions[k + 1], positions[k + 2]);
      }
      // Glide rather than snap, unless the user asked for reduced motion.
      this.lookTarget.lerp(this.desiredTarget, this.reducedMotion ? 1 : 0.18);

      const viewportHeight = this.renderer.domElement.clientHeight || 1;
      const visibleHeight =
        2 * this.targetDistance * Math.tan((this.camera.fov * Math.PI) / 360);
      const minRadius =
        (GravityScene.MIN_APPARENT_RADIUS_PX / viewportHeight) * visibleHeight;
      pixelsPerWorldUnit = viewportHeight / visibleHeight;

      radiusForLabels = (index: number): number => {
        const physical = this.meta[index].radius;
        if (this.scaleMode === "true") return physical;
        // Legible mode: physical where visible, a size-ordered floor where not.
        const relative = this.maxRadius > 0 ? Math.cbrt(physical / this.maxRadius) : 1;
        return Math.max(
          physical,
          minRadius *
            (GravityScene.SIZE_SPREAD_MIN + GravityScene.SIZE_SPREAD_RANGE * relative),
        );
      };

      if (this.instanced) {
        for (let i = 0; i < bodyCount; i++) {
          const k = i * 3;
          this.dummy.position.set(positions[k], positions[k + 1], positions[k + 2]);
          this.dummy.scale.setScalar(radiusForLabels(i));
          this.dummy.updateMatrix();
          this.instanced.setMatrixAt(i, this.dummy.matrix);
        }
        this.instanced.count = bodyCount;
        this.instanced.instanceMatrix.needsUpdate = true;
      } else {
        // The first star is the light source for every other body.
        let lightIndex = -1;
        for (let i = 0; i < bodyCount; i++) {
          if (this.bodyMaterials[i]?.bodyClass === "star") {
            lightIndex = i;
            break;
          }
        }
        const lx = lightIndex >= 0 ? positions[lightIndex * 3] : 0;
        const ly = lightIndex >= 0 ? positions[lightIndex * 3 + 1] : 0;
        const lz = lightIndex >= 0 ? positions[lightIndex * 3 + 2] : 0;

        for (let i = 0; i < bodyCount; i++) {
          const mesh = this.bodyMeshes[i];
          if (!mesh) continue;
          const k = i * 3;
          const r = radiusForLabels(i);
          mesh.position.set(positions[k], positions[k + 1], positions[k + 2]);
          mesh.scale.setScalar(r);

          const material = this.bodyMaterials[i];
          if (material) {
            material.uniforms.uLightPos.value.set(lx, ly, lz);
            material.uniforms.uTime.value = now * 0.001;
          }

          const glow = this.glowSprites.get(i);
          if (glow) {
            glow.position.copy(mesh.position);
            glow.scale.setScalar(r * 9);
          }
        }
      }

      this.updateTrails(positions, bodyCount);

      if (this.barycentreMarker && this.showBarycentre) {
        let total = 0;
        let bx = 0;
        let by = 0;
        let bz = 0;
        for (let i = 0; i < bodyCount; i++) {
          const m = this.masses[i];
          if (m <= 0) continue;
          const k = i * 3;
          bx += m * positions[k];
          by += m * positions[k + 1];
          bz += m * positions[k + 2];
          total += m;
        }
        const attribute = this.barycentreMarker.geometry.getAttribute("position");
        if (total > 0) {
          (attribute.array as Float32Array).set([bx / total, by / total, bz / total]);
          attribute.needsUpdate = true;
        }
      }
    }

    // --- camera ---
    const d = this.targetDistance;
    const cosE = Math.cos(this.elevation);
    this.camera.position.set(
      this.lookTarget.x + d * cosE * Math.cos(this.azimuth),
      this.lookTarget.y + d * Math.sin(this.elevation),
      this.lookTarget.z + d * cosE * Math.sin(this.azimuth),
    );
    this.camera.lookAt(this.lookTarget);
    this.camera.near = Math.max(1e-7, d * 1e-4);
    this.camera.far = Math.max(10, d * 1000 + STARFIELD_RADIUS * 2);
    this.camera.updateProjectionMatrix();

    if (this.starfield) this.starfield.position.copy(this.camera.position);
    if (this.planeGrid && this.showGrid) {
      this.planeGrid.scale.setScalar(Math.max(1e-6, d / 10));
    }

    this.renderer.render(this.scene, this.camera);

    // --- labels (after render, so the camera matrices are current) ---
    if (this.labels.isEnabled && this.display && bodyCount > 0) {
      const width = this.renderer.domElement.clientWidth || 1;
      const height = this.renderer.domElement.clientHeight || 1;
      const placements: LabelPlacement[] = [];
      for (let i = 0; i < bodyCount; i++) {
        const k = i * 3;
        this.projected.set(this.display[k], this.display[k + 1], this.display[k + 2]);
        const depth = this.projected.distanceTo(this.camera.position);
        this.projected.project(this.camera);
        placements.push({
          index: i,
          x: (this.projected.x * 0.5 + 0.5) * width,
          y: (-this.projected.y * 0.5 + 0.5) * height,
          depth,
          screenRadius: radiusForLabels ? radiusForLabels(i) * pixelsPerWorldUnit : 0,
          // z outside [-1,1] means behind the camera or beyond the far plane.
          visible: this.projected.z > -1 && this.projected.z < 1,
        });
      }
      this.labels.update(placements, width, height);
    }

    this.frameHandle = requestAnimationFrame(this.renderFrame);
  };

  start(): void {
    if (this.frameHandle === null) {
      this.frameHandle = requestAnimationFrame(this.renderFrame);
    }
  }
  stop(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private disposeBodies(): void {
    for (const mesh of this.bodyMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.bodyMeshes = [];
    for (const material of this.bodyMaterials) material.material.dispose();
    this.bodyMaterials = [];
    for (const sprite of this.glowSprites.values()) {
      this.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.glowSprites.clear();

    if (this.instanced) {
      this.scene.remove(this.instanced);
      this.instanced.geometry.dispose();
      (this.instanced.material as THREE.Material).dispose();
      this.instanced.dispose();
      this.instanced = null;
    }
    if (this.trails) {
      this.scene.remove(this.trails);
      this.trails.geometry.dispose();
      (this.trails.material as THREE.Material).dispose();
      this.trails = null;
    }
    if (this.barycentreMarker) {
      this.scene.remove(this.barycentreMarker);
      this.barycentreMarker.geometry.dispose();
      (this.barycentreMarker.material as THREE.Material).dispose();
      this.barycentreMarker = null;
    }
    if (this.planeGrid) {
      this.scene.remove(this.planeGrid);
      this.planeGrid.dispose();
      this.planeGrid = null;
    }
    this.trailPositions = null;
    this.trailAlphas = null;
    this.trailHistory = null;
    this.labels.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.disposeBodies();
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
      this.starfield = null;
    }
    this.labels.dispose();
    this.renderer.dispose();
  }
}
