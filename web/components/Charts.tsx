"use client";

import type { Result } from "@/lib/sim/engagement";

interface Series {
  label: string;
  color: string;
  values: number[];
}

function LineChart({
  title,
  t,
  series,
  height = 120,
  clip,
}: {
  title: string;
  t: number[];
  series: Series[];
  height?: number;
  clip?: number;
}) {
  const w = 320;
  const h = height;
  const pad = 6;
  const tMax = Math.max(...t, 1e-6);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (let v of s.values) {
      if (clip) v = Math.max(-clip, Math.min(clip, v));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-6) hi = lo + 1;
  const x = (tt: number) => pad + (tt / tMax) * (w - 2 * pad);
  const y = (v: number) => {
    const cv = clip ? Math.max(-clip, Math.min(clip, v)) : v;
    return h - pad - ((cv - lo) / (hi - lo)) * (h - 2 * pad);
  };
  const zeroY = lo < 0 && hi > 0 ? y(0) : null;

  return (
    <div className="card p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
        <div className="flex gap-2">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1 text-[10px]" style={{ color: s.color }}>
              <span className="inline-block h-1.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" role="img" aria-label={title}>
        {zeroY !== null && <line x1={pad} x2={w - pad} y1={zeroY} y2={zeroY} stroke="#16233a" strokeWidth={1} />}
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={1.4}
            points={s.values.map((v, i) => `${x(t[i] ?? 0)},${y(v)}`).join(" ")}
          />
        ))}
      </svg>
    </div>
  );
}

export function Charts({ result }: { result: Result }) {
  const f = result.frames;
  if (!f.length) return null;
  const t = f.map((r) => r.t);
  const deg = (x: number) => (x * 180) / Math.PI;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <LineChart
        title="Acceleration [g]"
        t={t}
        clip={80}
        series={[
          { label: "cmd", color: "#7c8aa5", values: f.map((r) => r.gCmd) },
          { label: "achieved", color: "#37e0e6", values: f.map((r) => r.gAch) },
        ]}
      />
      <LineChart
        title="LOS rate [°/s]"
        t={t}
        series={[
          { label: "true", color: "#ffb454", values: f.map((r) => deg(r.lambdaDot)) },
          { label: "measured", color: "#37e0e6", values: f.map((r) => deg(r.lambdaDotMeas)) },
        ]}
      />
      <LineChart
        title="Range [m]"
        t={t}
        series={[{ label: "R", color: "#37e0e6", values: f.map((r) => r.R) }]}
      />
    </div>
  );
}
