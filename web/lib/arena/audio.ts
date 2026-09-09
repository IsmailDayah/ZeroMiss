/**
 * Arena audio — fully synthesised WebAudio (no asset files). A continuous engine drone
 * that tracks throttle, a lock-warning beep, missile whoosh, flare pop, and the intercept
 * boom. One instance per game; respects the global mute in lib/audio.
 */

import { isMuted } from "../audio";

export class ArenaAudio {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilt: BiquadFilterNode | null = null;
  private lockTimer: number | null = null;
  private started = false;
  private windGain: GainNode | null = null;
  private windFilt: BiquadFilterNode | null = null;

  private ac(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  start(): void {
    const c = this.ac();
    if (!c || this.started) return;
    this.started = true;
    this.engineOsc = c.createOscillator();
    this.engineFilt = c.createBiquadFilter();
    this.engineGain = c.createGain();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 70;
    this.engineFilt.type = "lowpass";
    this.engineFilt.frequency.value = 600;
    this.engineGain.gain.value = isMuted() ? 0 : 0.06;
    this.engineOsc.connect(this.engineFilt).connect(this.engineGain).connect(c.destination);
    this.engineOsc.start();
  }

  setEngine(speedFrac: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const f = 55 + speedFrac * 130;
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(isMuted() ? 0 : 0.05 + speedFrac * 0.05, this.ctx.currentTime, 0.1);
  }

  setLockWarning(on: boolean): void {
    if (on && this.lockTimer === null) {
      this.lockTimer = window.setInterval(() => this.beep(880, 0.07, 0.08), 420);
    } else if (!on && this.lockTimer !== null) {
      clearInterval(this.lockTimer);
      this.lockTimer = null;
    }
  }

  private beep(freq: number, dur: number, vol: number): void {
    const c = this.ac();
    if (!c || isMuted()) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  whoosh(): void {
    const c = this.ac();
    if (!c || isMuted()) return;
    const t0 = c.currentTime;
    const buf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(500, t0);
    f.frequency.exponentialRampToValueAtTime(2500, t0 + 0.4);
    const g = c.createGain();
    g.gain.value = 0.18;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(t0 + 0.5);
  }

  flare(): void {
    this.beep(1200, 0.12, 0.12);
  }

  boom(vol = 0.6): void {
    const c = this.ac();
    if (!c || isMuted()) return;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(35, t0 + 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(t0 + 0.8);
    // noise crack
    const buf = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const ng = c.createGain();
    ng.gain.value = vol * 0.66;
    src.connect(ng).connect(c.destination);
    src.start();
  }

  /** An explosion heard from `distM` metres away: delayed by the speed of sound, quieter with range. */
  boomAt(distM: number): void {
    const delayMs = (Math.max(0, distM) / 343) * 1000;
    const vol = Math.max(0.12, Math.min(0.6, 0.6 * (600 / (600 + distM))));
    window.setTimeout(() => this.boom(vol), delayMs);
  }

  /** Wind roar over the mic, tracking airspeed (0..1). The core of the FPV sound-bed. */
  setWind(frac: number): void {
    const c = this.ac();
    if (!c) return;
    if (!this.windGain) {
      const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        // brown-ish noise reads as wind, not static
        last = (last + (Math.random() * 2 - 1) * 0.04) * 0.98;
        d[i] = last * 6;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.windFilt = c.createBiquadFilter();
      this.windFilt.type = "bandpass";
      this.windFilt.frequency.value = 300;
      this.windFilt.Q.value = 0.4;
      this.windGain = c.createGain();
      this.windGain.gain.value = 0;
      src.connect(this.windFilt).connect(this.windGain).connect(c.destination);
      src.start();
    }
    const f = Math.max(0, Math.min(1, frac));
    this.windGain.gain.setTargetAtTime(isMuted() ? 0 : f * f * 0.22, c.currentTime, 0.15);
    this.windFilt!.frequency.setTargetAtTime(220 + f * 700, c.currentTime, 0.2);
  }

  stop(): void {
    this.setLockWarning(false);
    try {
      this.engineOsc?.stop();
    } catch {
      /* already stopped */
    }
    this.engineOsc = null;
    if (this.windGain && this.ctx) this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.started = false;
  }
}
