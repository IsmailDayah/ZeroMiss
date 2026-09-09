"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Engagement, type Frame, type Result } from "@/lib/sim/engagement";
import type { ScenarioSpec } from "@/lib/sim/scenario";
import { playHit, playLaunch, playLock, playMiss } from "@/lib/audio";

export interface GhostLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Status = "idle" | "running" | "done";

export interface EngagementOptions {
  autoPlay?: boolean;
  speed?: number; // 1 = real time
  slowMo?: boolean; // dilate time in the terminal beat
  sound?: boolean;
  reducedMotion?: boolean;
  seed?: number;
  /** Duel: called each physics step to get the player's commanded lateral g (in g). */
  liveCommandG?: () => number;
  onResult?: (r: Result) => void;
}

const TRAIL_MAX = 600; // physics steps of trail (~0.6 s); rendered thinned

/**
 * Runs the TypeScript twin at a fixed 1 kHz logic step, decoupled from the render loop
 * Exposes the current frame (for the HUD), the result, trails and
 * constant-bearing ghosts (for the Stage), and play/pause/restart controls.
 */
export function useEngagement(spec: ScenarioSpec, opts: EngagementOptions = {}) {
  const {
    autoPlay = true,
    slowMo = true,
    sound = true,
    reducedMotion = false,
    liveCommandG,
    onResult,
  } = opts;

  const engRef = useRef<Engagement | null>(null);
  const trailMRef = useRef<number[][]>([]);
  const trailTRef = useRef<number[][]>([]);
  const ghostsRef = useRef<GhostLine[]>([]);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);
  const accRef = useRef<number>(0);
  const speedRef = useRef<number>(opts.speed ?? 1);
  const ghostCounterRef = useRef<number>(0);
  const lockedAnnouncedRef = useRef<boolean>(false);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const build = useCallback(() => {
    const eng = new Engagement(spec, opts.seed ?? spec.seed ?? 0);
    engRef.current = eng;
    trailMRef.current = [];
    trailTRef.current = [];
    ghostsRef.current = [];
    ghostCounterRef.current = 0;
    lockedAnnouncedRef.current = false;
    setResult(null);
    // prime an initial frame so the Stage renders pre-launch
    const f0: Frame = {
      t: 0, xM: spec.missile.position[0], yM: spec.missile.position[1], gammaM: 0,
      xT: spec.target.position[0], yT: spec.target.position[1], gammaT: 0,
      R: Math.hypot(spec.target.position[0] - spec.missile.position[0], spec.target.position[1] - spec.missile.position[1]),
      lam: 0, lambdaDot: 0, lambdaDotMeas: 0, Vc: 0, tGo: Infinity, zemPerp: 0,
      aCmd: 0, aAch: 0, aT: 0, gCmd: 0, gAch: 0, saturated: false, locked: false, inFov: true, phase: "MIDCOURSE",
    };
    setFrame(f0);
  }, [spec, opts.seed]);

  const finalize = useCallback(
    (r: Result) => {
      setResult(r);
      setStatus("done");
      if (sound) (r.verdict === "HIT" ? playHit : playMiss)();
      onResult?.(r);
    },
    [sound, onResult],
  );

  const stepSim = useCallback(
    (steps: number) => {
      const eng = engRef.current;
      if (!eng || eng.done) return;
      for (let i = 0; i < steps; i++) {
        if (liveCommandG && eng.liveManeuver) {
          eng.liveManeuver.current = liveCommandG() * 9.80665;
        }
        const f = eng.stepOnce();
        if (!f) break;
        // trails
        trailMRef.current.push([f.xM, f.yM]);
        trailTRef.current.push([f.xT, f.yT]);
        if (trailMRef.current.length > TRAIL_MAX) trailMRef.current.shift();
        if (trailTRef.current.length > TRAIL_MAX) trailTRef.current.shift();
        // constant-bearing ghost every ~120 steps
        if (ghostCounterRef.current++ % 120 === 0) {
          ghostsRef.current.push({ x1: f.xM, y1: f.yM, x2: f.xT, y2: f.yT });
          if (ghostsRef.current.length > 24) ghostsRef.current.shift();
        }
        // lock tone on first locked frame
        if (sound && !lockedAnnouncedRef.current && f.locked && f.t > 0) {
          lockedAnnouncedRef.current = true;
          playLock();
        }
        if (eng.done && eng.result) {
          finalize(eng.result);
          return;
        }
      }
    },
    [liveCommandG, sound, finalize],
  );

  const loop = useCallback(
    (ts: number) => {
      const eng = engRef.current;
      if (!eng) return;
      if (!lastTsRef.current) lastTsRef.current = ts;
      let realDt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      realDt = Math.min(realDt, 0.05); // clamp huge gaps (tab switch)

      const f = eng.lastFrame;
      // Terminal slow-mo: dilate time as t_go collapses.
      let speed = speedRef.current;
      if (slowMo && !reducedMotion && f && isFinite(f.tGo) && f.tGo < 0.6) {
        speed *= Math.max(0.12, f.tGo / 0.6);
      }
      accRef.current += realDt * speed;
      const dt = eng.dt;
      let steps = Math.floor(accRef.current / dt);
      accRef.current -= steps * dt;
      steps = Math.min(steps, 400); // safety cap per frame
      if (steps > 0) stepSim(steps);

      setFrame(eng.lastFrame ?? f ?? null);

      if (!eng.done) {
        rafRef.current = requestAnimationFrame(loop);
      }
    },
    [slowMo, reducedMotion, stepSim],
  );

  const play = useCallback(() => {
    const eng = engRef.current;
    if (!eng || eng.done) return;
    setStatus("running");
    lastTsRef.current = 0;
    if (sound && eng.t === 0) playLaunch();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop, sound]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setStatus("idle");
  }, []);

  const restart = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    build();
    setStatus("idle");
  }, [build]);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
  }, []);

  /** Reduced-motion "skip to result": run the engagement to completion instantly. */
  const skipToResult = useCallback(() => {
    const eng = engRef.current;
    if (!eng) return;
    cancelAnimationFrame(rafRef.current);
    const r = eng.run();
    setFrame(eng.lastFrame);
    finalize(r);
  }, [finalize]);

  // build on spec change
  useEffect(() => {
    build();
    return () => cancelAnimationFrame(rafRef.current);
  }, [build]);

  // autoplay once built
  useEffect(() => {
    if (autoPlay && status === "idle" && engRef.current && engRef.current.t === 0) {
      const id = setTimeout(() => play(), 350);
      return () => clearTimeout(id);
    }
  }, [autoPlay, status, play]);

  return {
    frame,
    result,
    status,
    engRef,
    trailMRef,
    trailTRef,
    ghostsRef,
    api: { play, pause, restart, setSpeed, skipToResult },
  };
}
