/**
 * Intercept Arena — the real-time, playable evasion game engine.
 *
 * This is the SAME validated guidance physics as the tactical modes, made interactive:
 * you fly a vehicle (the target), and one or more interceptors hunt you with genuine
 * 3-D proportional navigation (a = N·(Ω × v)), real seeker field-of-view + loss-of-lock,
 * airframe g-limits, induced-drag energy loss, proximity fuzing, and decoy/flare
 * seduction. Win by surviving — i.e. by forcing the interceptor to demand more g than its
 * airframe can pull, breaking its seeker lock, or seducing it with a flare. Every one of
 * those is a real GN&C concept; the on-screen telemetry proves the math is live, not faked.
 *
 * Rendering-agnostic: this module is pure simulation. The Three.js layer reads its state.
 */

import { RNG } from "./rng";
import { type Vec3, add, cross, dot, norm, scale, sub } from "./threeD";

const G0 = 9.80665;

// ----------------------------------------------------------------------------- math
export function unit(v: Vec3): Vec3 {
  const m = norm(v);
  return m > 1e-9 ? scale(v, 1 / m) : [0, 0, 0];
}

/** Rotate vector v around unit axis k by angle a (Rodrigues' rotation formula). */
export function rotateAround(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kk = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kk,
    v[1] * c + kv[1] * s + k[1] * kk,
    v[2] * c + kv[2] * s + k[2] * kk,
  ];
}

export function clampMag(v: Vec3, max: number): Vec3 {
  const m = norm(v);
  return m > max && m > 1e-9 ? scale(v, max / m) : v;
}

// ----------------------------------------------------------------------------- types
export type VehicleKind = "drone" | "jet";

export interface VehicleProfile {
  kind: VehicleKind;
  cruise: number; // nominal speed [m/s]
  vMin: number; // stall / min speed
  vMax: number; // full-throttle / boost speed
  turnRate: number; // max commanded turn rate [rad/s] (pitch/yaw)
  rollRate: number; // [rad/s] (cosmetic + reorients turn plane)
  dragK: number; // induced-drag energy-loss coefficient
  aMaxG: number; // structural g-limit of the player vehicle
}

export const VEHICLES: Record<VehicleKind, VehicleProfile> = {
  drone: { kind: "drone", cruise: 240, vMin: 60, vMax: 420, turnRate: 2.6, rollRate: 3.4, dragK: 0.018, aMaxG: 22 },
  jet: { kind: "jet", cruise: 520, vMin: 180, vMax: 900, turnRate: 1.7, rollRate: 2.6, dragK: 0.011, aMaxG: 32 },
};

export interface ArenaInput {
  pitch: number; // -1..1  (nose up/down)
  yaw: number; // -1..1   (nose left/right)
  roll: number; // -1..1
  throttle: number; // 0..1 target speed fraction
  boost: boolean;
  flare: boolean; // edge-triggered deploy request
}

export const NEUTRAL_INPUT: ArenaInput = { pitch: 0, yaw: 0, roll: 0, throttle: 0.6, boost: false, flare: false };

export interface InterceptorTelemetry {
  id: number;
  R: number; // range to player [m]
  Vc: number; // closing velocity [m/s]
  lambdaDot: number; // |LOS rate| [rad/s] — the quantity PN nulls
  tGo: number; // time-to-go [s]
  cmdG: number; // commanded g (pre-limit)
  achG: number; // achieved g (post g-limit)
  saturated: boolean; // demanding more than the airframe can pull
  locked: boolean; // seeker currently tracking the player
  seduced: boolean; // currently chasing a flare
  pos: Vec3;
  vel: Vec3;
}

export type ArenaStatus = "ready" | "flying" | "escaped" | "intercepted" | "crashed";

export interface DifficultyKnobs {
  name: string;
  N: number; // navigation constant
  speed: number; // interceptor speed [m/s]
  aMaxG: number; // interceptor g-limit
  fovDeg: number; // seeker half-angle FOV
  lethal: number; // proximity-fuze radius [m]
  flares: number; // flares the player gets
  surviveTime: number; // seconds of barrage you must outlast to "escape"
  maxConcurrent: number; // interceptors the battery keeps in the air at once
  reloadDelay: number; // seconds between launches from the battery
  maxFlight: number; // interceptor burn time before it runs out of fuel [s]
}

/** Map a 0..1 difficulty slider to a relentless, physically-meaningful air-defense battery. */
export function difficultyFor(t: number): DifficultyKnobs {
  const x = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => a + (b - a) * x;
  const name = x < 0.2 ? "Rookie" : x < 0.45 ? "Cadet" : x < 0.7 ? "Pilot" : x < 0.9 ? "Ace" : "Top Gun";
  return {
    name,
    N: lerp(3.0, 4.5),
    speed: lerp(820, 1300), // a real speed edge so a straight-flying target gets caught
    aMaxG: lerp(28, 60),
    // wider seeker FOV (half-angle) at higher difficulty = harder to break lock
    fovDeg: lerp(55, 110),
    lethal: lerp(15, 8),
    flares: Math.round(lerp(6, 3)),
    surviveTime: lerp(25, 48),
    maxConcurrent: Math.round(lerp(1, 5)),
    reloadDelay: lerp(3.6, 1.0),
    maxFlight: lerp(20, 16),
  };
}

export interface Flare {
  pos: Vec3;
  vel: Vec3;
  life: number;
  max: number;
}

export interface Interceptor {
  id: number;
  pos: Vec3;
  vel: Vec3;
  speed: number;
  alive: boolean;
  active: boolean; // is currently in the air (a free slot is alive=false)
  launchT: number; // sim-time it was launched from the battery (for fuel burn)
  origin: Vec3; // the battery site it launched from (for the launch plume)
  lockLostFor: number;
  locked: boolean;
  seducedFor: number;
  tele: InterceptorTelemetry;
  trail: Vec3[];
  diedTo?: "terrain" | "missed";
}

export interface ArenaState {
  status: ArenaStatus;
  t: number;
  player: {
    pos: Vec3;
    vel: Vec3;
    dir: Vec3;
    up: Vec3;
    speed: number;
    gLoad: number; // current structural load [g]
    energy: number; // 0..1 normalized kinetic energy
    trail: Vec3[];
  };
  interceptors: Interceptor[];
  flares: Flare[];
  flaresLeft: number;
  score: number;
  closest: number; // closest any interceptor has gotten [m]
  reason: string; // why escaped/intercepted
}

// ----------------------------------------------------------------------------- engine
export class ArenaSim {
  readonly profile: VehicleProfile;
  readonly diff: DifficultyKnobs;
  readonly arenaRadius: number;
  readonly seed: number;
  state: ArenaState;
  private rng: RNG;
  private nextId = 0;
  private flareCooldown = 0;
  private prevFlareBtn = false;
  private nextLaunchT = 0;
  /** ground air-defence battery sites [x,y,z] that interceptors launch from */
  launchSites: Vec3[] = [];
  /** terrain/structure height at (x,z); supplied by the renderer for crash + spawn safety */
  groundHeight: (x: number, z: number) => number = () => 0;

  constructor(vehicle: VehicleKind, difficulty: number, opts?: { arenaRadius?: number; seed?: number; groundHeight?: (x: number, z: number) => number; launchSites?: Vec3[]; startAlt?: number; profile?: Partial<VehicleProfile>; holdFire?: number }) {
    this.profile = { ...VEHICLES[vehicle], ...opts?.profile };
    this.diff = difficultyFor(difficulty);
    this.arenaRadius = opts?.arenaRadius ?? 9000;
    this.seed = opts?.seed ?? Math.floor(Math.random() * 1_000_000);
    this.rng = new RNG(this.seed);
    if (opts?.groundHeight) this.groundHeight = opts.groundHeight;
    const p = this.profile;
    const startAlt = opts?.startAlt ?? Math.max(900, this.groundHeight(0, 0) + 700);
    this.state = {
      status: "ready",
      t: 0,
      player: {
        pos: [0, startAlt, 0],
        vel: [p.cruise, 0, 0],
        dir: [1, 0, 0],
        up: [0, 1, 0],
        speed: p.cruise,
        gLoad: 0,
        energy: 1,
        trail: [],
      },
      interceptors: [],
      flares: [],
      flaresLeft: this.diff.flares,
      score: 0,
      closest: Infinity,
      reason: "",
    };
    this.launchSites = opts?.launchSites && opts.launchSites.length
      ? opts.launchSites.map((s) => [...s] as Vec3)
      : this.defaultSites();
    // pre-allocate the slots the battery keeps airborne; launch the first round
    // immediately unless the caller asked for a hold-fire grace period
    for (let i = 0; i < this.diff.maxConcurrent; i++) this.state.interceptors.push(this.makeSlot());
    if (opts?.holdFire && opts.holdFire > 0) {
      this.nextLaunchT = opts.holdFire;
    } else {
      this.launchNext();
      this.nextLaunchT = this.diff.reloadDelay;
    }
  }

  /** A ring of ground batteries if the renderer didn't supply sites. */
  private defaultSites(): Vec3[] {
    const sites: Vec3[] = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      const r = 6500;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      sites.push([x, this.groundHeight(x, z) + 25, z]);
    }
    return sites;
  }

  /** An empty (dead) interceptor slot the battery can reload. */
  private makeSlot(): Interceptor {
    const id = this.nextId++;
    return {
      id, pos: [0, 0, 0], vel: [0, 0, 0], speed: this.diff.speed,
      alive: false, active: false, launchT: 0, origin: [0, 0, 0],
      lockLostFor: 0, locked: false, seducedFor: 0, trail: [],
      tele: { id, R: Infinity, Vc: 0, lambdaDot: 0, tGo: Infinity, cmdG: 0, achG: 0, saturated: false, locked: false, seduced: false, pos: [0, 0, 0], vel: [0, 0, 0] },
    };
  }

  /** Reload a free slot and fire it from the next battery site at the player's live position. */
  private launchNext(): boolean {
    const slot = this.state.interceptors.find((i) => !i.alive);
    if (!slot) return false;
    // seed picks which battery fires (deterministic per seed, varied across seeds)
    const site = this.launchSites[Math.floor(this.rng.uniform(0, this.launchSites.length)) % this.launchSites.length];
    const origin: Vec3 = [site[0], site[1], site[2]];
    const toPlayer = unit(sub(this.state.player.pos, origin));
    // SAMs boost vertically off the rail before pitching over toward the target, with a
    // touch of launch dispersion so a wave doesn't fly in perfect formation
    const jit = () => this.rng.uniform(-0.05, 0.05);
    const launchDir = unit([toPlayer[0] + jit(), Math.max(toPlayer[1], 0.4) + 0.7, toPlayer[2] + jit()]);
    slot.pos = [...origin] as Vec3;
    slot.origin = origin;
    slot.vel = scale(launchDir, this.diff.speed);
    slot.speed = this.diff.speed;
    slot.alive = true;
    slot.active = true;
    slot.launchT = this.state.t;
    slot.lockLostFor = 0;
    slot.locked = true;
    slot.seducedFor = 0;
    slot.trail = [];
    slot.diedTo = undefined;
    return true;
  }

  start(): void {
    if (this.state.status === "ready") this.state.status = "flying";
  }

  /** Advance the simulation by dt seconds under the given player input. */
  step(dt: number, input: ArenaInput): ArenaState {
    const s = this.state;
    if (s.status !== "flying") return s;
    s.t += dt;
    const p = this.profile;
    const pl = s.player;

    // -------- player flight model (point-mass with orientation, drag, throttle) ------
    // throttle sets a target speed; boost overrides toward vMax
    const targetSpeed = input.boost ? p.vMax : p.vMin + (p.vMax - p.vMin) * Math.max(0, Math.min(1, input.throttle));
    pl.speed += (targetSpeed - pl.speed) * Math.min(1, 1.5 * dt);

    // turn the velocity frame; commanded turn = lateral g, CLAMPED to the airframe limit
    const right = unit(cross(pl.dir, pl.up));
    let yawRate = input.yaw * p.turnRate;
    let pitchRate = -input.pitch * p.turnRate;
    const rollRate = input.roll * p.rollRate;
    // enforce the structural g-limit: a = omega * v <= aMaxG * g0
    const omegaMax = (p.aMaxG * G0) / Math.max(pl.speed, 1);
    const omegaReq = Math.hypot(yawRate, pitchRate);
    if (omegaReq > omegaMax && omegaReq > 1e-6) {
      const k = omegaMax / omegaReq;
      yawRate *= k;
      pitchRate *= k;
    }
    pl.dir = unit(rotateAround(pl.dir, pl.up, yawRate * dt));
    pl.dir = unit(rotateAround(pl.dir, right, pitchRate * dt));
    pl.up = unit(rotateAround(pl.up, pl.dir, rollRate * dt));
    // re-orthogonalize up against dir
    pl.up = unit(sub(pl.up, scale(pl.dir, dot(pl.up, pl.dir))));

    // structural g actually pulled (post-limit)
    const omega = Math.hypot(yawRate, pitchRate);
    pl.gLoad = (omega * pl.speed) / G0;
    // induced drag bleeds speed during hard turns (energy realism)
    pl.speed -= p.dragK * omega * omega * pl.speed * dt;
    pl.speed = Math.max(p.vMin, Math.min(p.vMax, pl.speed));
    pl.energy = (pl.speed - p.vMin) / (p.vMax - p.vMin);

    pl.vel = scale(pl.dir, pl.speed);
    pl.pos = add(pl.pos, scale(pl.vel, dt));

    // keep the player inside the arena dome (soft turn-back)
    this.confine(pl);

    pushTrail(pl.trail, pl.pos, 240);

    // -------- flares --------
    this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    const flarePressed = !!input.flare && !this.prevFlareBtn;
    this.prevFlareBtn = !!input.flare;
    if (flarePressed && s.flaresLeft > 0 && this.flareCooldown <= 0) {
      s.flares.push({ pos: [...pl.pos] as Vec3, vel: [...pl.vel] as Vec3, life: 3.2, max: 3.2 });
      s.flaresLeft -= 1;
      this.flareCooldown = 0.4;
    }
    for (let i = s.flares.length - 1; i >= 0; i--) {
      const f = s.flares[i];
      f.life -= dt;
      if (f.life <= 0) {
        s.flares.splice(i, 1);
        continue;
      }
      f.vel = scale(f.vel, Math.max(0, 1 - 2.0 * dt)); // flares decelerate fast
      f.vel = [f.vel[0], f.vel[1] - 60 * dt, f.vel[2]]; // and drop
      f.pos = add(f.pos, scale(f.vel, dt));
    }

    // -------- terrain crash (you flew into the ground / a building) --------
    const groundY = this.groundHeight(pl.pos[0], pl.pos[2]);
    if (pl.pos[1] <= groundY + 12) {
      pl.pos[1] = groundY + 12;
      s.status = "crashed";
      s.reason = "You flew into the terrain — keep an eye on your altitude while you evade.";
      return s;
    }

    // -------- the battery reloads and keeps firing --------
    if (s.t >= this.nextLaunchT) {
      if (this.launchNext()) this.nextLaunchT = s.t + this.diff.reloadDelay;
      else this.nextLaunchT = s.t + 0.4; // all tubes airborne — retry when one frees
    }

    // -------- interceptors (the real 3-D PN guidance) --------
    const fovCos = Math.cos((this.diff.fovDeg * Math.PI) / 180);
    let curMin = Infinity;
    for (const it of s.interceptors) {
      if (!it.alive) continue;
      this.stepInterceptor(it, dt, fovCos);
      if (it.alive) curMin = Math.min(curMin, it.tele.R);
      // a missile that flies into terrain is spent (terrain-masking is a real tactic)
      if (it.alive && it.pos[1] <= this.groundHeight(it.pos[0], it.pos[2]) + 6) {
        it.alive = false;
        it.diedTo = "terrain";
      }
    }

    // -------- outcome --------
    if (s.closest < this.diff.lethal) {
      s.status = "intercepted";
      s.reason = this.interceptReason();
      return s;
    }
    if (s.t >= this.diff.surviveTime) {
      // you outlasted the battery's barrage — the only way to win
      s.status = "escaped";
      s.reason = this.escapeReason();
      s.score += Math.round(800 + s.t * 30);
      return s;
    }
    // running score: reward time alive + bravery (flying near a live interceptor)
    const bravery = isFinite(curMin) ? Math.max(0, (this.diff.lethal * 10 - curMin) / 40) : 0;
    s.score += dt * (12 + bravery);
    return s;
  }

  private stepInterceptor(it: Interceptor, dt: number, fovCos: number): void {
    const s = this.state;
    const pl = s.player;

    // out of fuel: the motor burns out and the round goes ballistic / self-destructs
    if (s.t - it.launchT > this.diff.maxFlight) {
      it.alive = false;
      it.diedTo = "missed";
      return;
    }

    // pick what the seeker is looking at: a seducing flare (if any in view) or the player
    let target = pl.pos;
    let seduced = false;
    if (s.flares.length) {
      // a flare within the seeker FOV and closer angle can capture the seeker
      for (const f of s.flares) {
        const toF = unit(sub(f.pos, it.pos));
        if (dot(unit(it.vel), toF) > fovCos && f.life > 1.5) {
          target = f.pos;
          seduced = true;
          it.seducedFor = 0.9;
          break;
        }
      }
    }
    if (!seduced && it.seducedFor > 0) {
      it.seducedFor = Math.max(0, it.seducedFor - dt);
      // stay seduced toward the last flare briefly
      if (s.flares.length) target = s.flares[s.flares.length - 1].pos;
      seduced = it.seducedFor > 0;
    }

    const Rvec = sub(target, it.pos);
    const Rtrue = sub(pl.pos, it.pos);
    const Vrel = sub(pl.vel, it.vel);
    const R = norm(Rvec);
    const Rt = norm(Rtrue);
    const losU = unit(Rtrue);

    // seeker FOV / loss-of-lock against the TRUE player
    const inFov = dot(unit(it.vel), losU) > fovCos;
    if (inFov) it.lockLostFor = 0;
    else it.lockLostFor += dt;
    it.locked = it.lockLostFor < 0.6;

    // 3-D proportional navigation: a = N · (Ω × v),  Ω = (R × Vrel)/R²
    let aCmd: Vec3 = [0, 0, 0];
    let cmdMag = 0;
    if (it.locked) {
      const R2 = Math.max(R * R, 1e-6);
      const omega = scale(cross(Rvec, sub(pl.vel, it.vel)), 1 / R2);
      aCmd = scale(cross(omega, it.vel), this.diff.N);
      cmdMag = norm(aCmd);
    }
    const aMax = this.diff.aMaxG * G0;
    const aAch = clampMag(aCmd, aMax);

    // integrate the interceptor (turn the velocity; speed held)
    it.vel = add(it.vel, scale(aAch, dt));
    it.vel = scale(unit(it.vel), it.speed);
    it.pos = add(it.pos, scale(it.vel, dt));
    pushTrail(it.trail, it.pos, 200);

    // proximity fuze vs the TRUE player
    s.closest = Math.min(s.closest, Rt);
    // mark this interceptor dead if it sails far past (missed) and is opening fast
    const Vc = -dot(losU, Vrel);
    if (Rt > 4000 && Vc < -50 && it.lockLostFor > 1.0) {
      it.alive = false;
      it.diedTo = "missed";
    }

    // telemetry for the engineer overlay
    it.tele = {
      id: it.id,
      R: Rt,
      Vc,
      lambdaDot: it.locked ? norm(scale(cross(Rtrue, Vrel), 1 / Math.max(Rt * Rt, 1e-6))) : 0,
      tGo: Vc > 1 ? Rt / Vc : Infinity,
      cmdG: cmdMag / G0,
      achG: norm(aAch) / G0,
      saturated: cmdMag > aMax * 1.001,
      locked: it.locked,
      seduced,
      pos: [...it.pos] as Vec3,
      vel: [...it.vel] as Vec3,
    };
  }

  private confine(pl: ArenaState["player"]): void {
    const horiz = Math.hypot(pl.pos[0], pl.pos[2]);
    if (horiz > this.arenaRadius) {
      // nudge velocity back toward center
      const inward = unit([-pl.pos[0], 0, -pl.pos[2]]);
      pl.dir = unit(add(pl.dir, scale(inward, 0.04)));
      pl.vel = scale(pl.dir, pl.speed);
    }
    // ceiling only — the terrain (via the crash check) is the real floor, so you can fly
    // low through canyons / between buildings, but hitting the deck ends the run.
    pl.pos[1] = Math.min(4600, pl.pos[1]);
  }

  private interceptReason(): string {
    return "The interceptor nulled the line-of-sight rate before you could break it — constant bearing, decreasing range.";
  }

  private escapeReason(): string {
    const secs = Math.round(this.diff.surviveTime);
    return `You outlasted the battery — ${secs} seconds under continuous fire and not one round connected. Flares, terrain-masking and out-turning every shot kept you alive.`;
  }

  deployFlareReady(): boolean {
    return this.state.flaresLeft > 0 && this.flareCooldown <= 0;
  }
}

function pushTrail(trail: Vec3[], p: Vec3, max: number): void {
  trail.push([p[0], p[1], p[2]]);
  if (trail.length > max) trail.shift();
}

