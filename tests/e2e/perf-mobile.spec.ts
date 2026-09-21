/**
 * Performance baseline measurement.
 *
 * Deliberately measures rather than asserts. Budgets are set only AFTER a
 * baseline exists on named hardware, per
 * artifacts/05-product-and-technical-spec.md §12. The single assertion here is
 * a very loose sanity floor so this cannot silently become a no-op.
 */
import { test, expect } from "@playwright/test";
import { DETAIL_LEVEL_STORAGE_KEY } from "../../src/ui/detail-level";

const SCENARIOS = [
  { id: "sun-and-earth", label: "Sun + Earth", bodies: 2 },
  { id: "inner-solar-system", label: "Inner solar system", bodies: 5 },
  { id: "jupiter-trojan-points", label: "Jupiter trojans", bodies: 4 },
  { id: "three-body-chaos", label: "Three-body chaos", bodies: 3 },
];

test("measure baseline", async ({ page, browserName }) => {
  test.setTimeout(180_000);
  const rows: string[] = [];

  // The worker and frame timings are shown at the most detailed level only.
  // Set it before the app loads rather than clicking through a phone-sized
  // panel on every scenario.
  await page.addInitScript(
    ([key, level]) => {
      try {
        localStorage.setItem(key, level);
      } catch {
        // A browser that refuses storage will report "—" and the sanity
        // floor below will catch it, which is the right failure.
      }
    },
    [DETAIL_LEVEL_STORAGE_KEY, "advanced"] as const,
  );

  const ua = await page.evaluate(() => navigator.userAgent).catch(() => "");

  for (const scenario of SCENARIOS) {
    await page.goto(`/#/scenario/${scenario.id}`);
    await page.getByRole("img", { name: /3D view of/ }).waitFor();
    // The details panel is closed by default at phone width.
    const diagnostics = page.getByRole("tab", { name: "Diagnostics" });
    if (!(await diagnostics.isVisible())) {
      await page.getByRole("button", { name: /Show details panel/ }).click();
    }
    await diagnostics.click();
    await page.getByRole("button", { name: "Play" }).click();

    // Let it reach steady state before sampling.
    await page.waitForTimeout(3000);

    const read = async (rowName: RegExp): Promise<string> => {
      const text = await page.getByRole("row", { name: rowName }).innerText();
      return text.split("\t").pop()?.trim() ?? text;
    };

    const workerMs = await read(/Worker step time/);
    const frameMs = await read(/Render frame time/);
    const steps = await read(/Steps taken/);
    const drift = await read(/Energy drift/);

    // Measure real frame time independently of the HUD.
    const measured = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const samples: number[] = [];
          let last = performance.now();
          let frames = 0;
          const tick = () => {
            const now = performance.now();
            samples.push(now - last);
            last = now;
            if (++frames < 90) requestAnimationFrame(tick);
            else {
              samples.sort((a, b) => a - b);
              resolve(samples[Math.floor(samples.length / 2)]);
            }
          };
          requestAnimationFrame(tick);
        }),
    );

    rows.push(
      `| ${scenario.label} | ${scenario.bodies} | ${workerMs} | ${frameMs} | ${measured.toFixed(1)} ms | ${steps} | ${drift} |`,
    );

    expect(measured).toBeGreaterThan(0);
  }

  console.log("\n=== PERFORMANCE BASELINE ===");
  console.log(`browser: ${browserName}`);
  console.log(`userAgent: ${ua}`);
  console.log(
    "| Scenario | Bodies | Worker step (HUD) | Frame (HUD) | Frame (median, 90 samples) | Steps in ~3 s | Energy drift |",
  );
  console.log("|---|---|---|---|---|---|---|");
  for (const row of rows) console.log(row);
  console.log("=== END BASELINE ===\n");
});
