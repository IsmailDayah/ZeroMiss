import { test } from "@playwright/test";

// On-demand Arena screenshots (SHOTS=1).
test.describe("arena shots", () => {
  test.skip(!process.env.SHOTS, "screenshot capture — run with SHOTS=1");

  // showcase the F-22 in most biomes, but fly the DJI Tello over the city (drone-over-city)
  for (const theme of ["Desert Canyon", "City Skyline", "Alpine Peaks", "Open Ocean"]) {
    test(`shot: arena ${theme}`, async ({ page }) => {
      await page.goto("/arena");
      if (theme === "City Skyline") await page.getByRole("button", { name: "DJI Tello" }).click();
      await page.getByRole("button", { name: theme }).click();
      await page.getByRole("button", { name: /Launch engagement/ }).click();
      const gotit = page.getByRole("button", { name: /Got it/ });
      if (await gotit.isVisible().catch(() => false)) await gotit.click();
      // turn on the engineer overlay so the shot shows the minimap + tactical PiP too
      await page.getByRole("button", { name: /Engineer overlay/ }).click();
      await page.waitForTimeout(3500); // let the scene render + missile close in
      await page.screenshot({ path: `../docs/media/screens/arena_${theme.split(" ")[0].toLowerCase()}.png` });
    });
  }
});
