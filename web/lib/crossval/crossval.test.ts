/**
 * The cross-validation harness: for every Python reference run, run the
 * same scenario through the TypeScript engine and assert per-step agreement < 0.1 % plus
 * an identical hit/miss verdict and miss distance. If the twin ever drifts from truth,
 * CI goes red — exactly how safety-critical flight software is validated.
 */

import { describe, expect, it } from "vitest";

import { Engagement } from "../sim/engagement";
import { loadFixtures } from "./loadFixtures";

const TOL_REL = 1e-3; // 0.1 % of the initial range

describe("Python ↔ TypeScript cross-validation", () => {
  const fixtures = loadFixtures();

  it("loaded at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fx of fixtures) {
    it(`${fx.name} reproduces to < 0.1 %`, () => {
      const eng = new Engagement(fx.scenario, fx.scenario.seed ?? 0);
      const result = eng.run();
      const frames = result.frames;
      const dt = fx.dt;

      const R0 = fx.states[0][8]; // R column
      const cols = fx.columns;
      const ix = (name: string) => cols.indexOf(name);

      let worst = 0;
      for (const row of fx.states) {
        const t = row[ix("t")];
        const k = Math.round(t / dt);
        const f = frames[Math.min(k, frames.length - 1)];
        // missile + target position agreement, normalized by initial range
        const dM = Math.hypot(f.xM - row[ix("x_m")], f.yM - row[ix("y_m")]);
        const dT = Math.hypot(f.xT - row[ix("x_t")], f.yT - row[ix("y_t")]);
        worst = Math.max(worst, dM / R0, dT / R0);
      }

      expect(worst, `worst per-step error = ${(worst * 100).toFixed(4)} %`).toBeLessThan(TOL_REL);
      // identical verdict
      expect(result.verdict).toBe(fx.result.verdict);
      // miss distance within 0.1 m (or 5 % for tiny misses)
      const missTol = Math.max(0.1, 0.05 * fx.result.miss_distance);
      expect(Math.abs(result.missDistance - fx.result.miss_distance)).toBeLessThan(missTol);
    });
  }
});
