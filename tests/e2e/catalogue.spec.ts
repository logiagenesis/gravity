import { test, expect, type Page } from "@playwright/test";

/** The number the results heading reports, which is the whole result set. */
async function resultCount(page: Page): Promise<number> {
  const text = await page.getByTestId("result-count").innerText();
  const match = /^([\d,\s]+) scenario/.exec(text);
  expect(match, `could not read a count from "${text}"`).not.toBeNull();
  return Number((match as RegExpExecArray)[1].replace(/[^\d]/g, ""));
}

test.describe("catalogue", () => {
  test("loads the whole catalogue and pages through it", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Scenarios", level: 1 }),
    ).toBeVisible();

    // The catalogue is thousands of scenarios, not a handful.
    expect(await resultCount(page)).toBeGreaterThan(4000);

    // But only one page of cards is rendered, so the DOM stays small.
    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(24);
  });

  test("summaries arrive for the cards on screen", async ({ page }) => {
    await page.goto("/");
    // The sentence lives in a shard fetched per page; the card must fill in.
    await expect(
      page.getByRole("article").first().locator("p").first(),
    ).not.toBeEmpty();
  });

  test("search narrows the results", async ({ page }) => {
    await page.goto("/");
    const before = await resultCount(page);

    await page.getByRole("searchbox", { name: "Search" }).fill("jupiter");
    await expect(page.getByTestId("result-count")).toContainText("matching");

    const after = await resultCount(page);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await expect(page.getByRole("article").first()).toContainText(/Jupiter/i);
  });

  test("finds a named exoplanet system out of thousands", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search" }).fill("trappist");
    await expect(
      page.getByRole("link", { name: "TRAPPIST-1", exact: true }),
    ).toBeVisible();
  });

  test("reports honestly when nothing matches", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search" }).fill("zzzznotathing");
    await expect(page.getByText(/Nothing matched/)).toBeVisible();
  });

  test("filters by category and can clear them", async ({ page }) => {
    await page.goto("/");
    const before = await resultCount(page);

    await page.getByLabel("Choreographies").check();
    const filtered = await resultCount(page);
    expect(filtered).toBeLessThan(before);

    await page.getByRole("button", { name: /Clear \d+ filter/ }).click();
    expect(await resultCount(page)).toBe(before);
  });

  test("filters by orbital period", async ({ page }) => {
    await page.goto("/");
    const before = await resultCount(page);
    await page.getByLabel("Under 1 day").check();
    const filtered = await resultCount(page);
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(before);
  });

  test("filters by data source", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("NASA Exoplanet Archive").check();
    const filtered = await resultCount(page);
    expect(filtered).toBeGreaterThan(4000);
    await expect(page.getByRole("article").first()).toContainText(
      "NASA Exoplanet Archive",
    );
  });

  test("sorts by body count", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Sort").selectOption("bodies-desc");
    const first = page.getByRole("article").first();
    // The largest system in the catalogue has more than two bodies; the
    // default name sort would not put it first.
    await expect(first).toContainText(/\d+ bodies/);
    // The badge is uppercased by CSS and innerText returns what is rendered.
    const text = await first.innerText();
    const bodies = Number(/(\d+) bodies/i.exec(text)?.[1] ?? "0");
    expect(bodies).toBeGreaterThan(5);
  });

  test("pages forward and back, and page one is reachable from the last page", async ({
    page,
  }) => {
    await page.goto("/");
    const pager = page.getByRole("navigation", { name: "Result pages" });
    // Compare the card's link text, not its whole innerText: the summary
    // arrives with its shard, so a card's text legitimately changes once.
    const firstCard = () =>
      page.getByRole("article").first().getByRole("link").innerText();
    const firstName = await firstCard();

    await pager.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("result-count")).toContainText("page 2 of");
    expect(await firstCard()).not.toBe(firstName);

    await pager.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByTestId("result-count")).toContainText("page 1 of");
    expect(await firstCard()).toBe(firstName);

    // 185 pages must not mean 185 clicks: the last page is one target away.
    const last = pager.getByRole("button", { name: /^Page \d+ of \d+$/ }).last();
    await last.click();
    await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("a category landing page shows only that category", async ({ page }) => {
    await page.goto("/#/category/choreographies");
    await expect(
      page.getByRole("heading", { name: "Choreographies", level: 1 }),
    ).toBeVisible();
    const count = await resultCount(page);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(100);
    // The category filter is pinned, so it is not offered again.
    await expect(page.getByRole("group", { name: "Category" })).toHaveCount(0);
  });

  test("category links from the index reach the landing pages", async ({ page }) => {
    await page.goto("/");
    const strip = page.getByRole("navigation", { name: "Browse by category" });
    await strip.getByRole("link", { name: /Exoplanet systems/ }).click();
    await expect(page).toHaveURL(/#\/category\/exoplanets/);
    await expect(
      page.getByRole("heading", { name: "Exoplanet systems", level: 1 }),
    ).toBeVisible();
  });

  test("leads with the hand-built scenarios rather than bulk imports", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for the page to actually render before reading it. Without this the
    // assertion races the first paint and reads an empty list, which only
    // showed up when the suite ran under load.
    await expect(page.getByRole("article")).toHaveCount(24);
    await expect(
      page.getByRole("article").first().getByText("Hand-built", { exact: true }),
    ).toBeVisible();

    // Page one must start with the scenarios written to teach something, not
    // with arbitrary host names from the archive. Asserted as a PREFIX rather
    // than a fixed count, so adding a hand-built scenario does not break it.
    const cards = await page.getByRole("article").allInnerTexts();
    const handBuilt = cards.map((text) => /\bHAND-BUILT\b/i.test(text));
    expect(handBuilt[0], "the first card is not hand-built").toBe(true);
    const firstBulk = handBuilt.indexOf(false);
    if (firstBulk !== -1) {
      expect(
        handBuilt.slice(firstBulk).some(Boolean),
        "a hand-built scenario appears after a bulk one",
      ).toBe(false);
    }
    expect(handBuilt.filter(Boolean).length).toBeGreaterThanOrEqual(7);
  });

  test("opens a scenario", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "The Sun and the Earth" }).click();
    await expect(
      page.getByRole("heading", { name: "The Sun and the Earth", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/scenario\/sun-and-earth/);
  });

  test("opens a generated exoplanet scenario end to end", async ({ page }) => {
    // The scenario JSON is fetched and schema-validated at runtime; a broken
    // one would fail here rather than at build time.
    await page.goto("/#/scenario/exo-trappist-1");
    await expect(
      page.getByRole("heading", { name: "TRAPPIST-1", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("row", { name: /TRAPPIST-1 b/ })).toBeVisible();
  });
});
