import { expect, test } from "@playwright/test";

test.describe("ZeroMiss app", () => {
  test("home loads with hero + mode cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/collide/i);
    await expect(page.getByRole("link", { name: "Watch", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "▶ Play the Arena" })).toBeVisible();
  });

  test("Watch: launch reaches a verdict", async ({ page }) => {
    await page.goto("/play");
    // autoplays; a verdict card (role=status) appears at closest approach
    await expect(page.getByRole("status")).toContainText(/HIT|MISS/, { timeout: 40_000 });
    await expect(page.getByText(/seed/i).first()).toBeVisible();
  });

  test("Sandbox exposes tuning controls", async ({ page }) => {
    await page.goto("/play?adv=1");
    await expect(page.getByText("Navigation constant N")).toBeVisible();
    await expect(page.getByText("Guidance").first()).toBeVisible();
  });

  test("Duel: launch then resolve", async ({ page }) => {
    await page.goto("/duel");
    await page.getByRole("button", { name: /Launch interceptor/i }).click();
    await expect(page.getByText(/YOU ESCAPED|INTERCEPTED/)).toBeVisible({ timeout: 40_000 });
  });

  test("Compare shows two synchronized stages", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("button", { name: /Relaunch both/i })).toBeVisible();
    const stages = page.getByRole("img", { name: "Interception stage" });
    await expect(stages).toHaveCount(2);
  });

  test("Storm runs a volley", async ({ page }) => {
    await page.goto("/storm");
    await page.getByRole("button", { name: /Volley/i }).click();
    await expect(page.getByText(/P_k =/)).toBeVisible({ timeout: 40_000 });
  });

  test("replay/<seed> reconstructs a known run", async ({ page }) => {
    await page.goto("/replay/7");
    await expect(page.getByText("seed 7")).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/HIT|MISS/, { timeout: 40_000 });
  });

  test("learn page teaches the idea", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: /frisbees to missiles/i })).toBeVisible();
  });

  test("live Monte-Carlo forms a P_k", async ({ page }) => {
    await page.goto("/montecarlo");
    await page.getByRole("button", { name: "1,000", exact: true }).click();
    await page.getByRole("button", { name: /Run 1,000/ }).click();
    await expect(page.getByText("Probability of kill")).toBeVisible();
    // run completes: the Runs counter reaches the target
    await expect.poll(async () => page.getByTestId("mc-runs").textContent(), {
      timeout: 30_000,
    }).toMatch(/1,000\s+of 1,000/);
    // a P_k between 0 and 1 was computed
    await expect.poll(async () => page.getByTestId("mc-pk").textContent()).toMatch(/^[01]\.\d{3}$/);
  });

  test("tracker page estimates a track", async ({ page }) => {
    await page.goto("/tracker");
    await expect(page.getByRole("heading", { name: /Tracker in the Loop/i })).toBeVisible();
    // an IMM RMS error (a number of metres) is computed and shown
    await expect.poll(async () => page.getByTestId("trk-imm-rms").textContent()).toMatch(/\d/);
  });

  test("3-D view renders a canvas", async ({ page }) => {
    await page.goto("/threed");
    await expect(page.getByRole("heading", { name: "3-D View" })).toBeVisible();
    // the Three.js renderer mounts a <canvas>
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 15_000 });
  });

  test("Arena: launch, play, and the engineer overlay works", async ({ page }) => {
    await page.goto("/arena");
    await expect(page.getByRole("heading", { name: "Intercept Arena" })).toBeVisible();
    await page.getByRole("button", { name: /Launch engagement/ }).click();
    // first-run tutorial overlay → dismiss it
    const gotit = page.getByRole("button", { name: /Got it/ });
    if (await gotit.isVisible().catch(() => false)) await gotit.click();
    // the flight HUD is live (score readout) and a WebGL canvas mounted
    await expect(page.getByText(/score/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("canvas").first()).toBeVisible();
    // engineer overlay toggles the live tactical view
    await page.getByRole("button", { name: /Engineer overlay/ }).click();
    await expect(page.getByText(/Tactical view/i)).toBeVisible();
  });
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  test("reduced-motion offers skip-to-result", async ({ page }) => {
    await page.goto("/play");
    const skip = page.getByRole("button", { name: /Result/i });
    await expect(skip).toBeVisible({ timeout: 15_000 });
    await skip.click();
    await expect(page.getByRole("status")).toContainText(/HIT|MISS/, { timeout: 20_000 });
  });
});
