import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility audit. Asserts no serious/critical WCAG violations on
 * every route, plus a keyboard-only path through the primary controls.
 *
 * The sweep covers all routes rather than a sample: a control that is missing a
 * label is only caught on the page it lives on.
 */
const PAGES = ["/", "/arena", "/fpv", "/play", "/play?adv=1", "/duel", "/compare",
               "/storm", "/montecarlo", "/tracker", "/threed", "/learn"];

for (const path of PAGES) {
  test(`a11y: ${path} has no serious/critical violations`, async ({ page }) => {
    await page.goto(path);
    // let the first frame paint
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([]);
  });
}

test("keyboard: can reach and toggle a control on /play", async ({ page }) => {
  await page.goto("/play");
  // Tab into the document and find a focused, operable control
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(["A", "BUTTON", "INPUT", "SELECT"]).toContain(active);
  // the overlay toggles expose aria-pressed — operate one with the keyboard
  const bearing = page.getByRole("button", { name: "Bearing" });
  const before = await bearing.getAttribute("aria-pressed");
  // locator.press atomically focuses then keys, robust against the 60fps re-render
  await expect
    .poll(async () => {
      await bearing.press("Enter");
      return bearing.getAttribute("aria-pressed");
    }, { timeout: 8000 })
    .not.toBe(before);
});
