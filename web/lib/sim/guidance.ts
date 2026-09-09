/**
 * Guidance laws — port of `engine/zeromiss/guidance/laws.py`.
 *
 * Each law is the same pure function (Geometry, GuidanceParams) -> a_cmd [m/s^2].
 */

import type { Geometry } from "./frames";
import { wrapToPi } from "./frames";

export interface GuidanceParams {
  N: number;
  useTargetAccel: boolean;
}

export type GuidanceLaw = (g: Geometry, p: GuidanceParams) => number;

export const purePursuit: GuidanceLaw = (g, p) => p.N * g.Vm * g.headingError;
export const purePronav: GuidanceLaw = (g, p) => p.N * g.Vm * g.lambdaDot;
export const truePronav: GuidanceLaw = (g, p) => p.N * g.Vc * g.lambdaDot;

export const augmentedPronav: GuidanceLaw = (g, p) => {
  let base = p.N * g.Vc * g.lambdaDot;
  if (p.useTargetAccel) base += 0.5 * p.N * g.aTPerp;
  return base;
};

export const optimalZem: GuidanceLaw = (g, p) => {
  if (!isFinite(g.tGo) || g.tGo <= 0.0) return 0.0;
  let zem = g.zemPerp;
  if (!p.useTargetAccel) zem -= 0.5 * g.aTPerp * g.tGo * g.tGo;
  return (p.N * zem) / (g.tGo * g.tGo);
};

export const LAWS: Record<string, GuidanceLaw> = {
  pursuit: purePursuit,
  ppn: purePronav,
  tpn: truePronav,
  apn: augmentedPronav,
  ogl: optimalZem,
  zem: optimalZem,
};

export function getLaw(name: string): GuidanceLaw {
  const law = LAWS[name.toLowerCase().trim()];
  if (!law) throw new Error(`Unknown guidance law: ${name}`);
  return law;
}

export const availableLaws = (): string[] => Object.keys(LAWS);

// re-export for callers that want angle wrapping alongside guidance
export { wrapToPi };
