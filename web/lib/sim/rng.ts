/**
 * A small seedable RNG (mulberry32) + Gaussian sampler for the browser engine.
 *
 * Note: this does NOT match NumPy's Generator, so any run using seeker *noise* is not
 * byte-identical to Python. That is by design — the cross-validation fixtures use an
 * ideal, noise-free seeker, so determinism across engines never depends
 * on the random stream. Noise only appears in interactive/Monte-Carlo browser modes.
 */

export class RNG {
  private state: number;
  private spare: number | null = null;

  constructor(seed = 0) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(lo = 0, hi = 1): number {
    return lo + (hi - lo) * this.next();
  }

  normal(mu = 0, sigma = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mu + sigma * s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    this.spare = mag * Math.sin(2.0 * Math.PI * v);
    return mu + sigma * (mag * Math.cos(2.0 * Math.PI * v));
  }
}
