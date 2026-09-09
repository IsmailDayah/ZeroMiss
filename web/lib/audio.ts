/**
 * Synthesised SFX via WebAudio — no asset bloat. Lock tone, launch
 * whoosh, terminal boom, and a downward "miss" tone. A single shared, muteable engine.
 * All sounds are generated from oscillators/noise so the bundle ships zero audio files.
 */

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

function env(node: AudioNode, gain: GainNode, t0: number, attack: number, hold: number, release: number, peak = 0.3) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.setValueAtTime(peak, t0 + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  node.connect(gain).connect(ctx!.destination);
}

/** Rising two-tone "lock acquired" chirp. */
export function playLock(): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, t0);
  osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.18);
  env(osc, g, t0, 0.01, 0.05, 0.18, 0.18);
  osc.start(t0);
  osc.stop(t0 + 0.3);
}

/** Filtered-noise launch whoosh. */
export function playLaunch(): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const buffer = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.setValueAtTime(300, t0);
  filt.frequency.exponentialRampToValueAtTime(2000, t0 + 0.5);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + 0.6);
}

/** Bass thump + bright flash transient for a HIT. */
export function playHit(): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.4);
  env(osc, g, t0, 0.005, 0.03, 0.5, 0.5);
  osc.start(t0);
  osc.stop(t0 + 0.6);
  // bright transient
  const o2 = c.createOscillator();
  const g2 = c.createGain();
  o2.type = "triangle";
  o2.frequency.setValueAtTime(2400, t0);
  env(o2, g2, t0, 0.002, 0.01, 0.12, 0.2);
  o2.start(t0);
  o2.stop(t0 + 0.2);
}

/** Descending "it got away" tone for a MISS. */
export function playMiss(): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(440, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.5);
  env(osc, g, t0, 0.01, 0.05, 0.5, 0.14);
  osc.start(t0);
  osc.stop(t0 + 0.6);
}
