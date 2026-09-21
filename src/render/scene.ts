/**
 * Three.js renderer.
 *
 * Reads the most recent snapshot and draws it. It holds no simulation state of
 * its own and performs no physics — if snapshots stop arriving it simply keeps
 * drawing the last one.
 *
 * Bodies are drawn with a single InstancedMesh, so the draw-call count does not
 * grow with body count.
 */
import * as THREE from "three";
import type { BodyMeta } from "../worker/protocol";

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  /** Honour prefers-reduced-motion by disabling idle camera drift. */
  reducedMotion: boolean;
}

const MAX_TRAIL_POINTS = 240;

export class GravityScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private bodies: THREE.InstancedMesh | null = null;
  private trails: THREE.LineSegments | null = null;
  private trailPositions: Float32Array | null = null;
  private trailHistory: Float32Array | null = null;
  private trailCursor = 0;
  private trailFilled = 0;
  private meta: BodyMeta[] = [];
  private dummy = new THREE.Object3D();
  private colour = new THREE.Color();
  private latest: Float32Array | null = null;
  private frameHandle: number | null = null;
  private disposed = false;

  /** Camera framing distance in scene units. */
  private targetDistance = 5;
  private azimuth = 0.6;
  private elevation = 0.45;
  private trailsEnabled = true;
  private reducedMotion: boolean;

  /** Most recent measured frame time in ms, used for adaptive quality. */
  frameMs = 0;
  private lastFrameAt = 0;

  constructor(options: SceneOptions) {
    this.reducedMotion = options.reducedMotion;
    // Motion trails are continuous animated motion. A user who has asked the
    // operating system for reduced motion should not get them switched on by
    // default; they can still enable them explicitly from the controls.
    this.trailsEnabled = !options.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    // Cap device pixel ratio: rendering at 3x on a phone costs 9x the fragments
    // for no perceptible gain.
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.setClearColor(0x05070d, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1e-6, 1e9);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 1, 1);
    this.scene.add(key);

    this.resize();
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) this.setTrailsEnabled(false);
  }

  /** Whether the renderer is currently honouring a reduced-motion preference. */
  get prefersReducedMotion(): boolean {
    return this.reducedMotion;
  }

  setTrailsEnabled(value: boolean): void {
    this.trailsEnabled = value && !this.reducedMotion;
    value = this.trailsEnabled;
    if (this.trails) this.trails.visible = value;
    if (!value) {
      this.trailCursor = 0;
      this.trailFilled = 0;
    }
  }

  setCameraDistance(distance: number): void {
    this.targetDistance = Math.max(1e-6, distance);
  }

  orbitCamera(deltaAzimuth: number, deltaElevation: number): void {
    this.azimuth += deltaAzimuth;
    this.elevation = Math.max(
      -Math.PI / 2 + 0.05,
      Math.min(Math.PI / 2 - 0.05, this.elevation + deltaElevation),
    );
  }

  zoomCamera(factor: number): void {
    this.targetDistance = Math.max(1e-6, this.targetDistance * factor);
  }

  /** Rebuild instanced geometry when the body set changes. */
  setBodies(meta: BodyMeta[]): void {
    this.meta = meta;
    this.disposeBodies();

    if (meta.length === 0) return;

    const geometry = new THREE.SphereGeometry(1, 20, 14);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.75,
      metalness: 0.05,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, meta.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    for (let i = 0; i < meta.length; i++) {
      this.colour.set(meta[i].colour);
      mesh.setColorAt(i, this.colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.bodies = mesh;
    this.scene.add(mesh);

    // Trails: one ring buffer of points per body, drawn as line segments.
    const segments = meta.length * MAX_TRAIL_POINTS * 2;
    this.trailPositions = new Float32Array(segments * 3);
    this.trailHistory = new Float32Array(meta.length * MAX_TRAIL_POINTS * 3);
    this.trailCursor = 0;
    this.trailFilled = 0;

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailPositions, 3),
    );
    const trailMaterial = new THREE.LineBasicMaterial({
      color: 0x8fb8ff,
      transparent: true,
      opacity: 0.45,
    });
    this.trails = new THREE.LineSegments(trailGeometry, trailMaterial);
    this.trails.frustumCulled = false;
    this.trails.visible = this.trailsEnabled;
    this.scene.add(this.trails);
  }

  /** Hand the renderer a new set of positions. Cheap: just stores the reference. */
  setPositions(positions: Float32Array): void {
    this.latest = positions;
  }

  private updateTrails(positions: Float32Array, bodyCount: number): void {
    if (!this.trails || !this.trailPositions || !this.trailHistory) return;
    // Skip the work entirely, not just the draw, when trails are off or the
    // user has asked for reduced motion.
    if (!this.trailsEnabled || this.reducedMotion) return;

    // Record the current frame into the ring buffer.
    for (let i = 0; i < bodyCount; i++) {
      const dst = (i * MAX_TRAIL_POINTS + this.trailCursor) * 3;
      this.trailHistory[dst] = positions[i * 3];
      this.trailHistory[dst + 1] = positions[i * 3 + 1];
      this.trailHistory[dst + 2] = positions[i * 3 + 2];
    }
    this.trailCursor = (this.trailCursor + 1) % MAX_TRAIL_POINTS;
    if (this.trailFilled < MAX_TRAIL_POINTS) this.trailFilled++;

    // Rebuild the segment list from the ring buffer, oldest to newest.
    let out = 0;
    for (let i = 0; i < bodyCount; i++) {
      for (let s = 0; s < this.trailFilled - 1; s++) {
        const aIdx =
          (this.trailCursor - this.trailFilled + s + MAX_TRAIL_POINTS * 2) %
          MAX_TRAIL_POINTS;
        const bIdx = (aIdx + 1) % MAX_TRAIL_POINTS;
        const a = (i * MAX_TRAIL_POINTS + aIdx) * 3;
        const b = (i * MAX_TRAIL_POINTS + bIdx) * 3;
        this.trailPositions[out++] = this.trailHistory[a];
        this.trailPositions[out++] = this.trailHistory[a + 1];
        this.trailPositions[out++] = this.trailHistory[a + 2];
        this.trailPositions[out++] = this.trailHistory[b];
        this.trailPositions[out++] = this.trailHistory[b + 1];
        this.trailPositions[out++] = this.trailHistory[b + 2];
      }
    }
    // Collapse any unused tail so stale segments are not drawn.
    this.trailPositions.fill(0, out);
    const attribute = this.trails.geometry.getAttribute("position");
    attribute.needsUpdate = true;
  }

  private renderFrame = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    if (this.lastFrameAt !== 0) this.frameMs = now - this.lastFrameAt;
    this.lastFrameAt = now;

    const positions = this.latest;
    if (positions && this.bodies) {
      const bodyCount = Math.min(this.meta.length, Math.floor(positions.length / 3));

      for (let i = 0; i < bodyCount; i++) {
        const k = i * 3;
        this.dummy.position.set(positions[k], positions[k + 1], positions[k + 2]);
        const r = this.meta[i].radius;
        this.dummy.scale.setScalar(r);
        this.dummy.updateMatrix();
        this.bodies.setMatrixAt(i, this.dummy.matrix);
      }
      this.bodies.count = bodyCount;
      this.bodies.instanceMatrix.needsUpdate = true;

      this.updateTrails(positions, bodyCount);
    }

    const d = this.targetDistance;
    const cosE = Math.cos(this.elevation);
    this.camera.position.set(
      d * cosE * Math.cos(this.azimuth),
      d * Math.sin(this.elevation),
      d * cosE * Math.sin(this.azimuth),
    );
    this.camera.lookAt(0, 0, 0);
    // Keep the near plane sane across the enormous scale range we support.
    this.camera.near = Math.max(1e-7, d * 1e-4);
    this.camera.far = Math.max(10, d * 1000);
    this.camera.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);
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
    if (this.bodies) {
      this.scene.remove(this.bodies);
      this.bodies.geometry.dispose();
      (this.bodies.material as THREE.Material).dispose();
      this.bodies.dispose();
      this.bodies = null;
    }
    if (this.trails) {
      this.scene.remove(this.trails);
      this.trails.geometry.dispose();
      (this.trails.material as THREE.Material).dispose();
      this.trails = null;
    }
    this.trailPositions = null;
    this.trailHistory = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.disposeBodies();
    this.renderer.dispose();
  }
}
