"use client";

import type { Frame } from "@/lib/sim/engagement";

function deg(x: number): number {
  return (x * 180) / Math.PI;
}

function Readout({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className="tnum text-lg leading-tight" style={{ color: accent }}>
        {value}
        {unit && <span className="ml-1 text-xs text-muted">{unit}</span>}
      </span>
    </div>
  );
}

export function HUD({ frame, law, N }: { frame: Frame | null; law: string; N: number }) {
  const f = frame;
  const losRate = f ? deg(f.lambdaDot) : 0;
  return (
    <div
      className="card grid grid-cols-2 gap-3 p-3 sm:grid-cols-4"
      aria-live="polite"
      aria-label="Live telemetry heads-up display"
    >
      <Readout label="Range" value={f ? f.R.toFixed(0) : "—"} unit="m" accent="#37e0e6" />
      <Readout label="Closing Vel" value={f ? f.Vc.toFixed(0) : "—"} unit="m/s" />
      <Readout label="Time-to-go" value={f && isFinite(f.tGo) ? f.tGo.toFixed(2) : "—"} unit="s" />
      <Readout label="LOS rate" value={f ? losRate.toFixed(2) : "—"} unit="°/s" accent={Math.abs(losRate) < 0.2 ? "#37e0e6" : "#ffb454"} />
      <Readout label="Cmd g" value={f ? f.gCmd.toFixed(1) : "—"} accent={f?.saturated ? "#ff5d5d" : undefined} />
      <Readout label="Achieved g" value={f ? f.gAch.toFixed(1) : "—"} accent="#37e0e6" />
      <Readout label="Guidance" value={law.toUpperCase()} />
      <Readout label="N / Seeker" value={`${N}${f && !f.locked ? " · LOST" : ""}`} accent={f && !f.locked ? "#ff5d5d" : undefined} />
    </div>
  );
}
