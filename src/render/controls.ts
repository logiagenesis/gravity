/**
 * Pointer and touch camera controls.
 *
 * Written rather than pulled from three's OrbitControls because the camera
 * model here is deliberately simple (azimuth / elevation / distance about a
 * target) and because the gesture contract is a product requirement:
 *
 *   one finger  → orbit
 *   two fingers → pinch zoom and pan
 *   wheel       → zoom
 *   drag + shift or middle button → pan
 *
 * Uses Pointer Events so mouse, touch and pen share one code path, and sets
 * `touch-action: none` on the canvas so the browser does not steal the gesture.
 */

export interface CameraControlTarget {
  orbitCamera(deltaAzimuth: number, deltaElevation: number): void;
  zoomCamera(factor: number): void;
  panCamera(deltaX: number, deltaY: number): void;
}

/** Radians of orbit per pixel dragged. */
const ORBIT_SENSITIVITY = 0.0065;
/** Zoom factor per wheel notch. */
const WHEEL_ZOOM = 1.12;

interface ActivePointer {
  x: number;
  y: number;
}

export class CameraControls {
  private canvas: HTMLCanvasElement;
  private target: CameraControlTarget;
  private pointers = new Map<number, ActivePointer>();
  private lastPinchDistance = 0;
  private lastPinchCentre: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, target: CameraControlTarget) {
    this.canvas = canvas;
    this.target = target;

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  private onContextMenu = (event: Event): void => {
    // Right-drag is a pan gesture; suppress the menu so it is usable.
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.lastPinchDistance = this.pinchDistance();
      this.lastPinchCentre = this.pinchCentre();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 1) {
      // Shift or middle/right button pans; otherwise orbit.
      const panning = event.shiftKey || event.buttons === 4 || event.buttons === 2;
      if (panning) this.target.panCamera(dx, dy);
      else this.target.orbitCamera(-dx * ORBIT_SENSITIVITY, dy * ORBIT_SENSITIVITY);
      return;
    }

    if (this.pointers.size === 2) {
      const distance = this.pinchDistance();
      const centre = this.pinchCentre();

      if (this.lastPinchDistance > 0 && distance > 0) {
        // Pinching apart zooms in, so the distance factor is inverted.
        this.target.zoomCamera(this.lastPinchDistance / distance);
      }
      if (this.lastPinchCentre) {
        this.target.panCamera(
          centre.x - this.lastPinchCentre.x,
          centre.y - this.lastPinchCentre.y,
        );
      }
      this.lastPinchDistance = distance;
      this.lastPinchCentre = centre;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) {
      this.lastPinchDistance = 0;
      this.lastPinchCentre = null;
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    // Without preventDefault the page scrolls instead of the scene zooming.
    event.preventDefault();
    this.target.zoomCamera(event.deltaY > 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchCentre(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.pointers.clear();
  }
}
