"use client";

import { motion } from "framer-motion";

import type { Result } from "@/lib/sim/engagement";

export function VerdictCard({
  result,
  seed,
  onReplay,
  onShare,
}: {
  result: Result;
  seed: number;
  onReplay?: () => void;
  onShare?: () => void;
}) {
  const hit = result.verdict === "HIT";
  const color = hit ? "#f4f8ff" : "#ff5d5d";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="card p-4"
      role="status"
      aria-label={`Result: ${result.verdict}, miss distance ${result.missDistance.toFixed(2)} meters`}
    >
      <div className="flex items-center justify-between">
        <span className="tnum text-2xl font-bold tracking-widest" style={{ color }}>
          {result.verdict}
        </span>
        <span className="chip">seed {seed}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Miss" value={`${result.missDistance.toFixed(2)} m`} accent={color} />
        <Stat label="Peak g" value={result.peakG.toFixed(1)} />
        <Stat label="Flight time" value={`${result.tFlight.toFixed(2)} s`} />
        <Stat label="Closing vel" value={`${Math.abs(result.closingVelocity).toFixed(0)} m/s`} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="chip">{result.law.toUpperCase()} · N={result.N}</span>
        {result.lockLost && <span className="chip text-danger">lock lost</span>}
        <div className="ml-auto flex gap-2">
          {onShare && (
            <button className="btn" onClick={onShare}>
              Share run
            </button>
          )}
          {onReplay && (
            <button className="btn btn-primary" onClick={onReplay}>
              Replay
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className="tnum text-lg" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
