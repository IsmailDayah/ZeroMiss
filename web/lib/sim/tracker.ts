/**
 * Tracker-in-the-loop (TS port of `engine/zeromiss/tracker.py`): radar EKF + IMM.
 *
 * Estimates the target's [x, y, vx, vy] from noisy range/bearing measurements. The IMM
 * blends a quiet and a maneuvering EKF so it tracks both a coasting and a hard-turning
 * target without the lag a single model suffers. Used by the /tracker demo page.
 */

import type { RNG } from "./rng";

type Vec4 = [number, number, number, number];
type Mat4 = number[][]; // 4x4

export function radarMeasure(
  mx: number, my: number, tx: number, ty: number, rng: RNG, sigmaR: number, sigmaBeta: number,
): [number, number] {
  const dx = tx - mx;
  const dy = ty - my;
  return [Math.hypot(dx, dy) + rng.normal(0, sigmaR), Math.atan2(dy, dx) + rng.normal(0, sigmaBeta)];
}

function wrapPi(a: number): number {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function eye4(s = 1): Mat4 {
  return [
    [s, 0, 0, 0],
    [0, s, 0, 0],
    [0, 0, s, 0],
    [0, 0, 0, s],
  ];
}

function matAdd(A: Mat4, B: Mat4): Mat4 {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function mat4mul(A: Mat4, B: Mat4): Mat4 {
  const C: Mat4 = eye4(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
  return C;
}

function Qcv(dt: number, q: number): Mat4 {
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;
  return [
    [(q * dt4) / 4, 0, (q * dt3) / 2, 0],
    [0, (q * dt4) / 4, 0, (q * dt3) / 2],
    [(q * dt3) / 2, 0, q * dt2, 0],
    [0, (q * dt3) / 2, 0, q * dt2],
  ];
}

export class EKF {
  x: Vec4 = [0, 0, 0, 0];
  P: Mat4 = eye4(1e6);
  constructor(public q = 50, public sigmaR = 20, public sigmaBeta = 5e-3) {}

  initialize(x: number, y: number, vx = 0, vy = 0): void {
    this.x = [x, y, vx, vy];
    this.P = [
      [1e3, 0, 0, 0],
      [0, 1e3, 0, 0],
      [0, 0, 1e4, 0],
      [0, 0, 0, 1e4],
    ];
  }

  predict(dt: number): void {
    const F: Mat4 = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    this.x = [
      this.x[0] + dt * this.x[2],
      this.x[1] + dt * this.x[3],
      this.x[2],
      this.x[3],
    ];
    this.P = matAdd(mat4mul(mat4mul(F, this.P), transpose(F)), Qcv(dt, this.q));
  }

  /** Correct with z=[r,beta] from sensor (sx,sy); returns the innovation likelihood. */
  update(z: [number, number], sx: number, sy: number): number {
    const dx = this.x[0] - sx;
    const dy = this.x[1] - sy;
    const r2 = Math.max(dx * dx + dy * dy, 1e-9);
    const r = Math.sqrt(r2);
    const h: [number, number] = [r, Math.atan2(dy, dx)];
    // H is 2x4
    const H = [
      [dx / r, dy / r, 0, 0],
      [-dy / r2, dx / r2, 0, 0],
    ];
    const y: [number, number] = [z[0] - h[0], wrapPi(z[1] - h[1])];
    // S = H P H^T + R   (2x2)
    const HP = mul(H, this.P); // 2x4
    const S = add2(mul2(HP, transpose(H) as number[][]), [
      [this.sigmaR ** 2, 0],
      [0, this.sigmaBeta ** 2],
    ]);
    const Sinv = inv2(S);
    // K = P H^T S^-1  (4x2)
    const PHt = mul(this.P, transpose(H) as number[][]); // 4x2
    const K = mul(PHt, Sinv); // 4x2
    // x += K y
    for (let i = 0; i < 4; i++) this.x[i] += K[i][0] * y[0] + K[i][1] * y[1];
    // P = (I - K H) P
    const KH = mul(K, H); // 4x4
    const ImKH: Mat4 = eye4(1).map((row, i) => row.map((v, j) => v - KH[i][j]));
    this.P = mat4mul(ImKH, this.P);
    // likelihood
    const det = Math.max(2 * Math.PI * Math.sqrt(S[0][0] * S[1][1] - S[0][1] * S[1][0]), 1e-12);
    const m = y[0] * (Sinv[0][0] * y[0] + Sinv[0][1] * y[1]) + y[1] * (Sinv[1][0] * y[0] + Sinv[1][1] * y[1]);
    return Math.exp(-0.5 * m) / det;
  }

  estimate(): Vec4 {
    return [...this.x] as Vec4;
  }
}

export class IMM {
  models: EKF[];
  mu = [0.5, 0.5];
  Pi: number[][];
  constructor(qQuiet = 5, qManeuver = 5000, sigmaR = 20, sigmaBeta = 5e-3, piStay = 0.95) {
    this.models = [new EKF(qQuiet, sigmaR, sigmaBeta), new EKF(qManeuver, sigmaR, sigmaBeta)];
    this.Pi = [
      [piStay, 1 - piStay],
      [1 - piStay, piStay],
    ];
  }
  initialize(x: number, y: number, vx = 0, vy = 0): void {
    for (const m of this.models) m.initialize(x, y, vx, vy);
  }
  step(dt: number, z: [number, number], sx: number, sy: number): void {
    const n = 2;
    const cbar = [0, 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cbar[j] += this.Pi[i][j] * this.mu[i];
    for (let j = 0; j < n; j++) cbar[j] = Math.max(cbar[j], 1e-12);
    const xs = this.models.map((m) => m.estimate());
    const Ps = this.models.map((m) => m.P.map((r) => [...r]));
    for (let j = 0; j < n; j++) {
      const x0: Vec4 = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const w = (this.Pi[i][j] * this.mu[i]) / cbar[j];
        for (let k = 0; k < 4; k++) x0[k] += w * xs[i][k];
      }
      const P0: Mat4 = eye4(0);
      for (let i = 0; i < n; i++) {
        const w = (this.Pi[i][j] * this.mu[i]) / cbar[j];
        const d = [xs[i][0] - x0[0], xs[i][1] - x0[1], xs[i][2] - x0[2], xs[i][3] - x0[3]];
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) P0[a][b] += w * (Ps[i][a][b] + d[a] * d[b]);
      }
      this.models[j].x = x0;
      this.models[j].P = P0;
    }
    const L = [0, 0];
    for (let j = 0; j < n; j++) {
      this.models[j].predict(dt);
      L[j] = this.models[j].update(z, sx, sy);
    }
    let s = 0;
    for (let j = 0; j < n; j++) {
      this.mu[j] = cbar[j] * L[j];
      s += this.mu[j];
    }
    for (let j = 0; j < n; j++) this.mu[j] = s > 1e-12 ? this.mu[j] / s : 1 / n;
  }
  estimate(): Vec4 {
    const e: Vec4 = [0, 0, 0, 0];
    for (let j = 0; j < this.models.length; j++) {
      const x = this.models[j].estimate();
      for (let k = 0; k < 4; k++) e[k] += this.mu[j] * x[k];
    }
    return e;
  }
  get maneuverProbability(): number {
    return this.mu[1];
  }
}

// --- tiny generic matrix helpers (rows x cols as number[][]) ---
function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]));
}
function mul(A: number[][], B: number[][]): number[][] {
  const r = A.length;
  const c = B[0].length;
  const k0 = B.length;
  const C = Array.from({ length: r }, () => new Array(c).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { let s = 0; for (let k = 0; k < k0; k++) s += A[i][k] * B[k][j]; C[i][j] = s; }
  return C;
}
function mul2(A: number[][], B: number[][]): number[][] {
  return mul(A, B);
}
function add2(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}
function inv2(S: number[][]): number[][] {
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  const d = Math.abs(det) < 1e-12 ? 1e-12 : det;
  return [
    [S[1][1] / d, -S[0][1] / d],
    [-S[1][0] / d, S[0][0] / d],
  ];
}
