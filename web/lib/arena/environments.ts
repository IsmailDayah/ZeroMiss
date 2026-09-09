/**
 * Procedural arenas for the Intercept Arena (Three.js): terrain + a gradient sky dome +
 * sun + clouds, plus a `heightAt(x,z)` used for crash/terrain + camera collision. No
 * external assets — geometry, gradients and sprite textures are all generated.
 */

import * as THREE from "three";
import { buildPatriotBattery, buildRadar } from "./vehicles";

export type ArenaTheme = "desert" | "ocean" | "city" | "alpine";

export interface ArenaScenery {
  group: THREE.Group;
  bg: THREE.Color;
  fog: THREE.Fog;
  sun: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  label: string;
  /** terrain/structure height at a world (x,z) — for crash + camera collision */
  heightAt: (x: number, z: number) => number;
  /** ground air-defence battery sites [x,y,z] that interceptors launch from */
  launchSites: [number, number, number][];
  /** path to the theme's CC0 sky HDRI — real sky background + image-based lighting */
  hdri: string;
}

// --- deterministic value-noise (no deps) ---
function hash(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x: number, z: number, oct = 4): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

const SIZE = 30000;
const SEG = 140;

function terrainMesh(heightFn: (x: number, z: number) => number, colorFn: (h: number) => THREE.Color): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightFn(x, z);
    pos.setY(i, h);
    const c = colorFn(h);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, flatShading: true }));
}

// A facade texture: dark glass with a grid of lit/unlit windows (used as emissiveMap).
function windowTexture(): THREE.Texture {
  const w = 128, h = 256;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, w, h);
  const cols = 8, rows = 18;
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const lit = Math.random();
      // warm or cool office light, with many dark windows
      const color = lit > 0.62 ? (Math.random() > 0.5 ? "#ffd98a" : "#cfe2ff") : "#0b1018";
      ctx.fillStyle = color;
      ctx.fillRect(col * cw + cw * 0.18, r * ch + ch * 0.18, cw * 0.64, ch * 0.5);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function radialSprite(inner: string, outer: string, size = 128): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function addClouds(group: THREE.Group, n: number, baseY: number, tint = "rgba(255,255,255,0.9)"): void {
  const tex = radialSprite(tint, "rgba(255,255,255,0)");
  const matBase = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < n; i++) {
    const s = matBase.clone();
    const spr = new THREE.Sprite(s);
    spr.position.set((Math.random() - 0.5) * 22000, baseY + Math.random() * 1200, (Math.random() - 0.5) * 22000);
    spr.scale.set(2200 + Math.random() * 2600, 1100 + Math.random() * 1200, 1);
    group.add(spr);
  }
}

export function buildArena(theme: ArenaTheme): ArenaScenery {
  const group = new THREE.Group();
  let bg: THREE.Color, fogColor: number, fogNear: number, fogFar: number;
  let sunColor = 0xffffff, sunInt = 0.95, ambColor = 0xffffff, ambInt = 0.55, label = "";
  let heightAt: (x: number, z: number) => number = () => 0;
  let hdri = "/hdri/sky_clouds.hdr";
  const sunDir = new THREE.Vector3(0.5, 0.6, 0.3);

  if (theme === "desert") {
    label = "Desert Canyon";
    bg = new THREE.Color(0xe9c89a);
    fogColor = 0xe7c193; fogNear = 4000; fogFar = 24000;
    sunColor = 0xfff0d0; ambColor = 0xd8b894; ambInt = 0.6;
    // gentle rolling dunes (≈ −300..+500 m) so flying at cruise altitude is safe but
    // hugging the deck is risky — the crash check is the real floor.
    const hf = (x: number, z: number) => fbm(x / 3800, z / 3800, 5) * 620 - 120 - Math.abs(Math.sin(x / 3200)) * 180;
    heightAt = hf;
    group.add(terrainMesh(hf, (h) => new THREE.Color().setHSL(0.09, 0.5, 0.45 + Math.min(0.25, h / 1600))));
    hdri = "/hdri/sky_golden.hdr";
    addClouds(group, 10, 2600, "rgba(255,250,240,0.7)");
  } else if (theme === "ocean") {
    label = "Open Ocean";
    bg = new THREE.Color(0x9fd6ff);
    fogColor = 0xbfe4ff; fogNear = 6000; fogFar = 26000;
    sunColor = 0xffffff; ambColor = 0xbfe0ff; ambInt = 0.6;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 60, 60), new THREE.MeshStandardMaterial({ color: 0x1f6da8, metalness: 0.65, roughness: 0.2, flatShading: true }));
    sea.rotation.x = -Math.PI / 2;
    const sp = sea.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) / 600) * 18 + Math.cos(sp.getY(i) / 700) * 14);
    sea.geometry.computeVertexNormals();
    sea.position.y = -40;
    group.add(sea);
    heightAt = () => -40;
    hdri = "/hdri/sky_blue.hdr";
    addClouds(group, 12, 2800);
  } else if (theme === "city") {
    label = "City Skyline";
    bg = new THREE.Color(0x2a3a55);
    fogColor = 0x29384f; fogNear = 2500; fogFar = 16000;
    sunColor = 0xffe8c0; sunInt = 0.85; ambColor = 0x6a7ba0; ambInt = 0.55;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ color: 0x16202f, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);
    const winTex = windowTexture();
    const bmat = new THREE.MeshStandardMaterial({ color: 0x0c1320, roughness: 0.45, metalness: 0.35, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.0 });
    const N = 600;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bmat, N);
    const m = new THREE.Matrix4();
    const blds: { x: number; z: number; w: number; h: number }[] = [];
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 18000, z = (Math.random() - 0.5) * 18000;
      const h = 60 + Math.random() * 420, w = 120 + Math.random() * 220, d = 120 + Math.random() * 220;
      m.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
      inst.setMatrixAt(i, m);
      blds.push({ x, z, w: Math.max(w, d), h });
    }
    group.add(inst);
    heightAt = (x, z) => {
      let hmax = 0;
      for (const b of blds) {
        if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.w / 2) hmax = Math.max(hmax, b.h);
      }
      return hmax;
    };
    hdri = "/hdri/sky_golden.hdr";
  } else {
    label = "Alpine Peaks";
    bg = new THREE.Color(0xcfe3f5);
    fogColor = 0xdfeaf5; fogNear = 4500; fogFar = 24000;
    sunColor = 0xffffff; ambColor = 0xcfe0f0; ambInt = 0.6;
    // dramatic but climbable peaks (≈ −200..+1900 m); snow caps above 1300 m.
    const hf = (x: number, z: number) => Math.pow(fbm(x / 3600, z / 3600, 6), 1.8) * 2100 - 200;
    heightAt = hf;
    group.add(terrainMesh(hf, (h) => (h > 1300 ? new THREE.Color(0xffffff) : new THREE.Color().setHSL(0.32, 0.35, 0.3 + Math.min(0.25, h / 3000)))));
    hdri = "/hdri/sky_clouds.hdr";
    addClouds(group, 8, 2600);
  }

  // ground air-defence batteries (Patriot launcher + radar) ringed around the player
  const launchSites = placeBatteries(group, heightAt);

  // a key directional light to complement the HDRI's image-based lighting
  const sun = new THREE.DirectionalLight(sunColor, sunInt);
  sun.position.copy(sunDir.clone().multiplyScalar(5000));
  const ambient = new THREE.AmbientLight(ambColor, ambInt);
  return { group, bg, fog: new THREE.Fog(fogColor, fogNear, fogFar), sun, ambient, label, heightAt, launchSites, hdri };
}

const BATTERY_SCALE = 22; // visibility multiplier (same compromise as the vehicles)

/** Place Patriot launchers + radars on the ground and return their canister-mouth points. */
function placeBatteries(group: THREE.Group, heightAt: (x: number, z: number) => number): [number, number, number][] {
  const sites: [number, number, number][] = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2; // one battery dead ahead (+X) of the spawn
    const r = 5500;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gy = heightAt(x, z);
    const yaw = Math.atan2(-z, -x); // face the map centre (where the player starts)

    const bat = buildPatriotBattery();
    bat.scale.setScalar(BATTERY_SCALE);
    bat.position.set(x, gy, z);
    bat.rotation.y = yaw;
    group.add(bat);

    const rad = buildRadar();
    rad.scale.setScalar(BATTERY_SCALE);
    const rx = x + Math.cos(yaw + Math.PI / 2) * 700;
    const rz = z + Math.sin(yaw + Math.PI / 2) * 700;
    rad.position.set(rx, heightAt(rx, rz), rz);
    rad.rotation.y = yaw;
    group.add(rad);

    // launch from roughly the canister mouth (scaled height above the trailer)
    sites.push([x, gy + BATTERY_SCALE * 6, z]);
  }
  return sites;
}

export const THEMES: { id: ArenaTheme; label: string }[] = [
  { id: "desert", label: "Desert Canyon" },
  { id: "ocean", label: "Open Ocean" },
  { id: "city", label: "City Skyline" },
  { id: "alpine", label: "Alpine Peaks" },
];
