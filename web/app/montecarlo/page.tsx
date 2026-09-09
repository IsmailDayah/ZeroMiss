"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  DEFAULT_RANDOMIZE,
  type MCAccumulator,
  cep,
  meanMiss,
  newAccumulator,
  pk,
  runChunk,
} from "@/lib/sim/montecarlo";
import { PRESETS, PRESET_ORDER } from "@/lib/sim/presets";
import { RNG } from "@/lib/sim/rng";

const TARGETS = [1000, 10000, 50000];
const CHUNK = 150; // engagements per animation frame

export default function MonteCarloPage() {
  const [presetId, setPresetId] = useState("the_weave");
  const [target, setTarget] = useState(10000);
  const [running, setRunning] = useState(false);
  const [acc, setAcc] = useState<MCAccumulator>(() => newAccumulator(PRESETS.the_weave.termination.lethal_radius_m));

  const rngRef = useRef<RNG | null>(null);
  const accRef = useRef<MCAccumulator | null>(null);
  const rafRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const base = PRESETS[presetId];
    rngRef.current = new RNG(Math.floor(Math.random() * 1e9));
    accRef.current = newAccumulator(base.termination.lethal_radius_m);
    setAcc({ ...accRef.current });
    setRunning(true);

    const loop = () => {
      const a = accRef.current!;
      const rng = rngRef.current!;
      const remaining = target - a.n;
      const count = Math.min(CHUNK, remaining);
      runChunk(base, rng, DEFAULT_RANDOMIZE, a, count);
      setAcc({ ...a, misses: a.misses });
      if (a.n < target) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        setRunning(false);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [presetId, target]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // live histogram
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    ctx.fillStyle = "#0c1322";
    ctx.fillRect(0, 0, w, h);
    const data = acc.misses;
    if (!data.length) return;
    const hi = Math.min(Math.max(...data), acc.lethalRadius * 6 + 5);
    const bins = 40;
    const counts = new Array(bins).fill(0);
    for (const m of data) {
      const b = Math.min(bins - 1, Math.floor((m / hi) * bins));
      counts[b] += 1;
    }
    const maxC = Math.max(...counts, 1);
    const bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const bh = (counts[i] / maxC) * (h - 20);
      const inLethal = (i / bins) * hi <= acc.lethalRadius;
      ctx.fillStyle = inLethal ? "#37e0e6" : "#7c8aa5";
      ctx.fillRect(i * bw, h - bh, bw - 1, bh);
    }
    // lethal radius marker
    const lx = (acc.lethalRadius / hi) * w;
    ctx.strokeStyle = "#ff5d5d";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#7c8aa5";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(`miss [m] · 0 … ${hi.toFixed(0)}`, 6, 12);
  }, [acc]);

  const progress = target ? Math.min(1, acc.n / target) : 0;

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Live Monte Carlo</h1>
        <span className="text-sm text-muted">
          Run thousands of randomized engagements in your browser — P<sub>k</sub> forms in real time, all from the validated twin.
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {PRESET_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => setPresetId(id)}
            disabled={running}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              presetId === id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"
            }`}
          >
            {PRESETS[id].name}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-grid" />
        {TARGETS.map((t) => (
          <button
            key={t}
            onClick={() => setTarget(t)}
            disabled={running}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              target === t ? "border-amber bg-amber/10 text-amber" : "border-grid text-muted hover:text-ink"
            }`}
          >
            {t.toLocaleString()}
          </button>
        ))}
        {running ? (
          <button className="btn" onClick={stop}>⏹ Stop</button>
        ) : (
          <button className="btn btn-primary" onClick={start}>▶ Run {target.toLocaleString()}</button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <ErrorBoundary label="Monte Carlo">
          <div className="card p-3">
            <canvas ref={canvasRef} className="h-64 w-full rounded" role="img" aria-label="Live miss-distance histogram" />
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-panel">
              <div className="h-full bg-cyan transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        </ErrorBoundary>

        <div className="card flex flex-col gap-3 p-4" aria-live="polite">
          <Stat label="Runs" value={acc.n.toLocaleString()} sub={`of ${target.toLocaleString()}`} testId="mc-runs" />
          <Stat label="Probability of kill" value={pk(acc).toFixed(3)} accent="#37e0e6" big testId="mc-pk" />
          <Stat label="CEP (median miss)" value={`${cep(acc).toFixed(2)} m`} />
          <Stat label="Mean miss" value={`${meanMiss(acc).toFixed(2)} m`} />
          <Stat label="Lethal radius" value={`${acc.lethalRadius.toFixed(0)} m`} />
          <p className="mt-1 text-xs text-muted">
            Each run randomizes initial range, heading error, maneuver timing, and seeker
            noise — the same campaign the Python engine runs offline, here live.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent, big, testId }: { label: string; value: string; sub?: string; accent?: string; big?: boolean; testId?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`tnum ${big ? "text-3xl" : "text-lg"}`} style={{ color: accent }} data-testid={testId}>
        {value}
        {sub && <span className="ml-1 text-xs text-muted"> {sub}</span>}
      </span>
    </div>
  );
}
