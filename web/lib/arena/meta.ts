/**
 * Arena meta: local leaderboard + shareable challenge links. No backend — scores live in
 * localStorage; a "share" link encodes the exact engagement setup (vehicle, arena,
 * difficulty, spawn seed) so anyone opening the link faces the same challenge.
 */

import type { ArenaTheme } from "./environments";
import type { VehicleKind } from "../sim/arena";

export interface ScoreEntry {
  score: number;
  vehicle: VehicleKind;
  theme: ArenaTheme;
  difficulty: number;
  t: number;
  win: boolean;
  date: number;
}

const KEY = "zeromiss_arena_scores";

export function loadScores(): ScoreEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as ScoreEntry[];
  } catch {
    return [];
  }
}

export function saveScore(e: ScoreEntry): ScoreEntry[] {
  const all = [...loadScores(), e].sort((a, b) => b.score - a.score).slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full / blocked */
  }
  return all;
}

export function bestScore(): number {
  return loadScores().reduce((m, e) => Math.max(m, e.score), 0);
}

export interface ChallengeConfig {
  vehicle: VehicleKind;
  theme: ArenaTheme;
  difficulty: number;
  seed: number;
}

export function shareLink(c: ChallengeConfig): string {
  const base = typeof window !== "undefined" ? window.location.origin : "https://zeromiss-nu.vercel.app";
  const q = new URLSearchParams({
    v: c.vehicle,
    arena: c.theme,
    d: c.difficulty.toFixed(2),
    seed: String(c.seed),
  });
  return `${base}/arena?${q.toString()}`;
}

export function parseChallenge(params: URLSearchParams): Partial<ChallengeConfig> {
  const out: Partial<ChallengeConfig> = {};
  const v = params.get("v");
  if (v === "jet" || v === "drone") out.vehicle = v;
  const arena = params.get("arena");
  if (arena === "desert" || arena === "ocean" || arena === "city" || arena === "alpine") out.theme = arena;
  const d = params.get("d");
  if (d && isFinite(parseFloat(d))) out.difficulty = Math.max(0, Math.min(1, parseFloat(d)));
  const seed = params.get("seed");
  if (seed && /^\d+$/.test(seed)) out.seed = parseInt(seed, 10);
  return out;
}
