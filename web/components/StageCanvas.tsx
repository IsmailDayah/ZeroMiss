"use client";

import { useEffect, useRef } from "react";

import type { Frame } from "@/lib/sim/engagement";
import type { ScenarioSpec } from "@/lib/sim/scenario";
import type { GhostLine } from "./useEngagement";

const CYAN = "#37e0e6";
const AMBER = "#ffb454";
const WHITE = "#f4f8ff";
const DANGER = "#ff5d5d";

export interface StageProps {
  frame: Frame | null;
  trailMRef: React.MutableRefObject<number[][]>;
  trailTRef: React.MutableRefObject<number[][]>;
  ghostsRef: React.MutableRefObject<GhostLine[]>;
  spec: ScenarioSpec;
  verdict?: "HIT" | "MISS" | null;
  status?: "idle" | "running" | "done";
  showGhosts?: boolean;
  showZEM?: boolean;
  showLOS?: boolean;
  reducedMotion?: boolean;
  quality?: "full" | "lite";
  onCanvas?: (el: HTMLCanvasElement | null) => void;
  onFps?: (fps: number) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

/**
 * The cinematic Stage. The render loop is a self-owned requestAnimationFrame, fully
 * decoupled from the physics stepping: idle animations (radar
 * sweep, searching reticle) and the post-verdict particle bloom stay smooth even when
 * the simulation isn't advancing. The camera follows the action with an only-grow,
 * smoothed scale, so it never jarringly rescales.
 */
export function StageCanvas(props: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef<StageProps>(props);
  propsRef.current = props;

  // camera + animation state, persisted across rAF ticks
  const camRef = useRef<{ cx: number; cy: number; scale: number; maxSpan: number } | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastVerdictRef = useRef<"HIT" | "MISS" | null>(null);
  const lockFlashRef = useRef(0);
  const lastLockedRef = useRef(false);
  const fpsRef = useRef({ last: 0, frames: 0, acc: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    props.onCanvas?.(canvas);
    let raf = 0;
    let tPrev = performance.now();

    const render = (now: number) => {
      const dt = Math.min((now - tPrev) / 1000, 0.05);
      tPrev = now;
      draw(canvas, propsRef.current, camRef, particlesRef, lastVerdictRef, lockFlashRef, lastLockedRef, now / 1000, dt);

      // FPS sampling for adaptive lite mode
      const f = fpsRef.current;
      f.acc += dt;
      f.frames += 1;
      if (f.acc >= 0.5) {
        propsRef.current.onFps?.(f.frames / f.acc);
        f.acc = 0;
        f.frames = 0;
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      props.onCanvas?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative h-full w-full overflow-hidden rounded-xl border border-grid bg-bg ${props.quality === "lite" ? "" : "scanlines"}`}>
      <canvas ref={canvasRef} className="h-full w-full" aria-label="Interception stage" role="img" />
    </div>
  );
}

function draw(
  canvas: HTMLCanvasElement,
  p: StageProps,
  camRef: React.MutableRefObject<{ cx: number; cy: number; scale: number; maxSpan: number } | null>,
  particlesRef: React.MutableRefObject<Particle[]>,
  lastVerdictRef: React.MutableRefObject<"HIT" | "MISS" | null>,
  lockFlashRef: React.MutableRefObject<number>,
  lastLockedRef: React.MutableRefObject<boolean>,
  time: number,
  dt: number,
) {
  const frame = p.frame;
  if (!frame) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const lite = p.quality === "lite";
  const reduced = p.reducedMotion ?? false;

  const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return; // hidden tab / collapsed container — nothing to draw
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---- camera: follow the moving midpoint, scale from the only-grow max separation ----
  const midX = (frame.xM + frame.xT) / 2;
  const midY = (frame.yM + frame.yT) / 2;
  const sep = Math.hypot(frame.xT - frame.xM, frame.yT - frame.yM);
  const startSep = Math.hypot(
    p.spec.target.position[0] - p.spec.missile.position[0],
    p.spec.target.position[1] - p.spec.missile.position[1],
  );
  if (!camRef.current) {
    camRef.current = { cx: midX, cy: midY, scale: 1, maxSpan: Math.max(startSep, sep, 1) };
  }
  const cam = camRef.current;
  cam.maxSpan = Math.max(cam.maxSpan, sep); // only grows
  const pad = 1.5;
  const targetScale = Math.min(w / (cam.maxSpan * pad), h / (cam.maxSpan * pad));
  const ease = reduced ? 1 : 0.06;
  cam.cx += (midX - cam.cx) * ease;
  cam.cy += (midY - cam.cy) * ease;
  cam.scale += (targetScale - cam.scale) * (reduced ? 1 : 0.1);

  const toX = (x: number) => w / 2 + (x - cam.cx) * cam.scale;
  const toY = (y: number) => h / 2 - (y - cam.cy) * cam.scale;

  // ---- clear ----
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, w, h, cam, toX, toY);

  // ---- pre-launch beat: radar sweep + searching reticle (idle, before any trail) ----
  const preLaunch = (p.status === "idle" || frame.t === 0) && p.trailMRef.current.length < 2 && !p.verdict;
  if (preLaunch && !reduced) {
    drawRadarSweep(ctx, toX(frame.xM), toY(frame.yM), time, lite);
    drawReticle(ctx, toX(frame.xT), toY(frame.yT), AMBER, false, time * 1.5);
  }

  // ---- constant-bearing ghosts ----
  if (p.showGhosts && !lite) {
    for (const g of p.ghostsRef.current) {
      ctx.strokeStyle = "rgba(124,138,165,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(g.x1), toY(g.y1));
      ctx.lineTo(toX(g.x2), toY(g.y2));
      ctx.stroke();
    }
  }

  // ---- trails ----
  drawTrail(ctx, p.trailTRef.current, toX, toY, AMBER, lite);
  drawTrail(ctx, p.trailMRef.current, toX, toY, CYAN, lite);

  // ---- live LOS ----
  if (p.showLOS && !preLaunch) {
    ctx.strokeStyle = p.verdict ? (p.verdict === "HIT" ? "rgba(244,248,255,0.85)" : "rgba(255,93,93,0.85)") : "rgba(124,138,165,0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(frame.xM), toY(frame.yM));
    ctx.lineTo(toX(frame.xT), toY(frame.yT));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- ZEM arrow ----
  if (p.showZEM && !preLaunch && isFinite(frame.tGo) && Math.abs(frame.zemPerp) > 0.5) {
    drawZEM(ctx, frame, toX, toY);
  }

  // ---- lock-on flash (rising) ----
  if (frame.locked && !lastLockedRef.current && frame.t > 0) lockFlashRef.current = 0.5;
  lastLockedRef.current = frame.locked;
  if (lockFlashRef.current > 0) {
    const a = lockFlashRef.current;
    drawReticle(ctx, toX(frame.xT), toY(frame.yT), CYAN, true, 0, 14 + a * 30, a);
    lockFlashRef.current = Math.max(0, lockFlashRef.current - dt);
  }

  // ---- craft + reticle ----
  drawCraft(ctx, toX(frame.xT), toY(frame.yT), frame.gammaT, AMBER, !lite);
  if (!preLaunch) drawReticle(ctx, toX(frame.xT), toY(frame.yT), frame.locked ? CYAN : DANGER, frame.inFov, 0);
  drawCraft(ctx, toX(frame.xM), toY(frame.yM), frame.gammaM, frame.saturated ? AMBER : CYAN, !lite);

  // ---- terminal verdict: spawn + animate particles ----
  if (p.verdict && lastVerdictRef.current !== p.verdict) {
    lastVerdictRef.current = p.verdict;
    if (!lite && !reduced) spawnParticles(particlesRef.current, frame.xM, frame.yM, p.verdict);
  }
  if (!p.verdict) {
    lastVerdictRef.current = null;
    particlesRef.current.length = 0;
  }
  updateAndDrawParticles(ctx, particlesRef.current, cam, toX, toY, dt);

  // ---- verdict bloom + label ----
  if (p.verdict) {
    const cx = toX(frame.xM);
    const cy = toY(frame.yM);
    if (p.verdict === "HIT" && !lite && !reduced && particlesRef.current.length) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 140);
      const a = Math.min(0.7, particlesRef.current[0].life / particlesRef.current[0].max);
      grad.addColorStop(0, `rgba(244,248,255,${a})`);
      grad.addColorStop(1, "rgba(244,248,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = p.verdict === "HIT" ? WHITE : DANGER;
    ctx.font = "bold 13px ui-monospace, monospace";
    ctx.fillText(p.verdict, cx + 14, cy - 12);
  }
}

function spawnParticles(arr: Particle[], x: number, y: number, verdict: "HIT" | "MISS") {
  const n = verdict === "HIT" ? 36 : 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    const sp = (verdict === "HIT" ? 120 : 50) * (0.5 + Math.random());
    arr.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.9,
      max: 0.9,
      color: verdict === "HIT" ? (Math.random() < 0.5 ? WHITE : CYAN) : DANGER,
    });
  }
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D, arr: Particle[], cam: { scale: number },
  toX: (x: number) => number, toY: (y: number) => number, dt: number,
) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const pt = arr[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      arr.splice(i, 1);
      continue;
    }
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
    const a = pt.life / pt.max;
    ctx.fillStyle = withAlpha(pt.color, a);
    const r = 2 + a * 2;
    ctx.beginPath();
    ctx.arc(toX(pt.x), toY(pt.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRadarSweep(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, lite: boolean) {
  const r = lite ? 80 : 130;
  const ang = (time * 1.3) % (Math.PI * 2);
  const grad = ctx.createConicGradient ? ctx.createConicGradient(ang, x, y) : null;
  if (grad) {
    grad.addColorStop(0, "rgba(55,224,230,0.22)");
    grad.addColorStop(0.08, "rgba(55,224,230,0.02)");
    grad.addColorStop(1, "rgba(55,224,230,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(55,224,230,0.25)";
  ctx.lineWidth = 1;
  for (const rr of [r * 0.4, r * 0.7, r]) {
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  cam: { cx: number; cy: number; scale: number },
  toX: (x: number) => number, toY: (y: number) => number,
) {
  const targetPx = 64;
  let stepWorld = targetPx / cam.scale;
  const pow = Math.pow(10, Math.floor(Math.log10(stepWorld)));
  stepWorld = Math.ceil(stepWorld / pow) * pow;
  ctx.strokeStyle = "rgba(22,35,58,0.6)";
  ctx.lineWidth = 1;
  const x0 = cam.cx - w / 2 / cam.scale;
  const x1 = cam.cx + w / 2 / cam.scale;
  const y0 = cam.cy - h / 2 / cam.scale;
  const y1 = cam.cy + h / 2 / cam.scale;
  for (let x = Math.floor(x0 / stepWorld) * stepWorld; x <= x1; x += stepWorld) {
    ctx.beginPath();
    ctx.moveTo(toX(x), 0);
    ctx.lineTo(toX(x), h);
    ctx.stroke();
  }
  for (let y = Math.floor(y0 / stepWorld) * stepWorld; y <= y1; y += stepWorld) {
    ctx.beginPath();
    ctx.moveTo(0, toY(y));
    ctx.lineTo(w, toY(y));
    ctx.stroke();
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D, trail: number[][],
  toX: (x: number) => number, toY: (y: number) => number, color: string, lite: boolean,
) {
  if (trail.length < 2) return;
  const n = trail.length;
  if (lite) {
    ctx.strokeStyle = withAlpha(color, 0.7);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(toX(trail[0][0]), toY(trail[0][1]));
    for (let i = 1; i < n; i++) ctx.lineTo(toX(trail[i][0]), toY(trail[i][1]));
    ctx.stroke();
    return;
  }
  for (let i = 1; i < n; i++) {
    const a = (i / n) ** 1.5;
    ctx.strokeStyle = withAlpha(color, a);
    ctx.lineWidth = 0.5 + 2 * (i / n);
    ctx.beginPath();
    ctx.moveTo(toX(trail[i - 1][0]), toY(trail[i - 1][1]));
    ctx.lineTo(toX(trail[i][0]), toY(trail[i][1]));
    ctx.stroke();
  }
}

function drawCraft(
  ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string, glow: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-heading);
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(-6, 5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawReticle(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string, inFov: boolean,
  spin = 0, radius = 14, alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash(inFov ? [] : [3, 3]);
  for (const a of [0, 90, 180, 270]) {
    const rad = (a * Math.PI) / 180 + spin;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(rad) * (radius - 4), y + Math.sin(rad) * (radius - 4));
    ctx.lineTo(x + Math.cos(rad) * (radius + 4), y + Math.sin(rad) * (radius + 4));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawZEM(
  ctx: CanvasRenderingContext2D, frame: Frame,
  toX: (x: number) => number, toY: (y: number) => number,
) {
  const px = frame.xT;
  const py = frame.yT;
  const perp = frame.lam + Math.PI / 2;
  const len = Math.max(-200, Math.min(200, frame.zemPerp));
  ctx.strokeStyle = "rgba(255,180,84,0.9)";
  ctx.fillStyle = "rgba(255,180,84,0.9)";
  ctx.lineWidth = 2;
  const x0 = toX(px);
  const y0 = toY(py);
  const x1 = toX(px + Math.cos(perp) * len);
  const y1 = toY(py + Math.sin(perp) * len);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  const ang = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 7 * Math.cos(ang - 0.4), y1 - 7 * Math.sin(ang - 0.4));
  ctx.lineTo(x1 - 7 * Math.cos(ang + 0.4), y1 - 7 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

function withAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
