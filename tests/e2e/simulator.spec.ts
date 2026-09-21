import { test, expect, type Page } from "@playwright/test";

/**
 * Open a panel tab. The simulator now presents its controls in an overlay
 * panel rather than inline, so tests must open the relevant tab first. The
 * panel is open by default at desktop width.
 */
async function openTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name });
  if (!(await tab.isVisible())) {
    await page.getByRole("button", { name: /Show details panel/ }).click();
  }
  await tab.click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#/scenario/sun-and-earth");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Sun and the Earth",
  );
});

test.describe("simulator", () => {
  test("renders a labelled canvas and a readable body table", async ({ page }) => {
    // The canvas must be announced, not silent.
    const canvas = page.getByRole("img", { name: /3D view of/ });
    await expect(canvas).toBeVisible();

    // And the same data must exist as real semantic HTML.
    await expect(page.getByRole("row", { name: /Sun/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Earth/ })).toBeVisible();
  });

  test("plays and pauses", async ({ page }) => {
    const play = page.getByRole("button", { name: "Play" });
    await expect(play).toHaveAttribute("aria-pressed", "false");
    await play.click();

    const pause = page.getByRole("button", { name: "Pause" });
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await pause.click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("advances simulated time while playing", async ({ page }) => {
    await openTab(page, "Diagnostics");
    await page.getByRole("button", { name: "Play" }).click();

    // Simulated time must become non-zero.
    await expect(page.getByRole("row", { name: /Simulated time/ })).not.toContainText(
      "—",
      {
        timeout: 10_000,
      },
    );
    await expect
      .poll(
        async () => {
          const text = await page.getByRole("row", { name: /Steps taken/ }).innerText();
          return Number(text.replace(/[^\d]/g, ""));
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test("changes speed", async ({ page }) => {
    const speed = page.getByLabel("Speed");
    await speed.selectOption("100");
    await expect(speed).toHaveValue("100");
  });

  test("switches integrator and shows its guidance", async ({ page }) => {
    await openTab(page, "View");
    const picker = page.getByLabel("Integrator");
    await picker.selectOption("rk4");
    await expect(picker).toHaveValue("rk4");
    // The trade-off must be stated, not hidden.
    await expect(page.getByText(/NOT symplectic/)).toBeVisible();

    await picker.selectOption("pefrl");
    await expect(page.getByText(/Fourth order and still symplectic/)).toBeVisible();
  });

  test("steps once while paused", async ({ page }) => {
    await openTab(page, "Diagnostics");
    await page.getByRole("button", { name: "Step" }).click();
    await expect
      .poll(async () => {
        const text = await page.getByRole("row", { name: /Steps taken/ }).innerText();
        return Number(text.replace(/[^\d]/g, ""));
      })
      .toBeGreaterThan(0);
  });

  test("resets back to the start", async ({ page }) => {
    await openTab(page, "Diagnostics");
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Reset" }).click();

    await expect
      .poll(async () => {
        const text = await page.getByRole("row", { name: /Steps taken/ }).innerText();
        return Number(text.replace(/[^\d]/g, ""));
      })
      .toBeLessThan(50);
  });

  test("shows conservation diagnostics", async ({ page }) => {
    await openTab(page, "Diagnostics");
    await expect(page.getByRole("row", { name: /Energy drift/ })).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Angular momentum drift/ }),
    ).toBeVisible();
    await expect(page.getByRole("row", { name: /Total energy/ })).toBeVisible();
  });

  test("shows the data source citation", async ({ page }) => {
    await openTab(page, "Source");
    await expect(page.getByText("NASA NSSDCA Planetary Fact Sheet")).toBeVisible();
    await expect(page.getByText(/Idealised coplanar model/)).toBeVisible();
  });

  test("creates a share link that carries the scenario in the fragment", async ({
    page,
  }) => {
    await openTab(page, "Share");
    await page.getByRole("button", { name: "Share link" }).click();
    const input = page.getByLabel("Shareable link");
    await expect(input).toBeVisible();
    const value = await input.inputValue();
    // The payload must be in the fragment, never the query string.
    expect(value).toContain("#/shared/");
    expect(new URL(value).search).toBe("");
  });

  test("a share link round-trips into a working simulation", async ({ page }) => {
    await openTab(page, "Share");
    await page.getByRole("button", { name: "Share link" }).click();
    const shareUrl = await page.getByLabel("Shareable link").inputValue();

    await page.goto(shareUrl);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Sun and the Earth",
    );
    await expect(page.getByRole("row", { name: /Earth/ })).toBeVisible();
  });

  test("rejects a damaged share link with an explanation", async ({ page }) => {
    await page.goto("/#/shared/z:this-is-not-valid-data");
    await expect(page.getByRole("alert")).toContainText(/could not be opened/i);
    await expect(
      page.getByRole("button", { name: /Back to all scenarios/ }),
    ).toBeVisible();
  });

  test("saves a scenario locally and lists it", async ({ page }) => {
    await openTab(page, "Share");
    await page.getByRole("button", { name: "Save locally" }).click();
    await expect(page.getByText("Saved to this browser.")).toBeVisible();

    await page.goto("/#/saved");
    await expect(
      page.getByRole("heading", { name: "The Sun and the Earth" }),
    ).toBeVisible();
  });
});
