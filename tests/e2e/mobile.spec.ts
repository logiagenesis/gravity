/** Mobile viewport smoke test. Runs under the Pixel 5 project. */
import { test, expect } from "@playwright/test";

test.describe("mobile viewport", () => {
  test("the catalogue is usable and does not scroll sideways", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A couple of pixels of rounding is tolerable; a horizontal scrollbar is not.
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test("a scenario opens and plays on a phone-sized screen", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    await expect(page.getByRole("img", { name: /3D view of/ })).toBeVisible();

    const play = page.getByRole("button", { name: "Play" });
    await expect(play).toBeVisible();

    // Touch targets must be large enough to hit reliably.
    const box = await play.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);

    await play.click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("the simulator does not scroll sideways", async ({ page }) => {
    await page.goto("/#/scenario/inner-solar-system");
    await expect(page.getByRole("img", { name: /3D view of/ })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
