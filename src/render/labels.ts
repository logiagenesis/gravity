/**
 * Screen-space body labels.
 *
 * DOM elements positioned over the canvas, updated directly from the render
 * loop. Deliberately NOT React state: sixty label updates per second through
 * React would be the exact anti-pattern this whole architecture avoids.
 *
 * They are real DOM text rather than canvas-drawn glyphs, which means they are
 * selectable, zoomable with the page, and inherit the app's font — and, unlike
 * text painted into the canvas, they are visible to a screen reader if it
 * chooses to read them. The authoritative accessible listing remains the
 * Bodies table.
 *
 * Collision avoidance is a greedy pass: labels are placed nearest-first, and
 * one that would overlap an already-placed box is dropped for that frame. That
 * keeps the important (closest) labels legible instead of letting everything
 * overlap into mush.
 */

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelPlacement {
  index: number;
  x: number;
  y: number;
  /** Depth, for nearest-first ordering. */
  depth: number;
  /** The body's apparent radius in CSS pixels, so the label clears its disc. */
  screenRadius: number;
  visible: boolean;
}

export class LabelLayer {
  private container: HTMLElement;
  private elements: HTMLElement[] = [];
  private enabled = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.setAttribute("aria-hidden", "true");
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    this.container.style.display = value ? "" : "none";
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Rebuild the label elements when the body set changes. */
  setLabels(names: readonly string[]): void {
    this.clear();
    for (const name of names) {
      const element = document.createElement("span");
      element.className = "body-label";
      element.textContent = name;
      element.style.display = "none";
      this.container.appendChild(element);
      this.elements.push(element);
    }
  }

  /**
   * Place labels for this frame.
   *
   * @param placements one per body, already projected to screen coordinates
   * @param width  canvas CSS width
   * @param height canvas CSS height
   */
  update(placements: LabelPlacement[], width: number, height: number): void {
    if (!this.enabled) return;

    // Nearest first, so when two labels collide the closer one survives.
    const ordered = [...placements].sort((a, b) => a.depth - b.depth);
    const placed: Box[] = [];

    // Reset everything to hidden; only what we place is shown.
    for (const element of this.elements) element.style.display = "none";

    for (const placement of ordered) {
      const element = this.elements[placement.index];
      if (!element || !placement.visible) continue;

      // Off-screen labels are not worth measuring.
      if (
        placement.x < 0 ||
        placement.y < 0 ||
        placement.x > width ||
        placement.y > height
      ) {
        continue;
      }

      // Approximate the box from the text length: measuring every label every
      // frame would force a layout flush and destroy frame time.
      const textWidth = (element.textContent?.length ?? 4) * 6.6 + 10;
      // Clear the body's own disc, or the label sits on top of a large star.
      const offset = Math.max(8, placement.screenRadius + 7);
      const box: Box = {
        left: placement.x + offset,
        top: placement.y - 8,
        right: placement.x + offset + textWidth,
        bottom: placement.y + 10,
      };

      const overlaps = placed.some(
        (other) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top,
      );
      if (overlaps) continue;

      placed.push(box);
      element.style.display = "";
      element.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
    }
  }

  clear(): void {
    for (const element of this.elements) element.remove();
    this.elements = [];
  }

  dispose(): void {
    this.clear();
  }
}
