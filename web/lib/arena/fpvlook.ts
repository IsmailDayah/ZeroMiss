/**
 * FPV "real footage" look — the camera-simulation layer that makes the render read as
 * FPV *video* instead of computer graphics: fisheye barrel distortion, lateral
 * chromatic aberration, sensor grain, exposure flicker, vignette, g-load "jello" wobble
 * (rolling-shutter), plus a DJI/Betaflight-style OSD drawn on a 2-D overlay canvas.
 *
 * The trick: real action-camera footage is compressed, noisy and distorted, and those
 * artifacts *hide* CG imperfections. Simulate the camera rather than the world, and
 * the eye fills in the rest.
 */

import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// ----------------------------------------------------------------------- video shader
const FPVVideoShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDistort: { value: 0.32 }, // fisheye barrel amount
    uCA: { value: 0.0035 }, // chromatic aberration
    uVignette: { value: 0.6 },
    uGrain: { value: 0.042 }, // sensor noise
    uFlicker: { value: 1.0 }, // per-frame exposure gain (set from JS)
    uJello: { value: 0.0 }, // rolling-shutter wobble, driven by g-load
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDistort, uCA, uVignette, uGrain, uFlicker, uJello;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // barrel (fisheye) distortion — wide FPV lens
      vec2 uv = 0.5 + c * (1.0 + uDistort * r2) / (1.0 + uDistort * 0.25);
      // g-load jello: the airframe flexing against the rolling shutter
      uv.x += sin(vUv.y * 60.0 + uTime * 85.0) * 0.0018 * uJello;
      uv.y += cos(vUv.y * 47.0 + uTime * 71.0) * 0.0008 * uJello;
      // lateral chromatic aberration, worse toward the edges (cheap lens)
      vec2 off = c * uCA * (0.5 + r2 * 3.0);
      float cr = texture2D(tDiffuse, uv + off).r;
      float cg = texture2D(tDiffuse, uv).g;
      float cb = texture2D(tDiffuse, uv - off).b;
      vec3 col = vec3(cr, cg, cb);
      // sensor grain (animated)
      float n = hash(vUv * vec2(1287.0, 718.0) + mod(uTime * 137.0, 100.0)) * 2.0 - 1.0;
      col += n * uGrain * (0.35 + 0.65 * (1.0 - dot(col, vec3(0.333))));
      // vignette
      float vig = smoothstep(0.85, 0.32, length(c));
      col *= mix(1.0, vig, uVignette);
      // auto-exposure flicker
      col *= uFlicker;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function makeFPVPass(): ShaderPass {
  return new ShaderPass(FPVVideoShader);
}

/** Per-frame uniform update (call from the render loop).
 *  `skyFrac` (0..1, how much the lens points at the sky) drives a cheap auto-exposure:
 *  cameras stop down against a bright sky, so the image dims slightly when you climb. */
export function updateFPVPass(pass: ShaderPass, t: number, gLoad: number, warn: boolean, skyFrac = 0): void {
  pass.uniforms.uTime.value = t;
  pass.uniforms.uJello.value = Math.min(1, gLoad / 5);
  const aeBase = 1 - Math.max(0, skyFrac) * 0.16;
  // small random exposure hunting; a touch more when the warning tone is screaming
  pass.uniforms.uFlicker.value = aeBase + (Math.random() - 0.5) * (warn ? 0.05 : 0.022);
}

// ------------------------------------------------------------------------------- OSD
export interface OSDTele {
  R: number;
  Vc: number;
  lambdaDot: number;
  tGo: number;
  cmdG: number;
  achG: number;
  saturated: boolean;
  locked: boolean;
  seduced: boolean;
}

export interface OSDState {
  t: number; // sim time [s]
  spdKmh: number;
  altM: number;
  throttle: number; // 0..1
  g: number; // player g-load
  flares: number;
  volts: number; // battery voltage (sags over the run)
  lat: number;
  lon: number;
  headingDeg: number; // 0..360
  rollRad: number; // camera bank
  pitchFrac: number; // dir.y, -1..1
  warn: { dist: number; bearing: number } | null; // nearest live locked missile
  nLive: number; // interceptors airborne
  analyzer: boolean;
  tele: OSDTele | null; // nearest interceptor telemetry (Analyzer)
  N: number; // navigation constant in play (Analyzer)
}

function txt(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size = 15,
  color = "rgba(226,255,240,0.92)",
  align: CanvasTextAlign = "left",
  weight = "600",
): void {
  ctx.font = `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function fmtCoord(v: number, pos: string, neg: string): string {
  const h = v >= 0 ? pos : neg;
  return `${Math.abs(v).toFixed(4)}${h}`;
}

function timecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 30);
  const p = (n: number) => String(n).padStart(2, "0");
  return `00:${p(m)}:${p(s)}:${p(f)}`;
}

/** Draw the full DJI/Betaflight-style on-screen display. Canvas must match CSS pixels. */
export function drawFPVOSD(ctx: CanvasRenderingContext2D, W: number, H: number, o: OSDState): void {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const blink = Math.floor(o.t * 2) % 2 === 0;
  const fastBlink = Math.floor(o.t * 6) % 2 === 0;

  // ---- top-left: link + GPS
  const bars = 4;
  for (let i = 0; i < bars; i++) {
    ctx.fillStyle = i < 3 ? "rgba(226,255,240,0.92)" : "rgba(226,255,240,0.35)";
    ctx.fillRect(18 + i * 8, 30 - i * 4, 5, 6 + i * 4);
  }
  txt(ctx, "RC 98%", 58, 32, 14);
  txt(ctx, "GPS 14", 18, 54, 14);
  txt(ctx, "SECTOR 7", 18, 74, 13, "rgba(226,255,240,0.7)");
  txt(ctx, "SIM WORLD", 18, 92, 11, "rgba(255,210,95,0.7)");

  // ---- top-right: REC + timecode
  if (blink) {
    ctx.fillStyle = "#ff4545";
    ctx.beginPath();
    ctx.arc(W - 148, 27, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  txt(ctx, "REC", W - 136, 32, 15, "rgba(255,255,255,0.95)");
  txt(ctx, timecode(o.t), W - 18, 32, 15, "rgba(226,255,240,0.92)", "right");
  txt(ctx, "1080P60 · H.264", W - 18, 54, 12, "rgba(226,255,240,0.6)", "right");

  // ---- artificial horizon (center, rotated by bank, offset by pitch)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-o.rollRad);
  const pitchPx = o.pitchFrac * H * 0.32;
  ctx.strokeStyle = "rgba(226,255,240,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-W * 0.16, pitchPx);
  ctx.lineTo(-W * 0.05, pitchPx);
  ctx.moveTo(W * 0.05, pitchPx);
  ctx.lineTo(W * 0.16, pitchPx);
  ctx.stroke();
  ctx.restore();

  // ---- crosshair
  ctx.strokeStyle = "rgba(226,255,240,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy);
  ctx.lineTo(cx - 5, cy);
  ctx.moveTo(cx + 5, cy);
  ctx.lineTo(cx + 14, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy - 5);
  ctx.stroke();
  ctx.fillStyle = "rgba(226,255,240,0.9)";
  ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);

  // ---- heading tape (top center)
  const hdg = Math.round(o.headingDeg);
  txt(ctx, `${String(hdg).padStart(3, "0")}°`, cx, 30, 16, "rgba(226,255,240,0.92)", "center");

  // ---- missile warning + bearing arrow around the crosshair
  if (o.warn) {
    if (fastBlink) {
      txt(ctx, `⚠ MISSILE ${Math.round(o.warn.dist)} m`, cx, cy - H * 0.17, 24, "#ff5050", "center", "800");
    }
    // bearing chevron on a ring around center: 0 = dead ahead
    const a = o.warn.bearing - Math.PI / 2;
    const rr = Math.min(W, H) * 0.13;
    const ax = cx + Math.cos(a) * rr;
    const ay = cy + Math.sin(a) * rr;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = fastBlink ? "#ff5050" : "rgba(255,80,80,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 7);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    txt(ctx, `THREATS AIRBORNE ${o.nLive}`, cx, cy - H * 0.17 + 24, 13, "rgba(255,120,120,0.85)", "center");
  }

  // ---- bottom-left: battery + flares
  const vColor = o.volts > 15.2 ? "rgba(140,255,170,0.95)" : o.volts > 14.4 ? "#ffd25f" : "#ff5050";
  txt(ctx, `${o.volts.toFixed(1)}V`, 18, H - 44, 20, vColor, "left", "700");
  txt(ctx, `4S LIPO`, 18, H - 24, 12, "rgba(226,255,240,0.6)");
  txt(ctx, `FLR ×${o.flares}`, 118, H - 44, 16, o.flares > 0 ? "rgba(226,255,240,0.92)" : "#ff5050");
  txt(ctx, `THR ${Math.round(o.throttle * 100)}%`, 118, H - 24, 13, "rgba(226,255,240,0.7)");

  // ---- bottom-center: speed + g
  txt(ctx, `${Math.round(o.spdKmh)}`, cx - 8, H - 34, 26, "rgba(226,255,240,0.95)", "right", "800");
  txt(ctx, "KM/H", cx + 2, H - 34, 12, "rgba(226,255,240,0.7)");
  txt(ctx, `${o.g.toFixed(1)}G`, cx + 64, H - 34, 15, o.g > 3.5 ? "#ffd25f" : "rgba(226,255,240,0.8)");

  // ---- bottom-right: alt + coords
  txt(ctx, `ALT ${Math.round(o.altM)}M`, W - 18, H - 44, 17, "rgba(226,255,240,0.92)", "right", "700");
  txt(ctx, `${fmtCoord(o.lat, "N", "S")} ${fmtCoord(o.lon, "E", "W")}`, W - 18, H - 24, 12, "rgba(226,255,240,0.65)", "right");

  // ---- Analyzer panel (the 1% — real GN&C telemetry, opt-in with [E])
  if (o.analyzer) {
    const pw = 250;
    const px = W - pw - 14;
    const py = 88;
    const ph = o.tele ? 210 : 74;
    ctx.fillStyle = "rgba(4,10,16,0.72)";
    ctx.strokeStyle = "rgba(55,224,230,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 6);
    ctx.fill();
    ctx.stroke();
    txt(ctx, "ANALYZER — LIVE GN&C", px + 12, py + 22, 13, "#37e0e6", "left", "700");
    if (o.tele) {
      const t = o.tele;
      const row = (label: string, val: string, y: number, color = "rgba(226,255,240,0.92)") => {
        txt(ctx, label, px + 12, y, 13, "rgba(160,190,205,0.85)");
        txt(ctx, val, px + pw - 12, y, 13, color, "right", "700");
      };
      row("Range R", `${Math.round(t.R)} m`, py + 48);
      row("Closing Vc", `${Math.round(t.Vc)} m/s`, py + 68);
      row("LOS rate λ̇", `${(t.lambdaDot * 1000).toFixed(1)} mrad/s`, py + 88, "#37e0e6");
      row("t-go", isFinite(t.tGo) ? `${t.tGo.toFixed(1)} s` : "—", py + 108);
      row("cmd g", `${t.cmdG.toFixed(0)}`, py + 128);
      row("achieved g", `${t.achG.toFixed(0)}`, py + 148, t.saturated ? "#ff5050" : "rgba(226,255,240,0.92)");
      row("guidance", `TPN · N=${o.N.toFixed(1)}`, py + 168);
      if (t.saturated && fastBlink) {
        txt(ctx, "AIRFRAME SATURATED — it can't pull this", px + 12, py + 194, 12, "#ff9c6b");
      } else if (t.seduced) {
        txt(ctx, "SEEKER SEDUCED — chasing your flare", px + 12, py + 194, 12, "#ffd25f");
      } else if (!t.locked) {
        txt(ctx, "LOCK BROKEN — outside seeker FOV", px + 12, py + 194, 12, "#8cffaa");
      } else {
        txt(ctx, "PN is nulling the LOS rate → collision", px + 12, py + 194, 12, "rgba(160,190,205,0.8)");
      }
    } else {
      txt(ctx, "no interceptor airborne", px + 12, py + 48, 12, "rgba(160,190,205,0.8)");
    }
  } else {
    txt(ctx, "[E] ANALYZER", W - 18, 78, 12, "rgba(160,190,205,0.55)", "right");
  }
}
