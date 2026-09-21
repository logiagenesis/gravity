/**
 * Rolling time-series of a conservation error.
 *
 * WHY SVG AND NOT A CHART LIBRARY. The brief allows one "if justified in an
 * ADR", and it is not justified: this draws a single polyline, a log grid and
 * a few markers. Every chart library worth using is tens of kilobytes for
 * axes, legends, tooltips, animation and interaction that this does not want,
 * and the "zero third-party requests" promise and the bundle budget both make
 * that cost real. Fifty lines of SVG has no dependency, no bundle cost and no
 * upgrade treadmill.
 *
 * WHY A LOG SCALE. Drift spans from 1e-16 on a good run to 1e-1 on a bad one.
 * On a linear axis every trustworthy run is a flat line on the floor and the
 * chart says nothing; on a log axis the difference between 1e-12 and 1e-9 is
 * as legible as the difference between 0.1 and 0.4.
 */

export interface DriftSample {
  /** Simulated days at the time of the sample. */
  simDays: number;
  /** Relative error, non-negative. */
  value: number;
  /** True when a merge reset the baseline at this sample. */
  rebaselined: boolean;
}

interface DriftChartProps {
  samples: readonly DriftSample[];
  label: string;
  /** Description for assistive technology, since the shape is not readable. */
  summary: string;
}

/** Decades shown. Anything below 1e-16 is floating-point noise, not signal. */
const MIN_EXPONENT = -16;
const MAX_EXPONENT = 0;
const WIDTH = 100;
const HEIGHT = 34;

/**
 * Half the stroke width, in viewBox units.
 *
 * A value of exactly zero — which is what a single surviving body gives, and
 * what a perfectly conserved run gives — maps to the very bottom edge, where
 * half the stroke falls outside the viewBox and the line looks absent rather
 * than perfect. Insetting by half a stroke keeps "zero" visible as a line on
 * the floor, which is the honest reading.
 */
const STROKE_INSET = 0.75;

function toY(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return HEIGHT - STROKE_INSET;
  const exponent = Math.log10(value);
  const clamped = Math.min(MAX_EXPONENT, Math.max(MIN_EXPONENT, exponent));
  const fraction = (clamped - MIN_EXPONENT) / (MAX_EXPONENT - MIN_EXPONENT);
  return Math.min(
    HEIGHT - STROKE_INSET,
    Math.max(STROKE_INSET, HEIGHT - fraction * HEIGHT),
  );
}

export function DriftChart({ samples, label, summary }: DriftChartProps) {
  if (samples.length < 2) {
    return (
      <figure className="drift-chart drift-chart--empty">
        <figcaption>{label}</figcaption>
        <p className="field-hint">Press play to start recording.</p>
      </figure>
    );
  }

  const step = WIDTH / (samples.length - 1);
  const path = samples
    .map(
      (sample, i) =>
        `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${toY(sample.value).toFixed(2)}`,
    )
    .join(" ");

  const latest = samples[samples.length - 1].value;

  return (
    <figure className="drift-chart">
      <figcaption>
        {label} <span className="drift-chart__now">{latest.toExponential(1)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
      >
        {/* A line per four decades, so the eye has something to measure against. */}
        {[-12, -8, -4].map((exponent) => (
          <line
            key={exponent}
            x1="0"
            x2={WIDTH}
            y1={toY(Math.pow(10, exponent))}
            y2={toY(Math.pow(10, exponent))}
            className="drift-chart__grid"
          />
        ))}
        {/* Where a merge legitimately changed the total energy. Without these
            the step down looks like the integration suddenly improving. */}
        {samples.map((sample, i) =>
          sample.rebaselined ? (
            <line
              key={`reset-${i}`}
              x1={(i * step).toFixed(2)}
              x2={(i * step).toFixed(2)}
              y1="0"
              y2={HEIGHT}
              className="drift-chart__reset"
            />
          ) : null,
        )}
        <path d={path} className="drift-chart__line" />
      </svg>
      <p className="drift-chart__scale" aria-hidden="true">
        1e{MIN_EXPONENT} … 1e{MAX_EXPONENT}
      </p>
    </figure>
  );
}
