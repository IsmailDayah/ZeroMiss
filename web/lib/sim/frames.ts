/**
 * Coordinate frames, angle utilities, and line-of-sight (LOS) geometry.
 *
 * This is a faithful TypeScript port of `engine/zeromiss/frames.py`. Pure and
 * stateless; identical arithmetic order to the Python source so the twin reproduces
 * Python reference runs to < 0.1 %.
 *
 * SI units throughout (metres, seconds, radians). Planar convention: +x downrange,
 * +y crossrange, heading CCW from +x, positive lateral accel turns velocity CCW.
 */

const TWO_PI = 2.0 * Math.PI;

export function wrapToPi(angle: number): number {
  let a = ((angle + Math.PI) % TWO_PI);
  if (a <= 0.0) a += TWO_PI;
  return a - Math.PI;
}

export const deg2rad = (d: number): number => (d * Math.PI) / 180.0;
export const rad2deg = (r: number): number => (r * 180.0) / Math.PI;

export interface Kinematic {
  x: number;
  y: number;
  speed: number;
  heading: number;
}

export function vx(k: Kinematic): number {
  return k.speed * Math.cos(k.heading);
}
export function vy(k: Kinematic): number {
  return k.speed * Math.sin(k.heading);
}

export interface Geometry {
  R: number;
  lam: number;
  lambdaDot: number;
  Vc: number;
  tGo: number;
  zemPerp: number;
  Rdot: number;
  closing: boolean;
  aTPerp: number;
  Vm: number;
  headingError: number;
  losOffBoresight: number;
}

function safeDiv(num: number, den: number, def = 0.0): number {
  if (Math.abs(den) < 1e-12) return def;
  return num / den;
}

export function relativeState(
  missile: Kinematic,
  target: Kinematic,
  aTPerpLos = 0.0,
  tGoFloor = 1e-3,
): Geometry {
  const dx = target.x - missile.x;
  const dy = target.y - missile.y;
  const R = Math.hypot(dx, dy);
  const lam = Math.atan2(dy, dx);

  const dvx = vx(target) - vx(missile);
  const dvy = vy(target) - vy(missile);

  const lambdaDot = safeDiv(dx * dvy - dy * dvx, R * R);
  const Rdot = safeDiv(dx * dvx + dy * dvy, R);
  const Vc = -Rdot;

  let tGo: number;
  if (Vc > 1e-6) tGo = Math.max(R / Vc, tGoFloor);
  else tGo = Infinity;

  let zemPerp: number;
  if (!isFinite(tGo)) zemPerp = 0.0;
  else zemPerp = R * lambdaDot * tGo + 0.5 * aTPerpLos * tGo * tGo;

  const headingError = wrapToPi(lam - missile.heading);

  return {
    R,
    lam,
    lambdaDot,
    Vc,
    tGo,
    zemPerp,
    Rdot,
    closing: Vc > 0.0,
    aTPerp: aTPerpLos,
    Vm: missile.speed,
    headingError,
    losOffBoresight: Math.abs(headingError),
  };
}

export function perpendicularComponent(
  accel: number,
  accelHeading: number,
  losAngle: number,
): number {
  return accel * Math.cos(accelHeading - losAngle);
}
