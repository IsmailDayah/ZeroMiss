"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { runEngagement3D, type Engagement3DSpec, type Maneuver3D, type Vec3 } from "@/lib/sim/threeD";

const SCALE = 0.02; // metres -> scene units
const CYAN = 0x37e0e6;
const AMBER = 0xffb454;

const MANEUVERS: Array<{ id: Maneuver3D["kind"]; label: string }> = [
  { id: "climb_turn", label: "Climbing break" },
  { id: "barrel", label: "Barrel roll" },
  { id: "weave3d", label: "Out-of-plane weave" },
  { id: "constant_velocity", label: "Diving target" },
];

// Dramatic-but-physical geometry: the target starts high and off to the side, so the
// interceptor must genuinely climb and bank in all three axes to reach it.
function makeSpec(kind: Maneuver3D["kind"]): Engagement3DSpec {
  return {
    missilePos: [0, 0, 0],
    missileVel: [1000, 0, 0],
    targetPos: [6500, 1600, 1900],
    targetVel: [-300, -30, -60],
    N: 4,
    aMaxG: 55,
    targetAMaxG: 12,
    maneuver: { kind, amplitudeG: 11, periodS: 3.0, startS: 0.6 },
    lethalRadiusM: 6,
    tMaxS: 15,
    dt: 0.002,
  };
}

export default function ThreeDPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ restart: () => void } | null>(null);
  const [kind, setKind] = useState<Maneuver3D["kind"]>("climb_turn");
  const [verdict, setVerdict] = useState<string | null>(null);
  const [glOk, setGlOk] = useState(true);

  const setManeuver = useCallback((k: Maneuver3D["kind"]) => setKind(k), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 10000);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setGlOk(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "3-D interception view");
    renderer.domElement.setAttribute("role", "img");

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const grid = new THREE.GridHelper(800, 40, 0x1d8e93, 0x16233a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    scene.add(grid);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6);
    dl.position.set(1, 2, 1);
    scene.add(dl);

    const mkCraft = (c: number) => {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(3, 9, 18),
        new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 }),
      );
      scene.add(m);
      return m;
    };
    const missileMesh = mkCraft(CYAN);
    const targetMesh = mkCraft(AMBER);

    const fatTrail = (c: number, op: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3000 * 3), 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op }));
      scene.add(line);
      return geo;
    };
    const ghostM = fatTrail(CYAN, 0.18); // faint full arc (shows the whole 3-D shape)
    const ghostT = fatTrail(AMBER, 0.18);
    const trailM = fatTrail(CYAN, 1.0); // bright growing trail
    const trailT = fatTrail(AMBER, 1.0);

    const losGeo = new THREE.BufferGeometry();
    losGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const los = new THREE.Line(losGeo, new THREE.LineDashedMaterial({ color: 0x7c8aa5, dashSize: 5, gapSize: 4 }));
    scene.add(los);

    // altitude drop-lines (craft -> ground plane) make the 3rd dimension unmistakable
    const dropGeo = new THREE.BufferGeometry();
    dropGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    const drops = new THREE.LineSegments(dropGeo, new THREE.LineBasicMaterial({ color: 0x37e0e6, transparent: true, opacity: 0.3 }));
    scene.add(drops);

    let result = runEngagement3D(makeSpec(kind));
    let cx = 0, cz = 0;
    const toScene = (p: Vec3): Vec3 => [p[0] * SCALE - cx, p[2] * SCALE, -(p[1] * SCALE) + cz]; // world z -> up

    const fitCamera = () => {
      const f = result.frames;
      cx = ((f[0].m[0] + f[0].tg[0]) / 2) * SCALE;
      cz = ((f[0].m[1] + f[0].tg[1]) / 2) * SCALE;
      const box = new THREE.Box3();
      for (const fr of f) {
        box.expandByPoint(new THREE.Vector3(...toScene(fr.m)));
        box.expandByPoint(new THREE.Vector3(...toScene(fr.tg)));
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      controls.target.copy(center);
      camera.position.copy(center.clone().add(new THREE.Vector3(0.75, 0.55, 1.0).normalize().multiplyScalar(size * 1.15)));
      camera.near = size / 100;
      camera.far = size * 10;
      camera.updateProjectionMatrix();
      // draw the full faint arcs once
      writeArc(ghostM, f.length, (i) => f[i].m);
      writeArc(ghostT, f.length, (i) => f[i].tg);
    };

    const writeArc = (geo: THREE.BufferGeometry, count: number, pick: (i: number) => Vec3) => {
      const a = (geo.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < count; i++) {
        const p = toScene(pick(i));
        a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2];
      }
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      geo.setDrawRange(0, count);
    };

    fitCamera();

    let idx = 0, acc = 0, last = 0, raf = 0;
    const playbackFps = 80;
    const shown = { v: false };

    const restart = () => {
      result = runEngagement3D(makeSpec(kind));
      fitCamera();
      idx = 0; acc = 0; shown.v = false;
      setVerdict(null);
    };
    apiRef.current = { restart };

    const loop = (now: number) => {
      if (!last) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const f = result.frames;
      acc += dt * playbackFps;
      while (acc >= 1 && idx < f.length - 1) { idx++; acc -= 1; }
      const cur = f[Math.min(idx, f.length - 1)];
      const m = toScene(cur.m);
      const tg = toScene(cur.tg);
      missileMesh.position.set(...m);
      targetMesh.position.set(...tg);
      writeArc(trailM, idx + 1, (i) => f[i].m);
      writeArc(trailT, idx + 1, (i) => f[i].tg);
      (losGeo.getAttribute("position") as THREE.BufferAttribute).array.set([...m, ...tg]);
      (losGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      los.computeLineDistances();
      (dropGeo.getAttribute("position") as THREE.BufferAttribute).array.set([
        m[0], m[1], m[2], m[0], 0, m[2],
        tg[0], tg[1], tg[2], tg[0], 0, tg[2],
      ]);
      (dropGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

      if (idx >= f.length - 1 && !shown.v) {
        shown.v = true;
        setVerdict(`${result.verdict} · miss ${result.missDistance.toFixed(1)} m · peak ${result.peakG.toFixed(0)} g`);
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [kind]);

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">3-D View</h1>
        {MANEUVERS.map((m) => (
          <button
            key={m.id}
            onClick={() => setManeuver(m.id)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${kind === m.id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"}`}
          >
            {m.label}
          </button>
        ))}
        <button className="btn" onClick={() => apiRef.current?.restart()}>↺ Replay</button>
        <span className="ml-2 text-xs text-muted">drag to orbit · scroll to zoom</span>
      </div>
      <ErrorBoundary label="3-D view">
        <div className="relative">
          <div ref={mountRef} className="h-[62vh] w-full overflow-hidden rounded-xl border border-grid bg-bg" />
          {!glOk && (
            <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-muted">
              WebGL isn&apos;t available in this browser. Try the 2-D modes — same validated engine.
            </div>
          )}
          {verdict && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-bg/80 px-3 py-1 text-sm text-ink">
              {verdict}
            </div>
          )}
        </div>
      </ErrorBoundary>
      <p className="mt-3 max-w-prose text-sm text-muted">
        A <strong>true 3-D engagement</strong>: 3-D proportional navigation
        (<span className="tnum">a = N·(Ω × v)</span>) against a target that climbs and breaks
        out of plane. The interceptor banks and climbs through all three axes — the faint
        arcs show the full paths, the drop-lines show altitude. The 3-D engine is
        cross-validated Python ↔ TypeScript to &lt; 0.1 %, just like the planar core.
      </p>
    </div>
  );
}
