/**
 * Load the Python-exported reference runs (`fixtures/*.json`) and adapt the dumped
 * Pydantic scenario into the TypeScript `ScenarioSpec`.
 */

import fs from "node:fs";
import path from "node:path";

import type { ScenarioSpec } from "../sim/scenario";

export interface Fixture {
  name: string;
  scenario: ScenarioSpec;
  dt: number;
  columns: string[];
  states: number[][];
  result: { verdict: string; miss_distance: number; t_flight: number; peak_g: number };
}

export function fixturesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "fixtures"),
    path.resolve(process.cwd(), "fixtures"),
    path.resolve(__dirname, "..", "..", "..", "fixtures"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.json"))) return c;
  }
  throw new Error(`Could not locate fixtures/ (looked in ${candidates.join(", ")})`);
}

/** Convert a Python `model_dump()` scenario dict into the TS ScenarioSpec shape. */
export function pyScenarioToSpec(py: any): ScenarioSpec {
  const m = py.missile;
  const t = py.target;
  return {
    name: py.name,
    description: py.description ?? "",
    seed: py.seed ?? 0,
    missile: {
      speed: m.speed,
      position: m.position,
      heading: m.heading,
      guidance: { law: m.guidance.law, N: m.guidance.N, use_target_accel: m.guidance.use_target_accel },
      airframe: {
        ideal: m.airframe.ideal,
        aMaxG: m.airframe.a_max_g,
        autopilotTau: m.airframe.autopilot_tau,
        order: m.airframe.order,
        zeta: m.airframe.zeta,
      },
      seeker: {
        ideal: m.seeker.ideal,
        tau: m.seeker.tau,
        noiseMrad: m.seeker.noise_mrad,
        glint: m.seeker.glint,
        glintRefM: m.seeker.glint_ref_m,
        glintGainMrad: m.seeker.glint_gain_mrad,
        fovDeg: m.seeker.fov_deg,
        updateHz: m.seeker.update_hz,
        lossOfLockTimeoutS: m.seeker.loss_of_lock_timeout_s,
      },
    },
    target: {
      speed: t.speed,
      position: t.position,
      heading: t.heading,
      a_max_g: t.a_max_g,
      maneuver: t.maneuver,
    },
    termination: { lethal_radius_m: py.termination.lethal_radius_m, t_max_s: py.termination.t_max_s },
    dynamics: {
      dt: py.dynamics.dt,
      induced_drag: py.dynamics.induced_drag,
      drag_coeff: py.dynamics.drag_coeff,
      gravity: py.dynamics.gravity,
    },
  };
}

export function loadFixtures(): Fixture[] {
  const dir = fixturesDir();
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8")) as Array<{ file: string }>;
  return index.map((entry) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.file), "utf-8"));
    return { ...raw, scenario: pyScenarioToSpec(raw.scenario) } as Fixture;
  });
}
