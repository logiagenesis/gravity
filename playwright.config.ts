import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Some sandboxes ship a pre-installed Chromium whose build number does not
 * match the one this Playwright release expects, and cannot download another.
 * When that is the case, point Playwright at the browser that IS present.
 * CI installs its own browser, so this resolves to undefined there and the
 * managed download is used as normal.
 */
const PRESET_CHROMIUM = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(
  (candidate) => existsSync(candidate),
);

const launchOptions = PRESET_CHROMIUM ? { executablePath: PRESET_CHROMIUM } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL: "http://127.0.0.1:4173", trace: "on-first-retry" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], launchOptions },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run preview",
    // Must match the address `npm run preview` binds to. Vite's default
    // "localhost" can resolve to ::1 while this poll targets IPv4, in which
    // case the server never looks ready and the wait times out.
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Surface the server's own output, so a startup failure shows the reason
    // rather than only a timeout.
    stdout: "pipe",
    stderr: "pipe",
  },
});
