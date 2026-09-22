import { expect, type Page } from "@playwright/test";

/**
 * Open a panel tab.
 *
 * The simulator presents its controls in an overlay panel, which is open by
 * default at desktop width and collapsed to a bottom sheet on a phone, so a
 * test has to open the right tab first.
 *
 * The wait matters. An earlier version sampled `tab.isVisible()` once and, if
 * false, clicked "Show details panel". Under a loaded suite that sample landed
 * BEFORE either existed, and the test then spent its whole timeout waiting for
 * a button that was never going to appear because the panel was already open.
 * Waiting for one of the two first removes the race.
 */
export async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name });
  const show = page.getByRole("button", { name: /Show details panel/ });
  await expect(tab.or(show).first()).toBeVisible();
  if (!(await tab.isVisible())) await show.click();
  await expect(tab).toBeVisible();
  await tab.click();
  // Assert the click landed: the panel can be mid-transition, and clicking
  // whatever is under the cursor is how this raced in the first place.
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
