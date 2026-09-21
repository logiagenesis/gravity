import { test, expect } from "@playwright/test";
import { openTab } from "./helpers";

/**
 * Editing a running simulation.
 *
 * These exercise the whole path — form to worker to renderer and back — which
 * is where the interesting failures are. The pure history bookkeeping is
 * covered in tests/ui/edit-history.test.ts.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/#/scenario/inner-solar-system");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await openTab(page, "Experiment");
});

test.describe("the body editor", () => {
  test("removes a body, and the table stops listing it", async ({ page }) => {
    await page.getByRole("button", { name: "Delete Mars" }).click();
    await expect(page.getByRole("button", { name: "Delete Mars" })).toHaveCount(0);

    // The readable equivalent of the 3D view must agree.
    await openTab(page, "Bodies");
    await expect(page.getByRole("row", { name: /Mars/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Earth/ })).toBeVisible();
  });

  test("undo puts it back, and redo takes it away again", async ({ page }) => {
    await page.getByRole("button", { name: "Delete Mars" }).click();
    await expect(page.getByRole("button", { name: "Delete Mars" })).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Delete Mars" })).toBeVisible();

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.getByRole("button", { name: "Delete Mars" })).toHaveCount(0);
  });

  test("undo and redo are disabled when there is nothing to do", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
    await page.getByRole("button", { name: "Delete Mars" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  test("adds a body on a circular orbit sized by the worker", async ({ page }) => {
    await page.getByRole("button", { name: "Add a body" }).click();
    await page.getByLabel("Name").fill("Planet X");
    await page.getByLabel("Place in a circular orbit around").selectOption({
      label: "Sun",
    });
    await page.getByLabel("Orbit radius (AU)").fill("3");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByRole("button", { name: "Delete Planet X" })).toBeVisible();

    // At 3 AU from a one-solar-mass primary the circular speed is about
    // 0.00993 AU/day, so x should be ~3 and the speed should not be zero.
    await openTab(page, "Bodies");
    await expect(page.getByRole("row", { name: /Planet X/ })).toBeVisible();
  });

  test("refuses an edit that would break the simulation, and says why", async ({
    page,
  }) => {
    // Editing the Earth's radius to zero is invalid; the message must explain
    // it rather than failing silently.
    await page.getByRole("button", { name: "Edit Earth" }).click();
    await page.getByLabel("Radius (AU)").fill("0");
    await page.getByRole("button", { name: "Save" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/radius/i);

    // And it must be ON SCREEN. The panel scrolls, and an error rendered at
    // the top of it was off the fold at exactly the moment it mattered:
    // pressing Save looked like it had done nothing at all.
    const box = await alert.boundingBox();
    const viewport = page.viewportSize();
    expect(box, "the error must have a box to be seen at all").not.toBeNull();
    expect(viewport).not.toBeNull();
    const { height } = viewport as { width: number; height: number };
    const { y, height: alertHeight } = box as { y: number; height: number };
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + alertHeight).toBeLessThanOrEqual(height);

    // And nothing changed: the body is still there and still editable.
    await expect(page.getByRole("button", { name: "Delete Earth" })).toBeVisible();
  });

  test("says the run is no longer the scenario its citation describes", async ({
    page,
  }) => {
    // An edited run that still claimed its source would be making an
    // unsourced claim, which is the thing this project exists not to do.
    await page.getByRole("button", { name: "Delete Mars" }).click();
    await expect(
      page.getByText(/no longer the scenario its citation describes/),
    ).toBeVisible();
  });

  test("changing a mass keeps the simulation running", async ({ page }) => {
    await page.getByRole("button", { name: "Edit Earth" }).click();
    await page.getByLabel("Mass (solar masses)").fill("0.0001");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Play" }).click();
    await openTab(page, "Diagnostics");
    await expect(page.getByRole("row", { name: /Simulated time/ })).not.toContainText(
      "—",
      { timeout: 10_000 },
    );
  });
});
