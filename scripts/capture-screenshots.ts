/**
 * Capture the milestone screenshots, from the PRODUCTION build.
 *
 * The brief makes looking at the result a gate: no milestone that touches the
 * UI is done until desktop and mobile screenshots have been captured from the
 * built site and actually looked at. Previous milestones did that with ad-hoc
 * scripts, which meant re-inventing the harness each time and no guarantee the
 * shots were taken the same way twice. This is that harness, committed.
 *
 * It drives a server you start yourself rather than starting one, so it
 * captures whatever is being served — `npm run preview` for the local build,
 * or any other origin passed as BASE_URL.
 *
 *   npm run build && npm run preview &
 *   npx tsx scripts/capture-screenshots.ts m6
 *
 * The argument filters by name prefix; with none, every shot is taken.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "artifacts/screenshots");

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";

/**
 * Some sandboxes ship a Chromium that Playwright cannot download a match for.
 * Mirrors playwright.config.ts rather than assuming a managed browser exists.
 */
const PRESET_CHROMIUM = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(
  (candidate) => existsSync(candidate),
);

/** The two viewports the brief names. */
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 393, height: 852 };

interface Shot {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  /** Anything that has to happen before the shot — opening a tab, playing. */
  prepare?: (page: Page) => Promise<void>;
}

/** Open a panel tab by name, opening the panel first if it is collapsed. */
async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name });
  if (!(await tab.isVisible())) {
    await page.getByRole("button", { name: /Show details panel/ }).click();
  }
  await tab.click();
  await page.waitForTimeout(300);
}

const SHOTS: Shot[] = [
  {
    name: "m5-desktop-editor",
    path: "#/scenario/inner-solar-system",
    viewport: DESKTOP,
    prepare: (page) => openTab(page, "Experiment"),
  },
  {
    name: "m5-desktop-editor-add",
    path: "#/scenario/inner-solar-system",
    viewport: DESKTOP,
    prepare: async (page) => {
      await openTab(page, "Experiment");
      await page.getByRole("button", { name: "Add a body" }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: "m5-desktop-editor-rejected",
    path: "#/scenario/inner-solar-system",
    viewport: DESKTOP,
    prepare: async (page) => {
      await openTab(page, "Experiment");
      await page.getByRole("button", { name: "Edit Earth" }).click();
      await page.getByLabel("Radius (AU)").fill("0");
      await page.getByRole("button", { name: "Save" }).click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "m5-desktop-experiments",
    path: "#/scenario/jupiter-trojan-points",
    viewport: DESKTOP,
    prepare: (page) => openTab(page, "Experiment"),
  },
  {
    name: "m5-desktop-experiment-answer",
    path: "#/scenario/earth-and-moon",
    viewport: DESKTOP,
    prepare: async (page) => {
      await openTab(page, "Experiment");
      await page.getByText("What happens, and why").first().click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: "m5-mobile-experiments",
    path: "#/scenario/jupiter-trojan-points",
    viewport: MOBILE,
    prepare: (page) => openTab(page, "Experiment"),
  },
  {
    name: "m5-mobile-editor",
    path: "#/scenario/inner-solar-system",
    viewport: MOBILE,
    prepare: (page) => openTab(page, "Experiment"),
  },
];

async function main(): Promise<void> {
  const filter = process.argv[2];
  const shots = filter ? SHOTS.filter((shot) => shot.name.startsWith(filter)) : SHOTS;
  if (shots.length === 0) {
    console.error(`No shots match "${filter ?? ""}".`);
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(
    PRESET_CHROMIUM ? { executablePath: PRESET_CHROMIUM } : {},
  );

  const problems: string[] = [];
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.viewport });
    // A screenshot of a page that errored is worse than no screenshot: it
    // looks fine until someone reads the console. Collect and report.
    page.on("pageerror", (error) => problems.push(`${shot.name}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        problems.push(`${shot.name}: ${message.text().slice(0, 160)}`);
      }
    });

    await page.goto(`${BASE_URL}/${shot.path}`, { waitUntil: "load" });
    // Wait for the app to render something, not a fixed delay.
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30_000 });
    await shot.prepare?.(page);
    await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
    await page.close();
    console.log(`  ${shot.name}.png  ${shot.viewport.width}x${shot.viewport.height}`);
  }

  await browser.close();

  if (problems.length > 0) {
    console.error(`\n${problems.length} page problem(s) while capturing:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`\n${shots.length} screenshot(s) written to artifacts/screenshots/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
