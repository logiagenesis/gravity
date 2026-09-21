/**
 * Force-calculation benchmark.
 *
 * Measures where Barnes-Hut actually overtakes the direct O(n²) sum on this
 * machine, so AUTO_BARNES_HUT_THRESHOLD is set from measurement rather than
 * guessed. Also reports the accuracy cost at the chosen opening angle, because
 * a faster method that is wrong is not an improvement.
 *
 * Run: npx tsx scripts/benchmark-forces.ts
 */
import { SimState, type BodyInit } from "../src/sim/state";
import {
  computeAccelerationsDirect,
  computeAccelerationsBarnesHut,
} from "../src/sim/forces";

const THETA = 0.5;
const BODY_COUNTS = [32, 64, 128, 256, 512, 1024, 2048, 4096];

/** Deterministic pseudo-random cloud so runs are comparable. */
function cloud(n: number): BodyInit[] {
  let seed = 987654321;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    name: `b${i}`,
    mass: 0.5 + next(),
    radius: 1e-6,
    position: {
      x: (next() - 0.5) * 40,
      y: (next() - 0.5) * 40,
      z: (next() - 0.5) * 40,
    },
    velocity: { x: 0, y: 0, z: 0 },
  }));
}

function timeIt(run: () => void, minMs = 300): number {
  // Warm up so JIT compilation is not counted.
  for (let i = 0; i < 3; i++) run();
  let iterations = 0;
  const started = performance.now();
  let elapsed = 0;
  do {
    run();
    iterations++;
    elapsed = performance.now() - started;
  } while (elapsed < minMs);
  return elapsed / iterations;
}

function meanRelativeError(
  exact: Float64Array,
  approx: Float64Array,
  n: number,
): number {
  let total = 0;
  let counted = 0;
  for (let i = 0; i < n; i += 3) {
    const ex = exact[i];
    const ey = exact[i + 1];
    const ez = exact[i + 2];
    const magnitude = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (magnitude < 1e-300) continue;
    const dx = approx[i] - ex;
    const dy = approx[i + 1] - ey;
    const dz = approx[i + 2] - ez;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz) / magnitude;
    counted++;
  }
  return counted > 0 ? total / counted : 0;
}

console.log(`node ${process.version} · theta=${THETA}`);
console.log(
  "| Bodies | Direct (ms) | Barnes-Hut (ms) | Speed-up | Mean relative error |",
);
console.log("|---|---|---|---|---|");

let crossover: number | null = null;

for (const n of BODY_COUNTS) {
  const state = SimState.fromBodies(cloud(n));

  const direct = timeIt(() => computeAccelerationsDirect(state, 1, 1e-4));
  computeAccelerationsDirect(state, 1, 1e-4);
  const exact = state.accelerations.slice(0, n * 3);

  const bh = timeIt(() => computeAccelerationsBarnesHut(state, 1, 1e-4, THETA));
  computeAccelerationsBarnesHut(state, 1, 1e-4, THETA);
  const error = meanRelativeError(exact, state.accelerations, n * 3);

  const speedup = direct / bh;
  if (crossover === null && speedup > 1) crossover = n;

  console.log(
    `| ${n} | ${direct.toFixed(3)} | ${bh.toFixed(3)} | ${speedup.toFixed(2)}x | ${error.toExponential(2)} |`,
  );
}

console.log(
  `\nBarnes-Hut first becomes faster at n = ${crossover ?? "never in this range"}.`,
);
