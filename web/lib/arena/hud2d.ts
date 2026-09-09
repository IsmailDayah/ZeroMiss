/**
 * 2-D HUD canvas drawers for the Arena: a radar minimap and the tactical picture-in-
 * picture — the same "constant-bearing / LOS" plot as the engineering modes, embedded
 * live in the game, so the exact tactical geometry stays readable while the game is
 * being played.
 */

import type { ArenaState } from "../sim/arena";

const CYAN = "#37e0e6";
const AMBER = "#ffb454";
const DANGER = "#ff5d5d";
const GRID = "#16233a";
const MUTED = "#7c8aa5";

function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Top-down radar centered on the player (player always points up). */
export function drawMinimap(canvas: HTMLCanvasElement, st: ArenaState, rangeM = 9000): void {
  const f = fit(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2 - 4;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(7,11,20,0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = GRID;
  for (let r = rad / 3; r <= rad; r += rad / 3) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - rad);
  ctx.lineTo(cx, cy + rad);
  ctx.moveTo(cx - rad, cy);
  ctx.lineTo(cx + rad, cy);
  ctx.stroke();

  const pl = st.player;
  const head = Math.atan2(pl.dir[2], pl.dir[0]); // world bearing in xz
  const toRadar = (wx: number, wz: number): [number, number] => {
    const dx = wx - pl.pos[0], dz = wz - pl.pos[2];
    // rotate by -head so player faces up (-y screen)
    const c = Math.cos(-head), s = Math.sin(-head);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    const k = rad / rangeM;
    return [cx + rz * k, cy - rx * k]; // forward(+x world)->up
  };

  // interceptor blips
  for (const it of st.interceptors) {
    if (!it.active || !it.alive) continue;
    const [bx, by] = toRadar(it.pos[0], it.pos[2]);
    const inside = Math.hypot(bx - cx, by - cy) <= rad;
    const px = inside ? bx : cx + ((bx - cx) / Math.hypot(bx - cx, by - cy)) * rad;
    const py = inside ? by : cy + ((by - cy) / Math.hypot(bx - cx, by - cy)) * rad;
    ctx.fillStyle = it.tele.locked ? DANGER : it.tele.seduced ? AMBER : MUTED;
    ctx.beginPath();
    ctx.arc(px, py, inside ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // flares
  ctx.fillStyle = "#fff0c0";
  for (const fl of st.flares) {
    const [bx, by] = toRadar(fl.pos[0], fl.pos[2]);
    if (Math.hypot(bx - cx, by - cy) <= rad) {
      ctx.beginPath();
      ctx.arc(bx, by, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // player (center, pointing up)
  ctx.fillStyle = CYAN;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx - 4, cy + 4);
  ctx.lineTo(cx + 4, cy + 4);
  ctx.closePath();
  ctx.fill();
}

/** The tactical LOS plot (top-down, auto-fit) for the player + nearest interceptor. */
export function drawTacticalPiP(canvas: HTMLCanvasElement, st: ArenaState): void {
  const f = fit(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1322";
  ctx.fillRect(0, 0, w, h);

  const hunters = st.interceptors.filter((i) => i.active && i.alive);
  if (!hunters.length) return;
  const near = hunters.reduce((a, b) => (b.tele.R < a.tele.R ? b : a));
  const pl = st.player;

  // bounds over the two craft + trails (xz)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const pts: [number, number][] = [[pl.pos[0], pl.pos[2]], [near.pos[0], near.pos[2]]];
  for (const p of pl.trail) pts.push([p[0], p[2]]);
  for (const p of near.trail) pts.push([p[0], p[2]]);
  for (const [x, z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const pad = 0.12 * Math.max(maxX - minX, maxZ - minZ, 200);
  const sx = w / (maxX - minX + 2 * pad);
  const sz = h / (maxZ - minZ + 2 * pad);
  const sc = Math.min(sx, sz);
  const toX = (x: number) => (x - minX + pad) * sc;
  const toY = (z: number) => h - (z - minZ + pad) * sc;

  const trail = (t: number[][], color: string) => {
    if (t.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    t.forEach((p, i) => (i ? ctx.lineTo(toX(p[0]), toY(p[2])) : ctx.moveTo(toX(p[0]), toY(p[2]))));
    ctx.stroke();
  };
  trail(near.trail, AMBER);
  trail(pl.trail, CYAN);

  // LOS line
  ctx.strokeStyle = near.tele.locked ? "rgba(255,93,93,0.9)" : "rgba(124,138,165,0.7)";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(toX(near.pos[0]), toY(near.pos[2]));
  ctx.lineTo(toX(pl.pos[0]), toY(pl.pos[2]));
  ctx.stroke();
  ctx.setLineDash([]);

  // craft dots
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(toX(near.pos[0]), toY(near.pos[2]), 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CYAN;
  ctx.beginPath();
  ctx.arc(toX(pl.pos[0]), toY(pl.pos[2]), 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = MUTED;
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText(`λ̇ ${((near.tele.lambdaDot * 180) / Math.PI).toFixed(2)} °/s`, 6, 12);
}
