/**
 * Scenario types mirroring the Pydantic schema in `engine/zeromiss/scenario.py`
 * These drive the browser presets, Sandbox controls, and crossval.
 */

import type { AirframeConfig } from "./airframe";
import type { SeekerConfig } from "./seeker";
import type { ManeuverSpec } from "./targets";

export interface GuidanceSpec {
  law: string;
  N: number;
  use_target_accel?: boolean;
}

export interface MissileSpec {
  speed: number;
  position: [number, number];
  heading: number; // degrees
  guidance: GuidanceSpec;
  airframe: Partial<AirframeConfig>;
  seeker: Partial<SeekerConfig>;
}

export interface TargetSpec {
  speed: number;
  position: [number, number];
  heading: number; // degrees
  a_max_g: number;
  maneuver: ManeuverSpec;
}

export interface TerminationSpec {
  lethal_radius_m: number;
  t_max_s: number;
}

export interface DynamicsSpec {
  dt: number;
  induced_drag?: boolean;
  drag_coeff?: number;
  gravity?: boolean;
}

export interface ScenarioSpec {
  name: string;
  description?: string;
  seed?: number;
  missile: MissileSpec;
  target: TargetSpec;
  termination: TerminationSpec;
  dynamics: DynamicsSpec;
}

export const DEFAULT_DYNAMICS: DynamicsSpec = { dt: 0.001, induced_drag: false, gravity: false };

/** Deep-ish clone helper for scenario specs (safe for the plain-object shape above). */
export function cloneScenario(s: ScenarioSpec): ScenarioSpec {
  return JSON.parse(JSON.stringify(s)) as ScenarioSpec;
}
