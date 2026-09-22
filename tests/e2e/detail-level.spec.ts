import { test, expect } from "@playwright/test";
import { openTab } from "./helpers";

/**
 * How much of the simulator to show.
 *
 * The setting has to genuinely change what is on screen, and it has to be
 * remembered. The nesting rule — a higher level never shows less — is checked
 * in tests/ui/detail-level.test.ts, where every combination can be covered
 * without a browser.
 */
test.describe("the detail level", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/scenario/inner-solar-system");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("defaults to the diagnostics and the method, but not the numerics", async ({
    page,
  }) => {
    await openTab(page, "Diagnostics");
    await expect(page.getByRole("row", { name: /Energy drift/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Worker step time/ })).toHaveCount(0);

    await openTab(page, "View");
    // The timestep is the most teachable number here and stays in the default.
    await expect(page.getByLabel("Timestep (days)")).toBeVisible();
    await expect(page.getByLabel("Softening (AU)")).toHaveCount(0);
  });

  test("Explore hides the drift readouts and every numerical setting", async ({
    page,
  }) => {
    await openTab(page, "View");
    await page.getByLabel("How much to show").selectOption({ label: "Explore" });

    await expect(page.getByLabel("Timestep (days)")).toHaveCount(0);
    await expect(page.getByLabel("Softening (AU)")).toHaveCount(0);
    await expect(page.getByLabel("Integrator")).toHaveCount(0);
    await expect(page.getByLabel("Reference frame")).toHaveCount(0);
    // But the things a learner acts with are all still there.
    await expect(page.getByLabel("Body size")).toBeVisible();
    await expect(page.getByRole("button", { name: "Trails" })).toBeVisible();

    await openTab(page, "Diagnostics");
    await expect(page.getByRole("row", { name: /Energy drift/ })).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: /Relative energy error over time/ }),
    ).toHaveCount(0);
    // Simulated time is not a numerical setting, so it stays.
    await expect(page.getByRole("row", { name: /Simulated time/ })).toBeVisible();
  });

  test("Full control adds the softening length and the timings", async ({ page }) => {
    await openTab(page, "View");
    await page.getByLabel("How much to show").selectOption({ label: "Full control" });
    await expect(page.getByLabel("Softening (AU)")).toBeVisible();

    await openTab(page, "Diagnostics");
    await expect(page.getByRole("row", { name: /Force method/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Worker step time/ })).toBeVisible();
  });

  test("never hides a warning, whatever the level", async ({ page }) => {
    // Hiding a trustworthiness warning to tidy a beginner's screen would make
    // the simulator lie by omission to the person least able to notice.
    // The timestep is set at the level that exposes it — a classroom would
    // arrive at the same state through a shared link — and then the level is
    // dropped to the one with no numerical settings at all.
    await openTab(page, "View");
    await page.getByLabel("How much to show").selectOption({ label: "Full control" });
    const timestep = page.getByLabel(/Timestep/);
    await timestep.fill("400");
    await timestep.blur();

    const warnings = page.getByRole("list", {
      name: "Warnings about this simulation",
    });
    await openTab(page, "Diagnostics");
    await expect(warnings.getByText(/steps per orbit/).first()).toBeVisible();

    await openTab(page, "View");
    await page.getByLabel("How much to show").selectOption({ label: "Explore" });
    await expect(page.getByLabel(/Timestep/)).toHaveCount(0);

    await openTab(page, "Diagnostics");
    await expect(warnings.getByText(/steps per orbit/).first()).toBeVisible();
    // And it still says what to do about it.
    await expect(warnings.getByText(/Reduce the timestep/)).toBeVisible();
  });

  test("is remembered across a reload", async ({ page }) => {
    await openTab(page, "View");
    await page.getByLabel("How much to show").selectOption({ label: "Full control" });
    await expect(page.getByLabel("Timestep (days)")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "View");
    await expect(page.getByLabel("How much to show")).toHaveValue("advanced");
    await expect(page.getByLabel("Timestep (days)")).toBeVisible();
  });
});
