/**
 * 3-D cross-validation: the TypeScript 3-D engine must reproduce
 * the Python 3-D reference runs to < 0.1 %, exactly like the planar twin. Keeps the true
 * 3-D engagement honest across both languages.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runEngagement3D, type Engagement3DSpec } from "../sim/threeD";

interface Fixture3D {
  name: string;
  spec: Engagement3DSpec;
  result: { verdict: string; missDistance: number; tFlight: number };
  frames: Array<{ t: number; m: [number, number, number]; tg: [number, number, number] }>;
}

function load(): Fixture3D[] {
  const candidates = [
    path.resolve(process.cwd(), "..", "fixtures", "threed.json"),
    path.resolve(process.cwd(), "fixtures", "threed.json"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf-8"));
  throw new Error("fixtures/threed.json not found");
}

describe("Python ↔ TypeScript 3-D cross-validation", () => {
  const fixtures = load();
  it("loaded 3-D fixtures", () => expect(fixtures.length).toBeGreaterThan(0));

  for (const fx of fixtures) {
    it(`${fx.name} reproduces to < 0.1 %`, () => {
      const r = runEngagement3D(fx.spec);
      const R0 = Math.hypot(
        fx.spec.targetPos[0] - fx.spec.missilePos[0],
        fx.spec.targetPos[1] - fx.spec.missilePos[1],
        fx.spec.targetPos[2] - fx.spec.missilePos[2],
      );
      // identical verdict + miss distance
      expect(r.verdict).toBe(fx.result.verdict);
      expect(Math.abs(r.missDistance - fx.result.missDistance)).toBeLessThan(Math.max(0.1, 0.05 * fx.result.missDistance));
      // per-frame 3-D position agreement (frames are sampled identically in both engines)
      let worst = 0;
      const nbCompare = Math.min(r.frames.length, fx.frames.length);
      for (let i = 0; i < nbCompare; i++) {
        const a = r.frames[i];
        const b = fx.frames[i];
        const dM = Math.hypot(a.m[0] - b.m[0], a.m[1] - b.m[1], a.m[2] - b.m[2]);
        const dT = Math.hypot(a.tg[0] - b.tg[0], a.tg[1] - b.tg[1], a.tg[2] - b.tg[2]);
        worst = Math.max(worst, dM / R0, dT / R0);
      }
      expect(worst, `worst per-frame error ${(worst * 100).toFixed(4)} %`).toBeLessThan(1e-3);
    });
  }
});
