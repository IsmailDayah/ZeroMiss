"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EKF, IMM, radarMeasure } from "@/lib/sim/tracker";
import { RNG } from "@/lib/sim/rng";

const CYAN = "#37e0e6";
const AMBER = "#ffb454";
const MUTED = "#7c8aa5";
const WHITE = "#f4f8ff";

type Profile = "weave" | "coast_then_break";

interface Frame {
  truth: Array<[number, number]>;
  meas: Array<[number, number]>;
  ekf: Array<[number, number]>;
  imm: Array<[number, number]>;
  rmsRaw: number;
  rmsEkf: number;
  rmsImm: number;
  manProb: number;
}

function simulate(profile: Profile, seed: number, noiseR = 25, noiseB = 6e-3): Frame {
  const rng = new RNG(seed);
  const dt = 0.02;
  const T = 9;
  let x = 6000, y = 0, vx = -300, vy = 0;
  const ekf = new EKF(120, noiseR, noiseB);
  const imm = new IMM(2, 8000, noiseR, noiseB);
  ekf.initialize(x, y, vx, vy);
  imm.initialize(x, y, vx, vy);
  const truth: Array<[number, number]> = [];
  const meas: Array<[number, number]> = [];
  const ekfP: Array<[number, number]> = [];
  const immP: Array<[number, number]> = [];
  const eRaw: number[] = [], eE: number[] = [], eI: number[] = [];
  for (let t = 0; t < T; t += dt) {
    const a = profile === "weave" ? 9 * 9.81 * Math.sin((2 * Math.PI * t) / 2.2) : t < 4 ? 0 : 11 * 9.81;
    const sp = Math.hypot(vx, vy);
    const hd = Math.atan2(vy, vx) + (a / sp) * dt;
    vx = sp * Math.cos(hd);
    vy = sp * Math.sin(hd);
    x += vx * dt;
    y += vy * dt;
    truth.push([x, y]);
    const z = radarMeasure(0, 0, x, y, rng, noiseR, noiseB);
    const rx = z[0] * Math.cos(z[1]);
    const ry = z[0] * Math.sin(z[1]);
    meas.push([rx, ry]);
    ekf.predict(dt);
    ekf.update(z, 0, 0);
    const e = ekf.estimate();
    ekfP.push([e[0], e[1]]);
    imm.step(dt, z, 0, 0);
    const i = imm.estimate();
    immP.push([i[0], i[1]]);
    eRaw.push(Math.hypot(rx - x, ry - y));
    eE.push(Math.hypot(e[0] - x, e[1] - y));
    eI.push(Math.hypot(i[0] - x, i[1] - y));
  }
  const rms = (arr: number[]) => Math.sqrt(arr.slice(40).reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length - 40));
  return { truth, meas, ekf: ekfP, imm: immP, rmsRaw: rms(eRaw), rmsEkf: rms(eE), rmsImm: rms(eI), manProb: imm.maneuverProbability };
}

export default function TrackerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [profile, setProfile] = useState<Profile>("coast_then_break");
  const [seed, setSeed] = useState(3);
  const [frame, setFrame] = useState<Frame | null>(null);

  const run = useCallback(() => setFrame(simulate(profile, seed)), [profile, seed]);
  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, w, h);
    const all = [...frame.truth, ...frame.meas];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of all) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const pad = 0.08 * Math.max(maxX - minX, maxY - minY, 1);
    const sx = w / (maxX - minX + 2 * pad);
    const sy = h / (maxY - minY + 2 * pad);
    const sc = Math.min(sx, sy);
    const toX = (px: number) => (px - minX + pad) * sc;
    const toY = (py: number) => h - (py - minY + pad) * sc;
    // measurements (scatter)
    ctx.fillStyle = "rgba(124,138,165,0.5)";
    for (const [px, py] of frame.meas) {
      ctx.beginPath();
      ctx.arc(toX(px), toY(py), 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const line = (pts: Array<[number, number]>, color: string, wd: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = wd;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(toX(px), toY(py)) : ctx.moveTo(toX(px), toY(py))));
      ctx.stroke();
    };
    line(frame.ekf, "#a8742f", 1.5); // EKF (dim amber)
    line(frame.imm, AMBER, 2); // IMM (bright)
    line(frame.truth, CYAN, 2); // truth
    // legend
    ctx.font = "11px ui-monospace, monospace";
    const leg: Array<[string, string]> = [["truth", CYAN], ["IMM est", AMBER], ["EKF est", "#a8742f"], ["radar meas", MUTED]];
    leg.forEach((l, i) => {
      ctx.fillStyle = l[1];
      ctx.fillRect(10, 12 + i * 16, 10, 3);
      ctx.fillStyle = WHITE;
      ctx.fillText(l[0], 26, 16 + i * 16);
    });
  }, [frame]);

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Tracker in the Loop</h1>
        <span className="text-sm text-muted">
          A radar gives only noisy range/bearing. An EKF + IMM estimate the target before guidance can use it — estimation &amp; sensor fusion.
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([["coast_then_break", "Coast → break"], ["weave", "Weave"]] as Array<[Profile, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setProfile(id)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${profile === id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
        <button className="btn" onClick={() => { setSeed((s) => s + 1); }}>🎲 New noise</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <ErrorBoundary label="Tracker">
          <div className="card p-2">
            <canvas ref={canvasRef} className="h-80 w-full rounded" role="img" aria-label="Radar tracking estimate vs truth" />
          </div>
        </ErrorBoundary>
        <div className="card flex flex-col gap-3 p-4" aria-live="polite">
          <Stat label="Raw measurement RMS" value={`${frame?.rmsRaw.toFixed(1) ?? "—"} m`} />
          <Stat label="EKF RMS error" value={`${frame?.rmsEkf.toFixed(1) ?? "—"} m`} accent="#a8742f" />
          <Stat label="IMM RMS error" value={`${frame?.rmsImm.toFixed(1) ?? "—"} m`} accent={AMBER} testId="trk-imm-rms" big />
          <Stat label="IMM maneuver prob." value={frame ? frame.manProb.toFixed(2) : "—"} />
          <p className="mt-1 text-xs text-muted">
            On the weave both filters beat the raw radar several-fold. Coast-then-break is
            where they separate: the fixed-gain EKF is tuned for constant velocity, so it lags
            through the break badly enough to end up worse than the raw measurements, while the
            IMM detects the maneuver, switches models and stays ahead — which is precisely why
            you run both. Same math (cross-checked) runs in the Python core&apos;s
            tracker-in-the-loop engagements.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, big, testId }: { label: string; value: string; accent?: string; big?: boolean; testId?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`tnum ${big ? "text-2xl" : "text-lg"}`} style={{ color: accent }} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
