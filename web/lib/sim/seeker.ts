/**
 * Seeker / sensor model — port of `engine/zeromiss/seeker.py`.
 * Lag, noise, FOV, loss-of-lock, finite update rate (zero-order hold).
 */

import { deg2rad, type Geometry } from "./frames";
import type { RNG } from "./rng";

export interface SeekerConfig {
  ideal: boolean;
  tau: number;
  noiseMrad: number;
  glint: boolean;
  glintRefM: number;
  glintGainMrad: number;
  fovDeg: number;
  updateHz: number;
  lossOfLockTimeoutS: number;
}

export const defaultSeeker: SeekerConfig = {
  ideal: true,
  tau: 0.1,
  noiseMrad: 1.0,
  glint: false,
  glintRefM: 1000.0,
  glintGainMrad: 2.0,
  fovDeg: 30.0,
  updateHz: 100.0,
  lossOfLockTimeoutS: 0.5,
};

export interface SeekerOut {
  lambdaDot: number;
  locked: boolean;
  inFov: boolean;
  sigma: number;
  lockLostFor: number;
}

export class Seeker {
  cfg: SeekerConfig;
  private tSinceUpdate = Infinity;
  private heldLd = 0.0;
  private heldSigma = 0.0;
  private lockLostFor = 0.0;
  private locked = true;

  constructor(cfg: Partial<SeekerConfig> = {}) {
    this.cfg = { ...defaultSeeker, ...cfg };
  }

  reset(): void {
    this.tSinceUpdate = Infinity;
    this.heldLd = 0.0;
    this.heldSigma = 0.0;
    this.lockLostFor = 0.0;
    this.locked = true;
  }

  private get fovRad(): number {
    return deg2rad(this.cfg.fovDeg);
  }
  private get updateDt(): number {
    return this.cfg.updateHz > 0 ? 1.0 / this.cfg.updateHz : 0.0;
  }

  measure(g: Geometry, dt: number, rng: RNG | null): SeekerOut {
    const cfg = this.cfg;
    if (cfg.ideal) {
      return { lambdaDot: g.lambdaDot, locked: true, inFov: true, sigma: 0.0, lockLostFor: 0.0 };
    }

    const inFov = g.losOffBoresight <= this.fovRad;
    if (inFov) {
      this.lockLostFor = 0.0;
      this.locked = true;
    } else {
      this.lockLostFor += dt;
      if (this.lockLostFor > cfg.lossOfLockTimeoutS) this.locked = false;
    }

    this.tSinceUpdate += dt;
    if (this.tSinceUpdate < this.updateDt) {
      return {
        lambdaDot: this.locked ? this.heldLd : 0.0,
        locked: this.locked,
        inFov,
        sigma: this.heldSigma,
        lockLostFor: this.lockLostFor,
      };
    }

    const Ts = Math.max(this.tSinceUpdate, this.updateDt);
    this.tSinceUpdate = 0.0;

    let sigmaAng = cfg.noiseMrad * 1e-3;
    if (cfg.glint && g.R > 1e-6) {
      sigmaAng += cfg.glintGainMrad * 1e-3 * (cfg.glintRefM / g.R);
    }
    const rateNoise = sigmaAng > 0 && rng ? rng.normal(0.0, sigmaAng) / Ts : 0.0;
    const measured = g.lambdaDot + rateNoise;

    const alpha = cfg.tau > 0 ? 1.0 - Math.exp(-Ts / cfg.tau) : 1.0;
    this.heldLd = this.heldLd + alpha * (measured - this.heldLd);
    this.heldSigma = sigmaAng;

    return {
      lambdaDot: this.locked ? this.heldLd : 0.0,
      locked: this.locked,
      inFov,
      sigma: sigmaAng,
      lockLostFor: this.lockLostFor,
    };
  }
}
