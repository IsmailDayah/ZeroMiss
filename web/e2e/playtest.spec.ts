import { expect, test } from "@playwright/test";

// Throwaway QA playtest: actually fly the Arena with inputs, capture console errors,
// and screenshot through to a result. Run: SHOTS=1 npx playwright test e2e/playtest.spec.ts --project=chromium
test.describe("playtest", () => {
  test.skip(!process.env.SHOTS, "manual playtest");

  for (const [veh, theme] of [["F-22 Raptor", "Desert Canyon"], ["DJI Tello", "City Skyline"], ["F-22 Raptor", "Alpine Peaks"], ["F-22 Raptor", "Open Ocean"]]) {
    test(`fly ${veh} @ ${theme}`, async ({ page }) => {
      test.setTimeout(120000); // HDRI + PMREM + bloom make headless page-load heavy
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

      await page.goto("/arena");
      await page.getByRole("button", { name: veh }).click();
      await page.getByRole("button", { name: theme }).click();
      await page.getByRole("button", { name: /Launch engagement/ }).click();
      const gotit = page.getByRole("button", { name: /Got it/ });
      if (await gotit.isVisible().catch(() => false)) await gotit.click();
      await page.getByRole("button", { name: /Engineer overlay/ }).click();

      const box = await page.locator("canvas").first().boundingBox();
      const cx = box ? box.x + box.width / 2 : 640;
      const cy = box ? box.y + box.height / 2 : 360;

      const tag = `${veh.split(" ")[0]}_${theme.split(" ")[0]}`.toLowerCase();
      // fly evasively: weave the mouse, boost, drop flares
      await page.keyboard.down("Shift");
      for (let i = 0; i < 60; i++) {
        const ang = i * 0.4;
        await page.mouse.move(cx + Math.cos(ang) * 220, cy + Math.sin(ang * 1.3) * 150);
        if (i % 12 === 0) await page.keyboard.press(" ");
        if (i === 20) await page.screenshot({ path: `../docs/media/screens/pt_${tag}_mid.png` });
        await page.waitForTimeout(120);
      }
      await page.keyboard.up("Shift");
      // capture whatever state we're in
      await page.screenshot({ path: `../docs/media/screens/pt_${tag}_end.png` });

      // report console errors (non-fatal so we can see all)
      console.log(`[${tag}] console errors (${errors.length}):`, JSON.stringify(errors.slice(0, 8)));
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});
