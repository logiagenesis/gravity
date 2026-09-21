import { test, expect } from "@playwright/test";

test.describe("catalogue", () => {
  test("loads and lists scenarios", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Scenarios", level: 1 }),
    ).toBeVisible();
    const count = page.getByTestId("result-count");
    await expect(count).toContainText(/\d+ scenarios/);
    await expect(page.getByRole("article")).not.toHaveCount(0);
  });

  test("search narrows the results", async ({ page }) => {
    await page.goto("/");
    const before = await page.getByRole("article").count();

    await page.getByRole("searchbox", { name: "Search" }).fill("jupiter");
    await expect(page.getByTestId("result-count")).toContainText("matching");

    const after = await page.getByRole("article").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await expect(page.getByRole("article").first()).toContainText(/Jupiter/i);
  });

  test("reports honestly when nothing matches", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search" }).fill("zzzznotathing");
    await expect(page.getByText(/Nothing matched/)).toBeVisible();
  });

  test("filters by category and can clear them", async ({ page }) => {
    await page.goto("/");
    const before = await page.getByRole("article").count();

    await page.getByLabel("choreographies").check();
    const filtered = await page.getByRole("article").count();
    expect(filtered).toBeLessThan(before);

    await page.getByRole("button", { name: /Clear \d+ filter/ }).click();
    await expect(page.getByRole("article")).toHaveCount(before);
  });

  test("opens a scenario", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "The Sun and the Earth" }).click();
    await expect(
      page.getByRole("heading", { name: "The Sun and the Earth", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/scenario\/sun-and-earth/);
  });
});
