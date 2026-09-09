/**
 * Airframe & autopilot model — port of `engine/zeromiss/airframe.py`.
 * g-limit clamp + first/second-order autopilot lag + saturation flag.
 */

import { G0 } from "./dynamics";

export interface AirframeConfig {
  ideal: boolean;
  aMaxG: number;
  autopilotTau: number;
  order: number;
  zeta: number;
}

export const defaultAirframe: AirframeConfig = {
  ideal: false,
  aMaxG: 40.0,
  autopilotTau: 0.2,
  order: 1,
  zeta: 0.7,
};

export class Airframe {
  cfg: AirframeConfig;
  achieved = 0.0;
  rate = 0.0;
  commanded = 0.0;
  clamped = 0.0;
  saturated = false;

  constructor(cfg: Partial<AirframeConfig> = {}) {
    this.cfg = { ...defaultAirframe, ...cfg };
  }

  reset(): void {
    this.achieved = 0.0;
    this.rate = 0.0;
    this.commanded = 0.0;
    this.clamped = 0.0;
    this.saturated = false;
  }

  get aMax(): number {
    return this.cfg.aMaxG * G0;
  }

  respond(aCmd: number, dt: number): number {
    const cfg = this.cfg;
    this.commanded = aCmd;

    if (cfg.ideal) {
      this.clamped = aCmd;
      this.saturated = false;
      this.achieved = aCmd;
      this.rate = 0.0;
      return aCmd;
    }

    const aMax = this.aMax;
    let clamped: number;
    if (aCmd > aMax) {
      clamped = aMax;
      this.saturated = true;
    } else if (aCmd < -aMax) {
      clamped = -aMax;
      this.saturated = true;
    } else {
      clamped = aCmd;
      this.saturated = false;
    }
    this.clamped = clamped;

    const tau = cfg.autopilotTau;
    if (tau <= 0.0) {
      this.achieved = clamped;
      this.rate = 0.0;
      return clamped;
    }

    if (cfg.order >= 2) {
      const wn = 1.0 / tau;
      const accelOfA = wn * wn * (clamped - this.achieved) - 2.0 * cfg.zeta * wn * this.rate;
      this.rate += dt * accelOfA;
      this.achieved += dt * this.rate;
    } else {
      const alpha = 1.0 - Math.exp(-dt / tau);
      this.achieved += alpha * (clamped - this.achieved);
      this.rate = 0.0;
    }
    return this.achieved;
  }
}
