/**
 * A polite live region.
 *
 * Simulation state changes are visual by nature. This is how a screen-reader
 * user learns that the simulation started, that the integrator changed, or
 * that two bodies merged — none of which is conveyed by a canvas.
 */
interface LiveRegionProps {
  message: string;
}

export function LiveRegion({ message }: LiveRegionProps) {
  return (
    <div
      className="visually-hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
