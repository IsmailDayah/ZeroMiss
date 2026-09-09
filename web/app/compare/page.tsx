"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HUD } from "@/components/HUD";
import { StageCanvas } from "@/components/StageCanvas";
import type { GhostLine } from "@/components/useEngagement";
import { usePrefersReducedMotion } from "@/components/hooks";
import { Engagement, type Frame } from "@/lib/sim/engagement";
import { PRESETS, PRESET_ORDER } from "@/lib/sim/presets";
import { cloneScenario, type ScenarioSpec } from "@/lib/sim/scenario";

const LAWS = ["pursuit", "ppn", "tpn", "apn", "ogl"];
const TRAIL_MAX = 600;

interface SideState {
  eng: Engagement;
  trailM: number[][];
  trailT: number[][];
  ghosts: GhostLine[];
  ghostCount: number;
}

function makeSpec(presetId: string, cfg: { law: string; N: number }): ScenarioSpec {
  const s = cloneScenario(PRESETS[presetId]);
  s.missile.guidance.law = cfg.law;
  s.missile.guidance.N = cfg.N;
  return s;
}

function newSide(spec: ScenarioSpec): SideState {
  return { eng: new Engagement(spec, spec.seed ?? 0), trailM: [], trailT: [], ghosts: [], ghostCount: 0 };
}

function CompareInner() {
  const reduced = usePrefersReducedMotion();
  const [presetId, setPresetId] = useState("the_weave");
  const [a, setA] = useState({ law: "tpn", N: 3 });
  const [b, setB] = useState({ law: "apn", N: 5 });

  const specA = useMemo(() => makeSpec(presetId, a), [presetId, a]);
  const specB = useMemo(() => makeSpec(presetId, b), [presetId, b]);

  // refs shared with the two StageCanvas instances (updated by the single clock)
  const sidesRef = useRef<[SideState, SideState] | null>(null);
  const trailMA = useRef<number[][]>([]);
  const trailTA = useRef<number[][]>([]);
  const ghostsA = useRef<GhostLine[]>([]);
  const trailMB = useRef<number[][]>([]);
  const trailTB = useRef<number[][]>([]);
  const ghostsB = useRef<GhostLine[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const accRef = useRef(0);

  const [frameA, setFrameA] = useState<Frame | null>(null);
  const [frameB, setFrameB] = useState<Frame | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ a?: ReturnType<Engagement["run"]>; b?: ReturnType<Engagement["run"]> }>({});

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const sa = newSide(specA);
    const sb = newSide(specB);
    sidesRef.current = [sa, sb];
    trailMA.current = sa.trailM; trailTA.current = sa.trailT; ghostsA.current = sa.ghosts;
    trailMB.current = sb.trailM; trailTB.current = sb.trailT; ghostsB.current = sb.ghosts;
    accRef.current = 0;
    lastRef.current = 0;
    setResults({});
    setRunning(false);
    // prime initial frames
    sa.eng.stepOnce();
    sb.eng.stepOnce();
    setFrameA(sa.eng.lastFrame);
    setFrameB(sb.eng.lastFrame);
  }, [specA, specB]);

  const stepSide = (s: SideState, steps: number) => {
    for (let i = 0; i < steps; i++) {
      if (s.eng.done) break;
      const f = s.eng.stepOnce();
      if (!f) break;
      s.trailM.push([f.xM, f.yM]);
      s.trailT.push([f.xT, f.yT]);
      if (s.trailM.length > TRAIL_MAX) s.trailM.shift();
      if (s.trailT.length > TRAIL_MAX) s.trailT.shift();
      if (s.ghostCount++ % 120 === 0) {
        s.ghosts.push({ x1: f.xM, y1: f.yM, x2: f.xT, y2: f.yT });
        if (s.ghosts.length > 24) s.ghosts.shift();
      }
    }
  };

  const loop = useCallback((ts: number) => {
    const sides = sidesRef.current;
    if (!sides) return;
    if (!lastRef.current) lastRef.current = ts;
    let realDt = (ts - lastRef.current) / 1000;
    lastRef.current = ts;
    realDt = Math.min(realDt, 0.05);

    // ONE clock → identical step budget for both sides (true lockstep)
    const dt = sides[0].eng.dt;
    // gentle shared slow-mo when either side enters its terminal beat
    let speed = 1;
    const tg = Math.min(
      sides[0].eng.lastFrame?.tGo ?? Infinity,
      sides[1].eng.lastFrame?.tGo ?? Infinity,
    );
    if (!reduced && isFinite(tg) && tg < 0.6) speed *= Math.max(0.15, tg / 0.6);
    accRef.current += realDt * speed;
    let steps = Math.floor(accRef.current / dt);
    accRef.current -= steps * dt;
    steps = Math.min(steps, 400);

    if (steps > 0) {
      stepSide(sides[0], steps);
      stepSide(sides[1], steps);
    }
    setFrameA(sides[0].eng.lastFrame);
    setFrameB(sides[1].eng.lastFrame);

    if (sides[0].eng.done && sides[1].eng.done) {
      setResults({ a: sides[0].eng.result!, b: sides[1].eng.result! });
      setRunning(false);
    } else {
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [reduced]);

  const launch = () => {
    if (!sidesRef.current) reset();
    setRunning(true);
    lastRef.current = 0;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };

  const relaunch = useCallback(() => {
    reset();
    // start on next tick so refs settle
    setTimeout(() => {
      setRunning(true);
      lastRef.current = 0;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }, 30);
  }, [reset, loop]);

  useEffect(() => {
    reset();
    return () => cancelAnimationFrame(rafRef.current);
  }, [reset]);

  // autoplay when the scenario/config changes
  useEffect(() => {
    const id = setTimeout(() => relaunch(), 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, a.law, a.N, b.law, b.N]);

  const Picker = ({ side, cfg, set }: { side: string; cfg: { law: string; N: number }; set: (c: { law: string; N: number }) => void }) => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">{side}</span>
      <select
        value={cfg.law}
        onChange={(e) => set({ ...cfg, law: e.target.value })}
        className="rounded-md border border-grid bg-panel px-2 py-1 text-sm"
        aria-label={`${side} guidance law`}
      >
        {LAWS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted">
        N
        <input
          type="number" min={2} max={6} step={0.5} value={cfg.N}
          onChange={(e) => set({ ...cfg, N: parseFloat(e.target.value) })}
          className="w-14 rounded-md border border-grid bg-panel px-2 py-1 text-sm"
          aria-label={`${side} navigation constant`}
        />
      </label>
    </div>
  );

  const Panel = ({ label, frame, trailM, trailT, ghosts, spec, result }: {
    label: string; frame: Frame | null;
    trailM: React.MutableRefObject<number[][]>; trailT: React.MutableRefObject<number[][]>;
    ghosts: React.MutableRefObject<GhostLine[]>; spec: ScenarioSpec;
    result?: ReturnType<Engagement["run"]>;
  }) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-cyan">{label}</span>
        {result && (
          <span className="tnum" style={{ color: result.verdict === "HIT" ? "#37e0e6" : "#ff5d5d" }}>
            {result.verdict} · {result.missDistance.toFixed(2)} m · {result.peakG.toFixed(0)} g
          </span>
        )}
      </div>
      <ErrorBoundary label={label}>
        <div className="relative aspect-[4/3] w-full">
          <StageCanvas frame={frame} trailMRef={trailM} trailTRef={trailT} ghostsRef={ghosts} spec={spec} verdict={result?.verdict ?? null} reducedMotion={reduced} />
        </div>
      </ErrorBoundary>
      <HUD frame={frame} law={spec.missile.guidance.law} N={spec.missile.guidance.N} />
    </div>
  );

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Compare</h1>
        {PRESET_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => setPresetId(id)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              presetId === id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"
            }`}
          >
            {PRESETS[id].name}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Picker side="Left" cfg={a} set={setA} />
        <Picker side="Right" cfg={b} set={setB} />
        <button className="btn btn-primary" onClick={relaunch}>↺ Relaunch both</button>
        {!running && (results.a || results.b) && <span className="chip">synchronized · one clock</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel label={`${a.law.toUpperCase()} · N=${a.N}`} frame={frameA} trailM={trailMA} trailT={trailTA} ghosts={ghostsA} spec={specA} result={results.a} />
        <Panel label={`${b.law.toUpperCase()} · N=${b.N}`} frame={frameB} trailM={trailMB} trailT={trailTB} ghosts={ghostsB} spec={specB} result={results.b} />
      </div>
      <button className="sr-only" onClick={launch}>launch</button>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="py-10 text-muted">Loading…</div>}>
      <CompareInner />
    </Suspense>
  );
}
