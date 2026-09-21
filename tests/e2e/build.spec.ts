import { test, expect } from "@playwright/test";
import { openTab } from "./helpers";

/**
 * Building your own system.
 *
 * The templates' physics is checked in tests/ui/build-templates.test.ts. What
 * only a browser can check is that starting from one lands in a working
 * simulator, and that it is still there after a reload.
 */
test.describe("build your own", () => {
  test("is reachable from the main navigation", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("link", { name: "Build" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Build your own",
    );
    // Three starting points, each explained.
    await expect(page.getByRole("button", { name: "Start from this" })).toHaveCount(3);
  });

  test("says why there is no blank option", async ({ page }) => {
    await page.goto("/#/build");
    await expect(page.getByText(/gravity needs two things/)).toBeVisible();
  });

  test("starting from a template opens a running simulator", async ({ page }) => {
    await page.goto("/#/build");
    await page
      .getByRole("listitem")
      .filter({ hasText: "A star and a planet" })
      .getByRole("button", { name: "Start from this" })
      .click();

    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Bodies");
    await expect(page.getByRole("row", { name: /Star/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Planet/ })).toBeVisible();

    // And it is editable straight away, which is the point of a template.
    await openTab(page, "Experiment");
    await expect(page.getByRole("button", { name: "Add a body" })).toBeVisible();
  });

  test("what you build survives a reload", async ({ page }) => {
    await page.goto("/#/build");
    await page
      .getByRole("listitem")
      .filter({ hasText: "A pair of stars" })
      .getByRole("button", { name: "Start from this" })
      .click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

    // It was saved before it opened, so the address is a real one.
    expect(page.url()).toContain("#/saved/");
    await page.reload();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Bodies");
    await expect(page.getByRole("row", { name: /Star A/ })).toBeVisible();
  });

  test("it is listed under Saved, where someone would look for it", async ({
    page,
  }) => {
    await page.goto("/#/build");
    await page
      .getByRole("listitem")
      .filter({ hasText: "Two bodies, dropped from rest" })
      .getByRole("button", { name: "Start from this" })
      .click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

    await page.goto("/#/saved");
    await expect(page.getByText("Two bodies, dropped from rest")).toBeVisible();
  });

  test("an in-memory scenario explains itself after a reload", async ({ page }) => {
    // #/scratch holds something that was never stored, so arriving at it cold
    // has to say so rather than showing a blank page.
    await page.goto("/#/scratch");
    await expect(page.getByText(/Nothing to show here/)).toBeVisible();
    await page.getByRole("button", { name: "Build another" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Build your own",
    );
  });
});
