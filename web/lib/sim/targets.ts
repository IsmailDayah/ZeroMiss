/**
 * Target & evasion models — port of `engine/zeromiss/targets.py`.
 * Includes a `live` model whose command is set externally each step (Duel mode).
 */

import { G0 } from "./dynamics";

export interface Maneuver {
  command(t: number): number;
}

export class ConstantVelocity implements Maneuver {
  command(): number {
    return 0.0;
  }
}

export class Step implements Maneuver {
  constructor(public amplitudeG = 9.0, public startS = 1.0) {}
  command(t: number): number {
    return t >= this.startS ? this.amplitudeG * G0 : 0.0;
  }
}

export class Weave implements Maneuver {
  constructor(public amplitudeG = 9.0, public periodS = 2.0, public startS = 1.0, public phase = 0.0) {}
  command(t: number): number {
    if (t < this.startS || this.periodS <= 0.0) return 0.0;
    const w = (2.0 * Math.PI) / this.periodS;
    return this.amplitudeG * G0 * Math.sin(w * (t - this.startS) + this.phase);
  }
}

export class BangBang implements Maneuver {
  constructor(public amplitudeG = 9.0, public periodS = 2.0, public startS = 1.0) {}
  command(t: number): number {
    if (t < this.startS || this.periodS <= 0.0) return 0.0;
    const phase = ((t - this.startS) % this.periodS) / this.periodS;
    const s = phase < 0.5 ? 1.0 : -1.0;
    return s * this.amplitudeG * G0;
  }
}

export class Live implements Maneuver {
  current = 0.0;
  command(): number {
    return this.current;
  }
}

export interface ManeuverSpec {
  type: string;
  amplitude_g?: number;
  period_s?: number;
  start_s?: number;
  phase?: number;
}

export function buildManeuver(spec: ManeuverSpec): Maneuver {
  const kind = (spec.type || "constant_velocity").toLowerCase();
  switch (kind) {
    case "constant_velocity":
    case "cv":
    case "none":
      return new ConstantVelocity();
    case "step":
      return new Step(spec.amplitude_g ?? 9, spec.start_s ?? 1);
    case "weave":
      return new Weave(spec.amplitude_g ?? 9, spec.period_s ?? 2, spec.start_s ?? 1, spec.phase ?? 0);
    case "bang_bang":
      return new BangBang(spec.amplitude_g ?? 9, spec.period_s ?? 2, spec.start_s ?? 1);
    case "live":
      return new Live();
    default:
      throw new Error(`Unknown target maneuver type: ${kind}`);
  }
}
