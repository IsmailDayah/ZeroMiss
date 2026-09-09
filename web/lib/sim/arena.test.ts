import { describe, expect, it } from "vitest";

import { ArenaSim, NEUTRAL_INPUT, difficultyFor, type ArenaInput } from "./arena";

function run(sim: ArenaSim, input: ArenaInput, seconds: number, dt = 1 / 60) {
  sim.start();
  for (let t = 0; t < seconds && sim.state.status === "flying"; t += dt) sim.step(dt, input);
  return sim.state;
}

describe("Intercept Arena physics", () => {
  it("is deterministic from a seed (replayable), and varies across seeds", () => {
    const snap = (seed: number) => {
      const s = new ArenaSim("jet", 0.5, { seed });
      s.start();
      for (let i = 0; i < 240; i++) s.step(1 / 60, { ...NEUTRAL_INPUT, throttle: 0.6, yaw: 0.3 });
      return JSON.stringify(s.state.interceptors.map((i) => i.pos));
    };
    expect(snap(42)).toEqual(snap(42)); // same seed → identical battery sequence
    expect(snap(43)).not.toEqual(snap(42)); // a different seed fires a different pattern
  });

  it("player input actually turns the vehicle", () => {
    const sim = new ArenaSim("jet", 0.3, { seed: 1 });
    sim.start();
    const d0 = [...sim.state.player.dir];
    for (let i = 0; i < 30; i++) sim.step(1 / 60, { ...NEUTRAL_INPUT, yaw: 1 });
    const d1 = sim.state.player.dir;
    const dot = d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2];
    expect(dot).toBeLessThan(0.999); // heading changed
  });

  it("a non-evading target gets intercepted (PN works)", () => {
    const sim = new ArenaSim("jet", 0.3, { seed: 7 });
    const st = run(sim, { ...NEUTRAL_INPUT, throttle: 0.5, yaw: 0, pitch: 0 }, sim.diff.surviveTime + 2);
    expect(st.status).toBe("intercepted");
    expect(st.closest).toBeLessThan(sim.diff.lethal + 1e-6);
  });

  it("the interceptor builds a finite LOS-rate telemetry while locked", () => {
    const sim = new ArenaSim("jet", 0.4, { seed: 3 });
    sim.start();
    for (let i = 0; i < 120; i++) sim.step(1 / 60, { ...NEUTRAL_INPUT, yaw: 0.6 });
    const tele = sim.state.interceptors[0].tele;
    expect(Number.isFinite(tele.lambdaDot)).toBe(true);
    expect(Number.isFinite(tele.R)).toBe(true);
    expect(tele.cmdG).toBeGreaterThanOrEqual(0);
  });

  it("deploying a flare consumes one", () => {
    const sim = new ArenaSim("drone", 0.5, { seed: 9 });
    sim.start();
    const before = sim.state.flaresLeft;
    sim.step(1 / 60, { ...NEUTRAL_INPUT, flare: true });
    expect(sim.state.flaresLeft).toBe(before - 1);
    expect(sim.state.flares.length).toBe(1);
  });

  it("difficulty knobs scale monotonically", () => {
    const easy = difficultyFor(0);
    const hard = difficultyFor(1);
    expect(hard.N).toBeGreaterThan(easy.N);
    expect(hard.speed).toBeGreaterThan(easy.speed);
    expect(hard.aMaxG).toBeGreaterThan(easy.aMaxG);
    expect(hard.maxConcurrent).toBeGreaterThanOrEqual(easy.maxConcurrent);
    expect(hard.reloadDelay).toBeLessThan(easy.reloadDelay);
    expect(hard.surviveTime).toBeGreaterThan(easy.surviveTime);
    expect(hard.flares).toBeLessThanOrEqual(easy.flares);
  });
});
