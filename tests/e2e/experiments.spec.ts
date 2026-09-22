import { test, expect } from "@playwright/test";
import { openTab } from "./helpers";

/**
 * Guided experiments.
 *
 * The catalogue's integrity — that every experiment names real bodies in a
 * real scenario and inverts exactly — is covered in
 * tests/physics/experiments.test.ts. These check the thing that can only be
 * checked in a browser: that pressing Run actually changes the simulation, and
 * that the learner can get back.
 */
test.describe("guided experiments", () => {
  test("poses the question before offering the button", async ({ page }) => {
    await page.goto("/#/scenario/jupiter-trojan-points");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Experiment");

    const card = page.getByRole("listitem").filter({ hasText: "Remove Jupiter" });
    await expect(card).toContainText("What holds them there");
    await expect(card.getByRole("button", { name: "Run" })).toBeVisible();

    // The answer is present but closed, so it cannot be read by accident on
    // the way to the button.
    const answer = card.getByText(/L4 and L5 points exist only/);
    await expect(answer).toBeHidden();

    await card.getByText("What happens, and why").click();
    await expect(answer).toBeVisible();
  });

  test("running one changes the system, and undo puts it back", async ({ page }) => {
    await page.goto("/#/scenario/jupiter-trojan-points");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Experiment");

    await page
      .getByRole("listitem")
      .filter({ hasText: "Remove Jupiter" })
      .getByRole("button", { name: "Run" })
      .click();

    await expect(page.getByRole("button", { name: "Delete Jupiter" })).toHaveCount(0);
    // It is an ordinary edit, so the run declares itself edited.
    await expect(
      page.getByText(/no longer the scenario its citation describes/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Delete Jupiter" })).toBeVisible();
  });

  test("starts the simulation, because a still picture shows nothing", async ({
    page,
  }) => {
    await page.goto("/#/scenario/earth-and-moon");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Experiment");

    await page
      .getByRole("listitem")
      .filter({ hasText: "Double the Earth's mass" })
      .getByRole("button", { name: "Run" })
      .click();

    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("a relative change is resolved against the live state", async ({ page }) => {
    // "Half the distance" has to mean half of where the Moon is NOW, which is
    // only observable once the thing has been running.
    await page.goto("/#/scenario/earth-and-moon");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Pause" }).click();

    await openTab(page, "Bodies");
    const before = await page.getByRole("row", { name: /Moon/ }).innerText();

    await openTab(page, "Experiment");
    await page
      .getByRole("listitem")
      .filter({ hasText: "Move the Moon to half its distance" })
      .getByRole("button", { name: "Run" })
      .click();
    await page.getByRole("button", { name: "Pause" }).click();

    await openTab(page, "Bodies");
    await expect(page.getByRole("row", { name: /Moon/ })).not.toHaveText(before);
  });

  test("a scenario with no experiments shows none", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-jupiter");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Experiment");
    await expect(page.getByRole("heading", { name: "Try an experiment" })).toHaveCount(
      0,
    );
    // The manual editor is still there: every scenario can be edited.
    await expect(page.getByRole("button", { name: "Add a body" })).toBeVisible();
  });
});
