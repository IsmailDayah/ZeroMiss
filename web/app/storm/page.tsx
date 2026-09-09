"use client";

import { useEffect, useRef, useState } from "react";

import { Engagement } from "@/lib/sim/engagement";
import { usePrefersReducedMotion } from "@/components/hooks";
import { PRESETS } from "@/lib/sim/presets";
import { RNG } from "@/lib/sim/rng";
import { cloneScenario } from "@/lib/sim/scenario";

const CYAN = "#37e0e6";
const AMBER = "#ffb454";
const WHITE = "#f4f8ff";
const DANGER = "#ff5d5d";

const LAWS = ["tpn", "apn", "ppn"];
const MANEUVERS = ["weave", "bang_bang", "step"];

function buildSalvo(count: number, baseSeed: number): Engagement[] {
  const rng = new RNG(baseSeed);
  const engs: Engagement[] = [];
  for (let i = 0; i < count; i++) {
    const s = cloneScenario(PRESETS.the_weave);
    s.seed = baseSeed + i;
    s.missile.position = [0, (i - count / 2) * 700];
    s.missile.guidance.law = LAWS[i % LAWS.length];
    s.missile.guidance.N = 3 + (i % 3);
    s.target.position = [7000 + rng.uniform(-1500, 1500), (i - count / 2) * 700 + rng.uniform(-400, 400)];
    s.target.heading = 180 + rng.uniform(-15, 15);
    s.target.maneuver = {
      type: MANEUVERS[i % MANEUVERS.length],
      amplitude_g: 6 + rng.uniform(0, 6),
      period_s: 1.2 + rng.uniform(0, 1.5),
      start_s: 0.5 + rng.uniform(0, 1.5),
    };
    s.termination.t_max_s = 16;
    engs.push(new Engagement(s, s.seed));
  }
  return engs;
}

export default function StormPage() {
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engsRef = useRef<Engagement[]>([]);
  const trailsRef = useRef<Map<number, { m: number[][]; t: number[][] }>>(new Map());
  const rafRef = useRef(0);
  const accRef = useRef(0);
  const lastRef = useRef(0);
  const [count, setCount] = useState(6);
  const [seed, setSeed] = useState(1234);
  const [stats, setStats] = useState({ hits: 0, total: 0, running: false });

  const start = (n: number, s: number) => {
    cancelAnimationFrame(rafRef.current);
    engsRef.current = buildSalvo(n, s);
    trailsRef.current = new Map();
    engsRef.current.forEach((_, i) => trailsRef.current.set(i, { m: [], t: [] }));
    accRef.current = 0;
    lastRef.current = 0;
    setStats({ hits: 0, total: n, running: true });
    rafRef.current = requestAnimationFrame(loop);
  };

  const loop = (ts: number) => {
    const engs = engsRef.current;
    if (!lastRef.current) lastRef.current = ts;
    let realDt = (ts - lastRef.current) / 1000;
    lastRef.current = ts;
    realDt = Math.min(realDt, 0.05);
    accRef.current += realDt * 1.0;
    const dt = engs[0]?.dt ?? 0.001;
    let steps = Math.floor(accRef.current / dt);
    accRef.current -= steps * dt;
    steps = Math.min(steps, 400);

    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < engs.length; i++) {
        const e = engs[i];
        if (e.done) continue;
        const f = e.stepOnce();
        if (f) {
          const tr = trailsRef.current.get(i)!;
          tr.m.push([f.xM, f.yM]);
          tr.t.push([f.xT, f.yT]);
          if (tr.m.length > 400) tr.m.shift();
          if (tr.t.length > 400) tr.t.shift();
        }
      }
    }
    draw();
    const allDone = engs.every((e) => e.done);
    if (allDone) {
      const hits = engs.filter((e) => e.result?.verdict === "HIT").length;
      setStats({ hits, total: engs.length, running: false });
    } else {
      rafRef.current = requestAnimationFrame(loop);
    }
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const engs = engsRef.current;
    if (!canvas || !engs.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, w, h);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const e of engs) {
      const f = e.lastFrame;
      if (!f) continue;
      for (const [x, y] of [[f.xM, f.yM], [f.xT, f.yT]]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
    const scale = Math.min(w / (spanX * 1.2), h / (spanY * 1.2));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const toX = (x: number) => w / 2 + (x - cx) * scale;
    const toY = (y: number) => h / 2 - (y - cy) * scale;

    engs.forEach((e, i) => {
      const f = e.lastFrame;
      if (!f) return;
      const tr = trailsRef.current.get(i)!;
      drawTrail(ctx, tr.t, toX, toY, AMBER);
      drawTrail(ctx, tr.m, toX, toY, CYAN);
      // LOS
      ctx.strokeStyle = "rgba(124,138,165,0.3)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(toX(f.xM), toY(f.yM));
      ctx.lineTo(toX(f.xT), toY(f.yT));
      ctx.stroke();
      // craft
      dot(ctx, toX(f.xT), toY(f.yT), AMBER);
      const done = e.done;
      const col = done ? (e.result?.verdict === "HIT" ? WHITE : DANGER) : CYAN;
      dot(ctx, toX(f.xM), toY(f.yM), col, done ? 4 : 3);
    });
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Storm — the salvo</h1>
        <label className="flex items-center gap-2 text-sm text-muted">
          interceptors
          <input type="range" min={2} max={16} value={count} onChange={(e) => setCount(parseInt(e.target.value))} />
          <span className="tnum">{count}</span>
        </label>
        <button className="btn btn-primary" onClick={() => start(count, seed)}>▶ Volley</button>
        <button className="btn" onClick={() => { const s = Math.floor(Math.random() * 99999); setSeed(s); start(count, s); }}>🎲 New seed</button>
        {!stats.running && stats.total > 0 && (
          <span className="chip">
            P_k = {(stats.hits / stats.total).toFixed(2)} ({stats.hits}/{stats.total} hit)
          </span>
        )}
      </div>
      <div className="relative aspect-[16/9] w-full">
        <canvas ref={canvasRef} className="h-full w-full rounded-xl border border-grid bg-bg scanlines" role="img" aria-label="Storm salvo stage" />
        {stats.total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            Launch a volley to watch coordinated geometry — mixed laws, mixed evaders.
          </div>
        )}
      </div>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Each interceptor runs an independent, validated engagement (mixed PN laws and evasion
        types). Same engine as every other mode — only here it runs {count} times at once.
        {reduced ? " Reduced motion is on; trails are minimal." : ""}
      </p>
    </div>
  );
}

function drawTrail(ctx: CanvasRenderingContext2D, trail: number[][], toX: (x: number) => number, toY: (y: number) => number, color: string) {
  if (trail.length < 2) return;
  const n = trail.length;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(toX(trail[0][0]), toY(trail[0][1]));
  for (let i = 1; i < n; i++) ctx.lineTo(toX(trail[i][0]), toY(trail[i][1]));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 3) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
