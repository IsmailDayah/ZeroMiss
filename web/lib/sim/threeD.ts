/**
 * True 3-D engagement (TS port of engine/zeromiss/threeD.py). Genuine 3-D proportional
 * navigation — the interceptor and target are full 3-D point masses, so the engagement
 * is out-of-plane, not a flat path drawn in 3-D. Mirrors the Python arithmetic order for
 * cross-validation.
 */

const G0 = 9.80665;
export type Vec3 = [number, number, number];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

function unit(a: Vec3): Vec3 {
  const m = norm(a);
  return m > 1e-12 ? scale(a, 1 / m) : [0, 0, 0];
}
function clampMag(a: Vec3, max: number): Vec3 {
  const m = norm(a);
  return m > max && m > 1e-12 ? scale(a, max / m) : a;
}

export interface Maneuver3D {
  kind: "constant_velocity" | "weave3d" | "barrel" | "climb_turn";
  amplitudeG: number;
  periodS: number;
  startS: number;
}

function maneuverCommand(m: Maneuver3D, t: number, vT: Vec3): Vec3 {
  if (m.kind === "constant_velocity" || t < m.startS) return [0, 0, 0];
  const amp = m.amplitudeG * G0;
  const vhat = unit(vT);
  let e1 = unit(cross(vhat, [0, 0, 1]));
  if (norm(e1) < 1e-6) e1 = unit(cross(vhat, [0, 1, 0]));
  const e2 = unit(cross(vhat, e1));
  const w = (2 * Math.PI) / Math.max(m.periodS, 1e-6);
  const ph = w * (t - m.startS);
  if (m.kind === "weave3d") return scale(e2, amp * Math.sin(ph));
  if (m.kind === "barrel") return add(scale(e1, amp * Math.cos(ph)), scale(e2, amp * Math.sin(ph)));
  if (m.kind === "climb_turn") return add(scale(e1, amp * 0.7), scale(e2, amp * 0.7));
  return [0, 0, 0];
}

export interface Engagement3DSpec {
  missilePos: Vec3;
  missileVel: Vec3;
  targetPos: Vec3;
  targetVel: Vec3;
  N: number;
  aMaxG: number;
  targetAMaxG: number;
  maneuver: Maneuver3D;
  lethalRadiusM: number;
  tMaxS: number;
  dt: number;
}

export interface Frame3D {
  t: number;
  m: Vec3;
  tg: Vec3;
  R: number;
  g: number;
}
export interface Result3D {
  verdict: "HIT" | "MISS";
  missDistance: number;
  peakG: number;
  tFlight: number;
  N: number;
  frames: Frame3D[];
}

function deriv(rM: Vec3, vM: Vec3, rT: Vec3, vT: Vec3, aM: Vec3, aT: Vec3) {
  return [vM, aM, vT, aT] as const;
}
function rk4(rM: Vec3, vM: Vec3, rT: Vec3, vT: Vec3, aM: Vec3, aT: Vec3, dt: number) {
  const k1 = deriv(rM, vM, rT, vT, aM, aT);
  const k2 = deriv(add(rM, scale(k1[0], dt / 2)), add(vM, scale(k1[1], dt / 2)), add(rT, scale(k1[2], dt / 2)), add(vT, scale(k1[3], dt / 2)), aM, aT);
  const k3 = deriv(add(rM, scale(k2[0], dt / 2)), add(vM, scale(k2[1], dt / 2)), add(rT, scale(k2[2], dt / 2)), add(vT, scale(k2[3], dt / 2)), aM, aT);
  const k4 = deriv(add(rM, scale(k3[0], dt)), add(vM, scale(k3[1], dt)), add(rT, scale(k3[2], dt)), add(vT, scale(k3[3], dt)), aM, aT);
  const comb = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 => add(add(a, scale(b, 2)), add(scale(c, 2), d));
  return [
    add(rM, scale(comb(k1[0], k2[0], k3[0], k4[0]), dt / 6)),
    add(vM, scale(comb(k1[1], k2[1], k3[1], k4[1]), dt / 6)),
    add(rT, scale(comb(k1[2], k2[2], k3[2], k4[2]), dt / 6)),
    add(vT, scale(comb(k1[3], k2[3], k3[3], k4[3]), dt / 6)),
  ] as [Vec3, Vec3, Vec3, Vec3];
}

function parabolicMin(t1: number, R0: number, R1: number, R2: number, dt: number): [number, number] {
  const denom = R0 - 2 * R1 + R2;
  if (Math.abs(denom) < 1e-12) return [R1, t1];
  const x = Math.max(-1, Math.min(1, (0.5 * (R0 - R2)) / denom));
  const a = 0.5 * denom;
  const b = 0.5 * (R2 - R0);
  return [Math.max(R1 + b * x + a * x * x, 0), t1 + x * dt];
}

export function runEngagement3D(s: Engagement3DSpec): Result3D {
  let rM = s.missilePos, vM = s.missileVel, rT = s.targetPos, vT = s.targetVel;
  const aMax = s.aMaxG * G0;
  const tAMax = s.targetAMaxG * G0;
  const dt = s.dt;
  const n = Math.round(s.tMaxS / dt);
  let peakG = 0, minR = Infinity, minRt = 0;
  const Rh: number[] = [], th: number[] = [];
  const frames: Frame3D[] = [];
  let closest = false;
  let t = 0;
  const frameEvery = Math.max(1, Math.floor(n / 400));

  for (let step = 0; step <= n; step++) {
    const Rvec = sub(rT, rM);
    const Vrel = sub(vT, vM);
    const R = norm(Rvec);
    const R2 = Math.max(R * R, 1e-9);
    const omega = scale(cross(Rvec, Vrel), 1 / R2);
    const aCmd = scale(cross(omega, vM), s.N);
    const aAch = clampMag(aCmd, aMax);
    const gAch = norm(aAch) / G0;
    peakG = Math.max(peakG, gAch);
    const aT = clampMag(maneuverCommand(s.maneuver, t, vT), tAMax);

    if (step % frameEvery === 0 || step === n) frames.push({ t, m: [...rM] as Vec3, tg: [...rT] as Vec3, R, g: gAch });

    if (R < minR) { minR = R; minRt = t; }
    Rh.push(R); th.push(t);
    if (Rh.length >= 3 && !closest) {
      const R0 = Rh[Rh.length - 3], R1 = Rh[Rh.length - 2], R2v = Rh[Rh.length - 1];
      if (R1 <= R0 && R2v > R1) {
        [minR, minRt] = parabolicMin(th[th.length - 2], R0, R1, R2v, dt);
        closest = true;
        break;
      }
    }
    [rM, vM, rT, vT] = rk4(rM, vM, rT, vT, aAch, aT, dt);
    t += dt;
  }
  return {
    verdict: minR <= s.lethalRadiusM ? "HIT" : "MISS",
    missDistance: minR, peakG, tFlight: minRt, N: s.N, frames,
  };
}
