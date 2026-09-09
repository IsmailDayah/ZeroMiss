"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HUD } from "@/components/HUD";
import { StageCanvas } from "@/components/StageCanvas";
import { usePrefersReducedMotion } from "@/components/hooks";
import { useEngagement } from "@/components/useEngagement";
import { PRESETS } from "@/lib/sim/presets";
import { cloneScenario } from "@/lib/sim/scenario";

const BEST_KEY = "zeromiss_duel_best";
// The page is prerendered by the static export, so the very first client render must
// match the server HTML byte for byte. Seeding from Math.random() in the useState
// initialiser broke that (React hydration error #418); the real seed is drawn on mount.
const FIRST_SEED = 1337;

export default function DuelPage() {
  const reduced = usePrefersReducedMotion();
  const steerRef = useRef(0); // -1, 0, +1
  const [seed, setSeed] = useState(FIRST_SEED);
  const [best, setBest] = useState(0);
  const [gameKey, setGameKey] = useState(0);

  const spec = useMemo(() => {
    const s = cloneScenario(PRESETS.duel);
    s.seed = seed;
    return s;
  }, [seed]);

  useEffect(() => {
    const v = parseFloat(localStorage.getItem(BEST_KEY) ?? "0");
    if (!Number.isNaN(v)) setBest(v);
    setSeed(Math.floor(Math.random() * 1_000_000));
  }, []);

  const liveCommandG = useCallback(() => steerRef.current * spec.target.a_max_g, [spec]);

  const { frame, result, status, trailMRef, trailTRef, ghostsRef, api } = useEngagement(spec, {
    autoPlay: false,
    reducedMotion: reduced,
    seed,
    liveCommandG,
    onResult: (r) => {
      // In Duel you ARE the target: MISS = you escaped; HIT = caught at tFlight.
      const survived = r.verdict === "MISS" ? spec.termination.t_max_s : r.tFlight;
      if (survived > best) {
        setBest(survived);
        localStorage.setItem(BEST_KEY, String(survived));
      }
    },
  });

  // keyboard steering
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") steerRef.current = 1;
      else if (e.key === "ArrowRight" || e.key === "d") steerRef.current = -1;
      else if (e.key === " ") {
        e.preventDefault();
        if (status !== "running") api.play();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "a", "d"].includes(e.key)) steerRef.current = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [api, status]);

  const newGame = () => {
    steerRef.current = 0;
    setSeed(Math.floor(Math.random() * 1_000_000));
    setGameKey((k) => k + 1);
  };

  const escaped = result?.verdict === "MISS";

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Duel — you fly the jet</h1>
        <span className="chip">seed {seed}</span>
        <span className="chip">best survival {best.toFixed(1)} s</span>
        <span className="ml-auto text-sm text-muted">
          Hold <kbd className="rounded bg-panel px-1">←</kbd>/<kbd className="rounded bg-panel px-1">→</kbd> (or the
          screen zones) to bank. Survive {spec.termination.t_max_s}s to escape.
        </span>
      </div>

      <div className="relative aspect-[16/10] w-full sm:aspect-[16/9]">
        <StageCanvas
          frame={frame}
          trailMRef={trailMRef}
          trailTRef={trailTRef}
          ghostsRef={ghostsRef}
          spec={spec}
          verdict={result?.verdict ?? null}
          showGhosts={false}
          showZEM={false}
          reducedMotion={reduced}
        />

        {/* touch steering zones */}
        <button
          aria-label="Bank left"
          className="absolute inset-y-0 left-0 w-1/3 bg-transparent"
          onPointerDown={() => (steerRef.current = 1)}
          onPointerUp={() => (steerRef.current = 0)}
          onPointerLeave={() => (steerRef.current = 0)}
        />
        <button
          aria-label="Bank right"
          className="absolute inset-y-0 right-0 w-1/3 bg-transparent"
          onPointerDown={() => (steerRef.current = -1)}
          onPointerUp={() => (steerRef.current = 0)}
          onPointerLeave={() => (steerRef.current = 0)}
        />

        {/* overlays */}
        {status === "idle" && !result && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button className="btn btn-primary text-base" onClick={() => api.play()}>
              ▶ Launch interceptor
            </button>
          </div>
        )}
        {result && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/40 backdrop-blur-sm">
            <span
              className="tnum text-4xl font-bold tracking-widest"
              style={{ color: escaped ? "#37e0e6" : "#ff5d5d" }}
            >
              {escaped ? "YOU ESCAPED" : "INTERCEPTED"}
            </span>
            <span className="text-muted">
              {escaped
                ? `You shook a law-abiding pursuer for ${spec.termination.t_max_s}s.`
                : `Caught at ${result.tFlight.toFixed(1)}s · miss ${result.missDistance.toFixed(1)} m`}
            </span>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={newGame}>New seed</button>
              <button className="btn" onClick={() => { setGameKey((k) => k + 1); api.restart(); }}>Retry seed</button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-center gap-2 sm:hidden">
        <button className="btn flex-1" onPointerDown={() => (steerRef.current = 1)} onPointerUp={() => (steerRef.current = 0)}>◀ Bank</button>
        <button className="btn flex-1" onPointerDown={() => (steerRef.current = -1)} onPointerUp={() => (steerRef.current = 0)}>Bank ▶</button>
      </div>

      <div className="mt-3">
        <HUD frame={frame} law={spec.missile.guidance.law} N={spec.missile.guidance.N} />
      </div>
      <p className="mt-3 max-w-prose text-sm text-muted" key={gameKey}>
        The interceptor obeys True Proportional Navigation — it turns proportionally to how
        fast you drift across its view. The only way out is to force it to demand more g than
        its airframe can pull, right at the end. Good luck.
      </p>
    </div>
  );
}
