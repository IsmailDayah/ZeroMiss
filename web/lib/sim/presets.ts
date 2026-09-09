/**
 * Browser scenario presets — the same engagements as `scenarios/*.yaml`, fully
 * specified (the TS engine does not merge `_defaults.yaml`). These power the Watch
 * gallery, Sandbox defaults, Compare, and Duel.
 */

import type { ScenarioSpec } from "./scenario";

function base(over: Partial<ScenarioSpec> & { name: string }): ScenarioSpec {
  return {
    name: over.name,
    description: over.description ?? "",
    seed: over.seed ?? 0,
    missile: {
      speed: 1000,
      position: [0, 0],
      heading: 0,
      guidance: { law: "tpn", N: 4, use_target_accel: true },
      airframe: { aMaxG: 40, autopilotTau: 0.2, ideal: false },
      seeker: { ideal: true },
      ...(over.missile ?? {}),
    },
    target: {
      speed: 300,
      position: [8000, 0],
      heading: 180,
      a_max_g: 9,
      maneuver: { type: "constant_velocity" },
      ...(over.target ?? {}),
    },
    termination: { lethal_radius_m: 5, t_max_s: 15, ...(over.termination ?? {}) },
    dynamics: { dt: 0.001, ...(over.dynamics ?? {}) },
  };
}

export const PRESETS: Record<string, ScenarioSpec> = {
  textbook_kill: base({
    name: "Textbook Kill",
    description: "Head-on, constant-velocity target. PN's defining property: miss ≈ 0.",
    seed: 7,
    missile: {
      speed: 1000, position: [0, 0], heading: 0,
      guidance: { law: "tpn", N: 4 }, airframe: { ideal: true }, seeker: { ideal: true },
    },
    target: { speed: 300, position: [8000, 600], heading: 195, a_max_g: 9, maneuver: { type: "constant_velocity" } },
  }),

  tail_chase: base({
    name: "Tail Chase",
    description: "Pure pursuit against a crossing target — curves in behind, arrives late.",
    seed: 7,
    missile: {
      speed: 1000, position: [0, 0], heading: 20,
      guidance: { law: "pursuit", N: 5 }, airframe: { aMaxG: 40, autopilotTau: 0.15, ideal: false }, seeker: { ideal: true },
    },
    target: { speed: 350, position: [6000, 2500], heading: 200, a_max_g: 9, maneuver: { type: "constant_velocity" } },
    termination: { lethal_radius_m: 5, t_max_s: 20 },
  }),

  the_weave: base({
    name: "The Weave",
    description: "9-g sinusoidal evader; APN beats TPN by feeding the maneuver forward.",
    seed: 1337,
    missile: {
      speed: 1000, position: [0, 0], heading: 0,
      guidance: { law: "apn", N: 4 }, airframe: { aMaxG: 40, autopilotTau: 0.2, ideal: false }, seeker: { ideal: true },
    },
    target: { speed: 300, position: [8000, 500], heading: 180, a_max_g: 9, maneuver: { type: "weave", amplitude_g: 9, period_s: 2.0, start_s: 1.0 } },
  }),

  step_maneuver: base({
    name: "Step Maneuver",
    description: "The canonical Zarchan break against a single-lag autopilot.",
    seed: 21,
    missile: {
      speed: 1000, position: [0, 0], heading: 0,
      guidance: { law: "tpn", N: 4 }, airframe: { aMaxG: 40, autopilotTau: 0.2, ideal: false }, seeker: { ideal: true },
    },
    target: { speed: 300, position: [8000, 0], heading: 180, a_max_g: 12, maneuver: { type: "step", amplitude_g: 9, start_s: 5.0 } },
  }),

  bang_bang: base({
    name: "Bang-Bang",
    description: "Alternating max-g jinks — the hardest classical evasion.",
    seed: 99,
    missile: {
      speed: 1000, position: [0, 0], heading: 0,
      guidance: { law: "apn", N: 5 }, airframe: { aMaxG: 45, autopilotTau: 0.15, ideal: false }, seeker: { ideal: true },
    },
    target: { speed: 350, position: [9000, 0], heading: 180, a_max_g: 12, maneuver: { type: "bang_bang", amplitude_g: 12, period_s: 1.5, start_s: 1.0 } },
    termination: { lethal_radius_m: 6, t_max_s: 16 },
  }),

  break_lock: base({
    name: "Break Lock",
    description: "A hard-jinking target near a narrow seeker FOV — it can break lock.",
    seed: 5,
    missile: {
      speed: 1000, position: [0, 0], heading: 0,
      guidance: { law: "tpn", N: 4 }, airframe: { aMaxG: 35, autopilotTau: 0.25, ideal: false },
      seeker: { ideal: false, tau: 0.1, noiseMrad: 0, glint: false, fovDeg: 18, updateHz: 100, lossOfLockTimeoutS: 0.3 },
    },
    target: { speed: 400, position: [7000, 1200], heading: 200, a_max_g: 14, maneuver: { type: "bang_bang", amplitude_g: 14, period_s: 1.0, start_s: 0.8 } },
    termination: { lethal_radius_m: 5, t_max_s: 16 },
  }),

  duel: base({
    name: "Duel",
    description: "You fly the jet. A ProNav interceptor hunts you — try to escape.",
    seed: 0,
    missile: {
      speed: 900, position: [0, 0], heading: 0,
      guidance: { law: "tpn", N: 4 }, airframe: { aMaxG: 40, autopilotTau: 0.2, ideal: false },
      seeker: { ideal: false, tau: 0.08, noiseMrad: 0, fovDeg: 45, updateHz: 120 },
    },
    target: { speed: 350, position: [7000, 0], heading: 180, a_max_g: 9, maneuver: { type: "live" } },
    termination: { lethal_radius_m: 6, t_max_s: 25 },
  }),
};

export const PRESET_ORDER = [
  "textbook_kill",
  "the_weave",
  "tail_chase",
  "step_maneuver",
  "bang_bang",
  "break_lock",
] as const;

export function getPreset(id: string): ScenarioSpec {
  const p = PRESETS[id];
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}
