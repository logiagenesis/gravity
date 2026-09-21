import { test, expect } from "@playwright/test";
import { openTab } from "./helpers";
import { readFile } from "node:fs/promises";

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

  test("a scenario's own camera target is honoured on load", async ({ page }) => {
    // `camera.target` was in the schema and validated against the body ids
    // from the start, but nothing read it, so every scenario opened framed on
    // the origin. "Webb at L2" made that obvious: it opened looking at the Sun
    // from 0.05 AU away.
    await page.goto("/#/scenario/jwst-at-l2");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Webb");
    await openTab(page, "Bodies");
    await expect(
      page.getByRole("button", { name: "Earth", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // And nothing else is being followed.
    await expect(
      page.getByRole("button", { name: "Sun", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("a scenario without a camera target follows nothing", async ({ page }) => {
    await page.goto("/#/scenario/figure-eight-choreography");
    // beforeEach loaded a different scenario, so wait for this one to arrive
    // before touching the panel.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Figure-Eight");
    await openTab(page, "Bodies");
    await expect(
      page.getByRole("button", { name: "Body A", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("switches the contact mode and states which law it obeys", async ({ page }) => {
    await openTab(page, "View");
    const picker = page.getByLabel("On contact");
    await expect(picker).toHaveValue("merge");
    await expect(page.getByText(/Kinetic energy DROPS/)).toBeVisible();

    await picker.selectOption("elastic");
    await expect(
      page.getByText(/Momentum and kinetic energy are both conserved/),
    ).toBeVisible();

    await picker.selectOption("pass-through");
    await expect(page.getByText(/bodies fall through each other/)).toBeVisible();
  });

  test("warns when the timestep cannot resolve the fastest orbit", async ({ page }) => {
    // A simulator that quietly returns a smooth, wrong answer is worse than
    // one that says it is struggling.
    await openTab(page, "View");
    const timestep = page.getByLabel(/Timestep/);
    await timestep.fill("400");
    await timestep.blur();

    await openTab(page, "Diagnostics");
    const warnings = page.getByRole("list", {
      name: "Warnings about this simulation",
    });
    await expect(warnings.getByText(/steps per orbit/).first()).toBeVisible();
    // And it says what to DO, not only that something is wrong.
    await expect(warnings.getByText(/Reduce the timestep/)).toBeVisible();
  });

  test("shows no warnings on a healthy run", async ({ page }) => {
    await openTab(page, "Diagnostics");
    await expect(
      page.getByRole("list", { name: "Warnings about this simulation" }),
    ).toHaveCount(0);
  });

  test("saves the view as a PNG captioned with its citation", async ({ page }) => {
    // An image of a simulation shared without saying where its data came from
    // is exactly the unsourced claim this project exists not to make, so the
    // citation is composited into the file rather than left to the sharer.
    await openTab(page, "Share");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save image" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("sun-and-earth.png");

    const path = await file.path();
    const bytes = await readFile(path);
    // A real PNG, not an empty or truncated one. The WebGL context has no
    // preserveDrawingBuffer, so a naive capture would produce a blank image.
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  test("charts the conservation errors over time", async ({ page }) => {
    await openTab(page, "Diagnostics");
    // Before anything has run there is nothing to plot, and it says so rather
    // than drawing an empty box.
    await expect(
      page.getByText("Press play to start recording.").first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Play" }).click();
    const chart = page.getByRole("img", { name: /Relative energy error over time/ });
    await expect(chart).toBeVisible({ timeout: 10_000 });
    // The label carries the current value, so the chart is readable without
    // being able to see the shape.
    await expect(chart).toHaveAttribute("aria-label", /Currently \d/);

    await expect(
      page.getByRole("img", { name: /Relative angular momentum error over time/ }),
    ).toBeVisible();
  });

  test("shows the z column only when something is out of the plane", async ({
    page,
  }) => {
    // The panel is 392px wide at every viewport and five numeric columns do
    // not fit, so a column of zeros used to cost the information in x and y.
    await openTab(page, "Bodies");
    await expect(page.getByRole("columnheader", { name: "z" })).toHaveCount(0);
    await expect(page.getByText(/Every body is in the z = 0 plane/)).toBeVisible();

    // The real ephemerides are not coplanar, and there it appears.
    await page.goto("/#/scenario/solar-system-epoch");
    // Wait for the simulator itself, not just the heading: the heading renders
    // before the panel exists, and openTab then raced it.
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await openTab(page, "Bodies");
    await expect(page.getByRole("columnheader", { name: "z" })).toBeVisible();
    await expect(page.getByText(/Every body is in the z = 0 plane/)).toHaveCount(0);
  });
});
