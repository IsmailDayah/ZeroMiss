import { describe, expect, it } from "vitest";

import { EKF, IMM, radarMeasure } from "./tracker";
import { RNG } from "./rng";

function fly(accel: (t: number) => number, dt = 0.02, T = 8) {
  const pts: Array<[number, number]> = [];
  let x = 6000, y = 0, vx = -300, vy = 0;
  for (let t = 0; t < T; t += dt) {
    const a = accel(t);
    const sp = Math.hypot(vx, vy);
    const hd = Math.atan2(vy, vx) + (a / sp) * dt;
    vx = sp * Math.cos(hd);
    vy = sp * Math.sin(hd);
    x += vx * dt;
    y += vy * dt;
    pts.push([x, y]);
  }
  return pts;
}

function rms(a: number[]): number {
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}

describe("TS tracker (EKF / IMM)", () => {
  it("EKF cuts position error well below the raw measurement noise", () => {
    const rng = new RNG(0);
    const sr = 25, sb = 6e-3;
    const ekf = new EKF(50, sr, sb);
    ekf.initialize(6000, 0, -300, 0);
    const raw: number[] = [];
    const est: number[] = [];
    for (const [tx, ty] of fly((t) => 9 * 9.81 * Math.sin(Math.PI * t))) {
      const z = radarMeasure(0, 0, tx, ty, rng, sr, sb);
      const rx = z[0] * Math.cos(z[1]);
      const ry = z[0] * Math.sin(z[1]);
      raw.push(Math.hypot(rx - tx, ry - ty));
      ekf.predict(0.02);
      ekf.update(z, 0, 0);
      const e = ekf.estimate();
      est.push(Math.hypot(e[0] - tx, e[1] - ty));
    }
    expect(rms(est.slice(50))).toBeLessThan(0.5 * rms(raw.slice(50)));
  });

  it("IMM beats a fixed EKF during a hard maneuver", () => {
    const rng = new RNG(1);
    const sr = 25, sb = 6e-3;
    const ekf = new EKF(200, sr, sb);
    const imm = new IMM(2, 8000, sr, sb);
    ekf.initialize(6000, 0, -300, 0);
    imm.initialize(6000, 0, -300, 0);
    const ee: number[] = [];
    const ie: number[] = [];
    for (const [tx, ty] of fly((t) => (t < 4 ? 0 : 12 * 9.81))) {
      const z = radarMeasure(0, 0, tx, ty, rng, sr, sb);
      ekf.predict(0.02);
      ekf.update(z, 0, 0);
      const e = ekf.estimate();
      ee.push(Math.hypot(e[0] - tx, e[1] - ty));
      imm.step(0.02, z, 0, 0);
      const i = imm.estimate();
      ie.push(Math.hypot(i[0] - tx, i[1] - ty));
    }
    expect(rms(ie.slice(210))).toBeLessThan(0.7 * rms(ee.slice(210)));
    expect(imm.maneuverProbability).toBeGreaterThanOrEqual(0);
    expect(imm.maneuverProbability).toBeLessThanOrEqual(1);
  });
});
