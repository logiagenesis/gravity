import { test, expect } from "@playwright/test";

/**
 * The chrome-less embedded view.
 *
 * The parsing is unit-tested; what matters here is that the flag survives the
 * hash router and that nothing load-bearing is stripped along with the chrome.
 */
test.describe("?embed=1", () => {
  test("strips the site header, navigation and footer", async ({ page }) => {
    await page.goto("/?embed=1#/scenario/sun-and-earth");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Scenarios" })).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
  });

  test("keeps the simulation, its controls and its warnings", async ({ page }) => {
    await page.goto("/?embed=1#/scenario/sun-and-earth");
    await expect(page.getByRole("img", { name: /3D view of/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Diagnostics" })).toBeVisible();
    // And the citation, which is the thing an embed must never lose.
    await expect(page.getByRole("tab", { name: "Source" })).toBeVisible();
  });

  test("says what it is, and links out to the full version", async ({ page }) => {
    // A simulation inside someone else's page with no way to tell what it is
    // would be that page presenting this work as its own.
    await page.goto("/?embed=1#/scenario/sun-and-earth");
    const link = page.getByRole("link", { name: /open the full version/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    // It points at this deployment, never a hardcoded domain.
    const href = await link.getAttribute("href");
    expect(href).toContain(new URL(page.url()).origin);
  });

  test("survives navigation inside the frame", async ({ page }) => {
    // The flag is a query parameter precisely so the hash router cannot lose
    // it as the visitor moves around.
    await page.goto("/?embed=1#/");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    await page
      .getByRole("link", { name: /Sun and the Earth/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  });

  test("without the flag, the chrome is all there", async ({ page }) => {
    await page.goto("/#/scenario/sun-and-earth");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("link", { name: /open the full version/ })).toHaveCount(
      0,
    );
  });
});
