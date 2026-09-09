"use client";

import { useState } from "react";

import { isMuted, setMuted } from "@/lib/audio";

export interface Overlays {
  ghosts: boolean;
  zem: boolean;
  los: boolean;
}

export function PlaybackBar({
  status,
  onPlay,
  onPause,
  onRestart,
  onSkip,
  speed,
  onSpeed,
  overlays,
  setOverlays,
  quality,
  onToggleLite,
  captionsOn,
  onToggleCaptions,
  recording,
  onRecord,
}: {
  status: "idle" | "running" | "done";
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSkip?: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  overlays: Overlays;
  setOverlays: (o: Overlays) => void;
  quality?: "full" | "lite";
  onToggleLite?: () => void;
  captionsOn?: boolean;
  onToggleCaptions?: () => void;
  recording?: boolean;
  onRecord?: () => void;
}) {
  const [muted, setM] = useState(isMuted());
  const toggleMute = () => {
    const v = !muted;
    setMuted(v);
    setM(v);
  };
  const Toggle = ({ k, label }: { k: keyof Overlays; label: string }) => (
    <button
      onClick={() => setOverlays({ ...overlays, [k]: !overlays[k] })}
      className={`rounded-md border px-2 py-1 text-xs transition ${
        overlays[k] ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"
      }`}
      aria-pressed={overlays[k]}
    >
      {label}
    </button>
  );

  return (
    <div className="card flex flex-wrap items-center gap-2 p-2">
      {status === "running" ? (
        <button className="btn" onClick={onPause} aria-label="Pause">⏸</button>
      ) : (
        <button className="btn btn-primary" onClick={onPlay} aria-label="Play">▶ Launch</button>
      )}
      <button className="btn" onClick={onRestart} aria-label="Restart">↺</button>
      {onSkip && (
        <button className="btn" onClick={onSkip} aria-label="Skip to result">⤓ Result</button>
      )}

      <div className="ml-1 flex items-center gap-1">
        {[0.25, 0.5, 1, 2].map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            className={`rounded-md border px-2 py-1 text-xs transition ${
              speed === s ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"
            }`}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Toggle k="ghosts" label="Bearing" />
        <Toggle k="zem" label="ZEM" />
        <Toggle k="los" label="LOS" />
        {onRecord && (
          <button
            className={`rounded-md border px-2 py-1 text-xs transition ${recording ? "border-danger text-danger animate-pulse2" : "border-grid text-muted hover:text-ink"}`}
            onClick={onRecord}
            disabled={recording}
            aria-label="Record a clip"
          >
            {recording ? "● REC" : "◉ Clip"}
          </button>
        )}
        {onToggleCaptions && (
          <button
            className={`rounded-md border px-2 py-1 text-xs transition ${captionsOn ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"}`}
            onClick={onToggleCaptions}
            aria-pressed={!!captionsOn}
            aria-label="Toggle captions"
          >
            CC
          </button>
        )}
        {onToggleLite && (
          <button
            className={`rounded-md border px-2 py-1 text-xs transition ${quality === "lite" ? "border-amber bg-amber/10 text-amber" : "border-grid text-muted hover:text-ink"}`}
            onClick={onToggleLite}
            aria-pressed={quality === "lite"}
            aria-label="Toggle lite render mode"
          >
            Lite
          </button>
        )}
        <button className="btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>
    </div>
  );
}
