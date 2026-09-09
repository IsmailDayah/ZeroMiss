/**
 * In-browser Monte-Carlo. Runs randomized
 * engagements through the validated twin and accumulates P_k / CEP / a miss histogram.
 *
 * Designed to be driven in *chunks* across animation frames so the UI never freezes and
 * P_k is seen forming live. Randomization mirrors the Python `montecarlo` block.
 */

import { Engagement } from "./engagement";
import { RNG } from "./rng";
import { cloneScenario, type ScenarioSpec } from "./scenario";

export interface MCRandomize {
  R0?: [number, number]; // uniform lo, hi [m]
  HE_deg?: number; // normal sigma about the nominal heading [deg]
  start_s?: [number, number]; // uniform maneuver start [s]
  noise_mrad?: [number, number]; // uniform seeker noise [mrad]
}

export interface MCAccumulator {
  n: number;
  hits: number;
  misses: number[]; // capped sample for CEP/histogram
  sumMiss: number;
  sumPeakG: number;
  maxMiss: number;
  lethalRadius: number;
}

export function newAccumulator(lethalRadius: number): MCAccumulator {
  return { n: 0, hits: 0, misses: [], sumMiss: 0, sumPeakG: 0, maxMiss: 0, lethalRadius };
}

const DEFAULT_RANDOMIZE: MCRandomize = {
  R0: [6000, 10000],
  HE_deg: 10,
  start_s: [0.5, 2.5],
  noise_mrad: [0, 2],
};

/** Build one randomized scenario from the base + RNG (coarse dt for browser speed). */
export function sampleSpec(base: ScenarioSpec, rng: RNG, rnd: MCRandomize, dt = 0.003): ScenarioSpec {
  const s = cloneScenario(base);
  const mx = s.missile.position[0];
  const my = s.missile.position[1];
  const bearing = Math.atan2(s.target.position[1] - my, s.target.position[0] - mx);
  if (rnd.R0) {
    const R0 = rng.uniform(rnd.R0[0], rnd.R0[1]);
    s.target.position = [mx + R0 * Math.cos(bearing), my + R0 * Math.sin(bearing)];
  }
  if (rnd.HE_deg) s.missile.heading = s.missile.heading + rng.normal(0, rnd.HE_deg);
  if (rnd.start_s && s.target.maneuver.type !== "constant_velocity") {
    s.target.maneuver = { ...s.target.maneuver, start_s: rng.uniform(rnd.start_s[0], rnd.start_s[1]) };
  }
  if (rnd.noise_mrad && !s.missile.seeker.ideal) {
    s.missile.seeker = { ...s.missile.seeker, noiseMrad: rng.uniform(rnd.noise_mrad[0], rnd.noise_mrad[1]) };
  }
  s.dynamics = { ...s.dynamics, dt };
  return s;
}

/** Run one randomized engagement and fold it into the accumulator. */
export function runOne(base: ScenarioSpec, rng: RNG, rnd: MCRandomize, acc: MCAccumulator, dt = 0.003): void {
  const spec = sampleSpec(base, rng, rnd, dt);
  const seed = Math.floor(rng.uniform(0, 2 ** 31));
  const r = new Engagement(spec, seed).run();
  acc.n += 1;
  if (r.verdict === "HIT") acc.hits += 1;
  acc.sumMiss += r.missDistance;
  acc.sumPeakG += r.peakG;
  acc.maxMiss = Math.max(acc.maxMiss, r.missDistance);
  if (acc.misses.length < 20000) acc.misses.push(r.missDistance);
}

/** Run a chunk of `count` engagements (for chunked rAF driving). */
export function runChunk(base: ScenarioSpec, rng: RNG, rnd: MCRandomize, acc: MCAccumulator, count: number, dt = 0.003): void {
  for (let i = 0; i < count; i++) runOne(base, rng, rnd, acc, dt);
}

export function pk(acc: MCAccumulator): number {
  return acc.n ? acc.hits / acc.n : 0;
}
export function cep(acc: MCAccumulator): number {
  if (!acc.misses.length) return 0;
  const sorted = [...acc.misses].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
export function meanMiss(acc: MCAccumulator): number {
  return acc.n ? acc.sumMiss / acc.n : 0;
}

/** A full synchronous campaign (used by unit tests; the UI uses runChunk). */
export function runCampaign(base: ScenarioSpec, runs: number, seed = 0, rnd: MCRandomize = DEFAULT_RANDOMIZE): MCAccumulator {
  const rng = new RNG(seed);
  const acc = newAccumulator(base.termination.lethal_radius_m);
  runChunk(base, rng, rnd, acc, runs);
  return acc;
}

export { DEFAULT_RANDOMIZE };
