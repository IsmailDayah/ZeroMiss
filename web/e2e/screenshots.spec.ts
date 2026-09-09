/**
 * Capture marketing/docs screenshots of the new modes from the live build.
 * Run on demand:  npx playwright test e2e/screenshots.spec.ts --project=chromium
 * (Not part of the standard E2E gate; produces docs/media/screens/*.png.)
 */
import { expect, test } from "@playwright/test";

const DIR = "../docs/media/screens";

// Capture tool, not a gate: only runs when SHOTS=1 (otherwise skipped in CI/E2E).
test.describe("screenshots", () => {
  test.skip(!process.env.SHOTS, "screenshot capture — run with SHOTS=1");
  test.describe.configure({ mode: "serial" });

test("shot: live Monte-Carlo", async ({ page }) => {
  await page.goto("/montecarlo");
  await page.getByRole("button", { name: "1,000", exact: true }).click();
  await page.getByRole("button", { name: /Run 1,000/ }).click();
  await expect.poll(async () => page.getByTestId("mc-runs").textContent(), { timeout: 30_000 }).toMatch(/1,000\s+of 1,000/);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/montecarlo.png` });
});

test("shot: tracker", async ({ page }) => {
  await page.goto("/tracker");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/tracker.png` });
});

test("shot: 3-D view", async ({ page }) => {
  await page.goto("/threed");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/threed.png` });
});

test("shot: watch stage", async ({ page }) => {
  await page.goto("/play");
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${DIR}/watch.png` });
});
});
