/**
 * Accessibility tests.
 *
 * axe catches a useful subset of WCAG failures automatically. It cannot catch
 * everything, so the keyboard-only tests below check the things axe cannot:
 * that the product is actually OPERABLE without a mouse, which is the failure
 * mode found in the audit — controls were <div>s with no role, no tabindex and
 * no accessible name, so a keyboard user could not start or stop a simulation
 * at all (artifacts/03-current-site-audit.md §10.2).
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG).analyze();
}

test.describe("automated accessibility", () => {
  test("catalogue has no detectable violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("simulator has no detectable violations", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    await expect(page.getByRole("img", { name: /3D view of/ })).toBeVisible();
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });

  test("about and privacy pages have no detectable violations", async ({ page }) => {
    for (const route of ["/#/about", "/#/privacy"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await scan(page);
      expect(results.violations, `violations on ${route}`).toEqual([]);
    }
  });

  test("saved page has no detectable violations", async ({ page }) => {
    await page.goto("/#/saved");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await scan(page);
    expect(results.violations).toEqual([]);
  });
});

test.describe("keyboard-only operation", () => {
  test("a skip link is the first thing a keyboard user reaches", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toBeFocused();
  });

  test("the whole simulation can be driven without a mouse", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

    // Reach Play using Tab alone, proving it is in the tab order.
    let reached = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(
        () =>
          document.activeElement?.textContent?.trim() ??
          document.activeElement?.getAttribute("aria-label") ??
          "",
      );
      if (name === "Play") {
        reached = true;
        break;
      }
    }
    expect(reached, "Play must be reachable with Tab alone").toBe(true);

    // And operable with the keyboard.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("space pauses and resumes the simulation", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("tabs follow the ARIA pattern and respond to arrow keys", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    const bodies = page.getByRole("tab", { name: "Bodies" });
    await bodies.click();
    await expect(bodies).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Diagnostics" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Keys" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("Home");
    await expect(bodies).toHaveAttribute("aria-selected", "true");
  });

  test("state changes are announced in a live region", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText(
      "Simulation playing.",
    );
  });
});

test.describe("zoom is not blocked", () => {
  test("the viewport meta does not restrict scaling", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");

    // REGRESSION: the audited v2 shipped maximum-scale=1.0, which fails
    // WCAG 2.2 SC 1.4.4 (Resize Text).
    expect(content).not.toContain("maximum-scale");
    expect(content).not.toContain("user-scalable=no");
    expect(content).toContain("width=device-width");
  });
});

test.describe("no third-party requests", () => {
  test("the page loads nothing from another origin", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4173" && url.protocol !== "data:") {
        external.push(request.url());
      }
    });

    await page.goto("/#/scenario/sun-and-earth");
    await expect(page.getByRole("img", { name: /3D view of/ })).toBeVisible();
    await page.waitForTimeout(1500);

    // No analytics, no ad networks, no CDN fonts. This is a product promise,
    // so it is enforced by a test rather than by intention.
    expect(external).toEqual([]);
  });
});
