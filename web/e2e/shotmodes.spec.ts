import { test } from "@playwright/test";

// On-demand screenshots of the analysis/graph modes + the earlier 3-D view (SHOTS=1),
// to prove they still live alongside the new Arena. Captures populated visuals.
test.describe("mode shots", () => {
  test.skip(!process.env.SHOTS, "screenshot capture — run with SHOTS=1");
  const shot = (p: string) => `../docs/media/screens/mode_${p}.png`;

  test("montecarlo P_k panel", async ({ page }) => {
    await page.goto("/montecarlo");
    await page.getByRole("button", { name: "1,000", exact: true }).click();
    await page.getByRole("button", { name: /Run 1,000/ }).click();
    await page.getByText("Probability of kill").waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot("montecarlo"), fullPage: true });
  });

  test("tracker EKF/IMM", async ({ page }) => {
    await page.goto("/tracker");
    await page.getByRole("heading", { name: /Tracker in the Loop/i }).waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot("tracker"), fullPage: true });
  });

  test("compare two laws", async ({ page }) => {
    await page.goto("/compare");
    await page.getByRole("button", { name: /Relaunch both/i }).waitFor();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("compare"), fullPage: true });
  });

  test("threed orbit engagement", async ({ page }) => {
    await page.goto("/threed");
    await page.locator("canvas").first().waitFor();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: shot("threed") });
  });

  test("watch telemetry", async ({ page }) => {
    await page.goto("/play");
    const launch = page.getByRole("button", { name: /Launch/ }).first();
    if (await launch.isVisible().catch(() => false)) await launch.click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: shot("watch"), fullPage: true });
  });

  test("arena battery flyby", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/arena");
    await page.getByRole("button", { name: "Desert Canyon" }).click();
    await page.getByRole("button", { name: /Launch engagement/ }).click();
    const gotit = page.getByRole("button", { name: /Got it/ });
    if (await gotit.isVisible().catch(() => false)) await gotit.click();
    // nose down (ArrowUp = pitch down here) and descend toward the front battery
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(1500);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(4200);
    await page.screenshot({ path: shot("battery") });
  });

  test("storm salvo", async ({ page }) => {
    await page.goto("/storm");
    await page.getByRole("button", { name: /Volley/i }).click();
    await page.getByText(/P_k =/).waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("storm"), fullPage: true });
  });
});
