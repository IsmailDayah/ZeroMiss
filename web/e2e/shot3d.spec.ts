import { test } from "@playwright/test";

// On-demand 3-D screenshot capture (SHOTS=1). Lets a barrel-roll engagement play out so
// the out-of-plane trajectory is visible, then captures it.
test.describe("3d shot", () => {
  test.skip(!process.env.SHOTS, "screenshot capture — run with SHOTS=1");
  test("shot: true 3-D climbing break", async ({ page }) => {
    await page.goto("/threed");
    await page.getByRole("button", { name: "Climbing break" }).click();
    await page.waitForTimeout(5500); // play to near-intercept so the full climb arc shows
    await page.screenshot({ path: "../docs/media/screens/threed.png" });
  });
});
