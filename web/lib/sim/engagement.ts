/**
 * The engagement orchestrator — port of `engine/zeromiss/engagement.py`.
 *
 * Supports both a one-shot `run()` (used by crossval, replay, compare) and an
 * incremental `stepOnce()` (used by the live 60 fps visualizer and Duel mode). The
 * closest-approach miss distance is found by parabolic interpolation, identical to the
 * Python engine.
 */

import { Airframe } from "./airframe";
import { eom, G0, type DynamicsConfig, defaultDynamics } from "./dynamics";
import {
  perpendicularComponent,
  relativeState,
  type Geometry,
  type Kinematic,
  deg2rad,
} from "./frames";
import { getLaw, type GuidanceLaw, type GuidanceParams } from "./guidance";
import { rk4Step, type State } from "./integrator";
import { RNG } from "./rng";
import { Seeker } from "./seeker";
import { buildManeuver, Live, type Maneuver } from "./targets";
import type { ScenarioSpec } from "./scenario";

export const PHASE = { MIDCOURSE: "MIDCOURSE", TERMINAL: "TERMINAL", COAST: "COAST" } as const;
const TERMINAL_TGO = 1.0;

export interface Frame {
  t: number;
  xM: number;
  yM: number;
  gammaM: number;
  xT: number;
  yT: number;
  gammaT: number;
  R: number;
  lam: number;
  lambdaDot: number;
  lambdaDotMeas: number;
  Vc: number;
  tGo: number;
  zemPerp: number;
  aCmd: number;
  aAch: number;
  aT: number;
  gCmd: number;
  gAch: number;
  saturated: boolean;
  locked: boolean;
  inFov: boolean;
  phase: string;
}

export interface Result {
  verdict: "HIT" | "MISS";
  missDistance: number;
  peakG: number;
  peakGCommanded: number;
  tFlight: number;
  closingVelocity: number;
  seed: number;
  law: string;
  N: number;
  lethalRadius: number;
  lockLost: boolean;
  timedOut: boolean;
  frames: Frame[];
  scenarioName: string;
}

function parabolicMin(
  t0: number, t1: number, _t2: number, R0: number, R1: number, R2: number,
): [number, number] {
  const denom = R0 - 2.0 * R1 + R2;
  if (Math.abs(denom) < 1e-12) return [t1, R1];
  let x = (0.5 * (R0 - R2)) / denom;
  x = Math.max(-1.0, Math.min(1.0, x));
  const dt = t1 - t0;
  const tMin = t1 + x * dt;
  const a = 0.5 * denom;
  const b = 0.5 * (R2 - R0);
  const Rmin = R1 + b * x + a * x * x;
  return [tMin, Math.max(Rmin, 0.0)];
}

export class Engagement {
  readonly spec: ScenarioSpec;
  readonly dt: number;
  readonly tMax: number;
  readonly Rk: number;
  private readonly law: GuidanceLaw;
  private readonly params: GuidanceParams;
  private readonly airframe: Airframe;
  private readonly seeker: Seeker;
  private readonly maneuver: Maneuver;
  private readonly targetAMax: number;
  private readonly dyn: DynamicsConfig;
  private readonly VM: number;
  private readonly VT: number;
  private readonly rng: RNG;

  state: State;
  t = 0.0;
  done = false;
  result: Result | null = null;

  private peakG = 0.0;
  private peakGCmd = 0.0;
  private lockLost = false;
  private minR = Infinity;
  private minRt = 0.0;
  private histT: number[] = [];
  private histR: number[] = [];
  private histVc: number[] = [];
  private closestFound = false;
  lastFrame: Frame | null = null;

  constructor(spec: ScenarioSpec, seed?: number) {
    this.spec = spec;
    const s = seed ?? spec.seed ?? 0;
    this.rng = new RNG(s);
    this.law = getLaw(spec.missile.guidance.law);
    this.params = {
      N: spec.missile.guidance.N,
      useTargetAccel: spec.missile.guidance.use_target_accel ?? true,
    };
    this.airframe = new Airframe(spec.missile.airframe);
    this.seeker = new Seeker(spec.missile.seeker);
    this.maneuver = buildManeuver(spec.target.maneuver);
    this.targetAMax = spec.target.a_max_g * G0;
    this.dyn = {
      ...defaultDynamics,
      inducedDrag: spec.dynamics.induced_drag ?? false,
      gravity: spec.dynamics.gravity ?? false,
    };
    this.VM = spec.missile.speed;
    this.VT = spec.target.speed;
    this.dt = spec.dynamics.dt;
    this.tMax = spec.termination.t_max_s;
    this.Rk = spec.termination.lethal_radius_m;

    this.state = [
      spec.missile.position[0],
      spec.missile.position[1],
      spec.missile.speed,
      deg2rad(spec.missile.heading),
      spec.target.position[0],
      spec.target.position[1],
      spec.target.speed,
      deg2rad(spec.target.heading),
    ];
    this._seed = s;
  }

  private _seed: number;

  /** Expose the Live maneuver so Duel mode can set the player's commanded accel. */
  get liveManeuver(): Live | null {
    return this.maneuver instanceof Live ? this.maneuver : null;
  }

  /** Advance exactly one physics step. Returns the frame, or null if already done. */
  stepOnce(): Frame | null {
    if (this.done) return null;
    const [xM, yM, , gM, xT, yT, , gT] = this.state;

    const aTraw = this.maneuver.command(this.t);
    const aT = Math.max(-this.targetAMax, Math.min(this.targetAMax, aTraw));

    const lamTmp = Math.atan2(yT - yM, xT - xM);
    const aTPerp = perpendicularComponent(aT, gT, lamTmp);
    const missile: Kinematic = { x: xM, y: yM, speed: this.VM, heading: gM };
    const target: Kinematic = { x: xT, y: yT, speed: this.VT, heading: gT };
    const gTrue = relativeState(missile, target, aTPerp);

    const sk = this.seeker.measure(gTrue, this.dt, this.rng);
    if (!sk.locked) this.lockLost = true;

    const gMeas = withMeasuredRate(gTrue, sk.lambdaDot);
    const aCmd = !sk.locked ? 0.0 : this.law(gMeas, this.params);
    const aAch = this.airframe.respond(aCmd, this.dt);

    let phase: string;
    if (!sk.locked) phase = PHASE.COAST;
    else if (isFinite(gTrue.tGo) && gTrue.tGo <= TERMINAL_TGO) phase = PHASE.TERMINAL;
    else phase = PHASE.MIDCOURSE;

    const gCmd = aCmd / G0;
    const gAch = aAch / G0;
    this.peakG = Math.max(this.peakG, Math.abs(gAch));
    this.peakGCmd = Math.max(this.peakGCmd, Math.abs(gCmd));

    const frame: Frame = {
      t: this.t,
      xM, yM, gammaM: gM, xT, yT, gammaT: gT,
      R: gTrue.R, lam: gTrue.lam, lambdaDot: gTrue.lambdaDot, lambdaDotMeas: sk.lambdaDot,
      Vc: gTrue.Vc, tGo: gTrue.tGo, zemPerp: gMeas.zemPerp,
      aCmd, aAch, aT, gCmd, gAch,
      saturated: this.airframe.saturated, locked: sk.locked, inFov: sk.inFov, phase,
    };
    this.lastFrame = frame;

    // closest-approach detection
    this.histT.push(this.t);
    this.histR.push(gTrue.R);
    this.histVc.push(gTrue.Vc);
    if (gTrue.R < this.minR) {
      this.minR = gTrue.R;
      this.minRt = this.t;
    }
    const n = this.histR.length;
    if (n >= 3 && !this.closestFound) {
      const R0 = this.histR[n - 3];
      const R1 = this.histR[n - 2];
      const R2 = this.histR[n - 1];
      if (R1 <= R0 && R2 > R1) {
        const [tStar, Rstar] = parabolicMin(
          this.histT[n - 3], this.histT[n - 2], this.histT[n - 1], R0, R1, R2,
        );
        this.minR = Rstar;
        this.minRt = tStar;
        this.closestFound = true;
        this.finish(this.histVc[n - 3]);
        return frame;
      }
    }

    // integrate one RK4 step (ZOH on aAch and aT)
    this.state = rk4Step(this.state, (st) => eom(st, aAch, aT, this.dyn), this.dt, this.t);
    this.t += this.dt;

    if (this.t >= this.tMax + this.dt) {
      this.finish(this.histVc.length ? this.histVc[this.histVc.length - 1] : 0);
    }
    return frame;
  }

  private finish(closingVelocity: number): void {
    this.done = true;
    const verdict: "HIT" | "MISS" = this.minR <= this.Rk ? "HIT" : "MISS";
    this.result = {
      verdict,
      missDistance: this.minR,
      peakG: this.peakG,
      peakGCommanded: this.peakGCmd,
      tFlight: this.minRt,
      closingVelocity,
      seed: this._seed,
      law: this.spec.missile.guidance.law,
      N: this.params.N,
      lethalRadius: this.Rk,
      lockLost: this.lockLost,
      timedOut: !this.closestFound,
      frames: [],
      scenarioName: this.spec.name,
    };
  }

  /** Run to completion, collecting the full trajectory. */
  run(): Result {
    const frames: Frame[] = [];
    let guard = 0;
    const maxSteps = Math.ceil(this.tMax / this.dt) + 5;
    while (!this.done && guard++ < maxSteps) {
      const f = this.stepOnce();
      if (f) frames.push(f);
    }
    if (!this.result) this.finish(0);
    this.result!.frames = frames;
    return this.result!;
  }
}

function withMeasuredRate(g: Geometry, lambdaDotMeas: number): Geometry {
  let zem: number;
  if (!isFinite(g.tGo)) zem = g.zemPerp;
  else zem = g.R * lambdaDotMeas * g.tGo + 0.5 * g.aTPerp * g.tGo * g.tGo;
  return { ...g, lambdaDot: lambdaDotMeas, zemPerp: zem };
}
