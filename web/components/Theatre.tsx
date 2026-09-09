"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ScenarioSpec } from "@/lib/sim/scenario";
import { Charts } from "./Charts";
import { ErrorBoundary } from "./ErrorBoundary";
import { HUD } from "./HUD";
import { PlaybackBar, type Overlays } from "./PlaybackBar";
import { StageCanvas } from "./StageCanvas";
import { VerdictCard } from "./VerdictCard";
import { usePrefersReducedMotion } from "./hooks";
import { useEngagement } from "./useEngagement";

/**
 * The full Watch/Sandbox/Replay theatre: Stage + HUD + playback + verdict + charts +
 * captioned audio + clip export. Driven entirely by the validated TS twin.
 */
export function Theatre({
  spec,
  seed,
  showCharts = true,
  autoPlay = true,
}: {
  spec: ScenarioSpec;
  seed?: number;
  showCharts?: boolean;
  autoPlay?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [overlays, setOverlays] = useState<Overlays>({ ghosts: true, zem: true, los: true });
  const [speed, setSpeed] = useState(1);
  const [autoLite, setAutoLite] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [recording, setRecording] = useState(false);

  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wasLockedRef = useRef(false);
  const lowFpsStreak = useRef(0);

  const { frame, result, status, trailMRef, trailTRef, ghostsRef, api } = useEngagement(spec, {
    autoPlay: autoPlay && !reduced,
    reducedMotion: reduced,
    seed,
  });

  // captioned SFX (a11y): announce lock / hit / miss to a live region
  useEffect(() => {
    if (frame?.locked && !wasLockedRef.current && frame.t > 0) {
      wasLockedRef.current = true;
      setCaption("Seeker lock acquired");
    }
    if (!frame?.locked) wasLockedRef.current = wasLockedRef.current && true;
  }, [frame?.locked, frame?.t]);

  useEffect(() => {
    if (result) {
      setCaption(result.verdict === "HIT" ? `Intercept — miss ${result.missDistance.toFixed(1)} m` : `Miss by ${result.missDistance.toFixed(1)} m`);
    }
  }, [result]);

  // adaptive lite: drop to lite after a sustained low-FPS streak
  const onFps = useCallback((fps: number) => {
    if (fps < 40) {
      lowFpsStreak.current += 1;
      if (lowFpsStreak.current >= 4) setAutoLite(true);
    } else {
      lowFpsStreak.current = 0;
    }
  }, []);

  const quality: "full" | "lite" = autoLite || reduced ? "lite" : "full";

  const onShare = () => {
    const url = `${window.location.origin}/replay?seed=${result?.seed ?? seed ?? spec.seed ?? 0}&preset=${encodeURIComponent(spec.name)}&law=${spec.missile.guidance.law}&N=${spec.missile.guidance.N}`;
    void navigator.clipboard?.writeText(url);
    setCaption("Replay link copied to clipboard");
  };

  // ---- clip export: record the canvas from launch to verdict, download WebM ----
  const startRecording = useCallback(() => {
    const canvas = canvasElRef.current;
    if (!canvas || typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      setCaption("Clip recording isn't supported in this browser");
      return;
    }
    api.restart();
    chunksRef.current = [];
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zeromiss-${spec.missile.guidance.law}-seed${result?.seed ?? seed ?? 0}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRecording(false);
      setCaption("Clip downloaded");
    };
    recorderRef.current = rec;
    setRecording(true);
    rec.start();
    setTimeout(() => api.play(), 80);
  }, [api, spec, result, seed]);

  // stop the recorder once the engagement resolves
  useEffect(() => {
    if (recording && result && recorderRef.current?.state === "recording") {
      // give the terminal bloom ~0.8s to play into the clip
      const id = setTimeout(() => recorderRef.current?.stop(), 800);
      return () => clearTimeout(id);
    }
  }, [recording, result]);

  return (
    <div className="flex flex-col gap-3">
      <ErrorBoundary label="The stage">
        <div className="relative aspect-[16/10] w-full sm:aspect-[16/9]">
          <StageCanvas
            frame={frame}
            trailMRef={trailMRef}
            trailTRef={trailTRef}
            ghostsRef={ghostsRef}
            spec={spec}
            status={status}
            verdict={result?.verdict ?? null}
            showGhosts={overlays.ghosts}
            showZEM={overlays.zem}
            showLOS={overlays.los}
            reducedMotion={reduced}
            quality={quality}
            onCanvas={(el) => (canvasElRef.current = el)}
            onFps={onFps}
          />
          {captionsOn && caption && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-bg/80 px-3 py-1 text-xs text-ink">
              {caption}
            </div>
          )}
        </div>
      </ErrorBoundary>

      {/* screen-reader live region (always present, even with visual captions off) */}
      <div aria-live="polite" className="sr-only">{caption}</div>

      <PlaybackBar
        status={status}
        onPlay={api.play}
        onPause={api.pause}
        onRestart={api.restart}
        onSkip={api.skipToResult}
        speed={speed}
        onSpeed={(s) => {
          setSpeed(s);
          api.setSpeed(s);
        }}
        overlays={overlays}
        setOverlays={setOverlays}
        quality={quality}
        onToggleLite={() => setAutoLite((v) => !v)}
        captionsOn={captionsOn}
        onToggleCaptions={() => setCaptionsOn((v) => !v)}
        recording={recording}
        onRecord={startRecording}
      />

      <HUD frame={frame} law={spec.missile.guidance.law} N={spec.missile.guidance.N} />

      {result && (
        <VerdictCard result={result} seed={result.seed} onReplay={api.restart} onShare={onShare} />
      )}

      {showCharts && result && <Charts result={result} />}
    </div>
  );
}
