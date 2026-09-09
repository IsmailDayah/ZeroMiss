"use client";

/**
 * FPV — the "real footage" prototype. You are the camera of an FPV drone over the city,
 * hunted by a Patriot battery running the real, validated proportional navigation.
 * The render is deliberately treated as *drone video*, not graphics: fisheye, grain,
 * exposure flicker, jello, and a DJI-style OSD (see lib/arena/fpvlook.ts).
 *
 * The world is a procedural city — no external tile service, no API key, no billing.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { ArenaAudio } from "@/lib/arena/audio";
import { ArenaControls } from "@/lib/arena/controls";
import { Explosion, SmokeTrail } from "@/lib/arena/effects";
import { buildArena } from "@/lib/arena/environments";
import { drawFPVOSD, makeFPVPass, updateFPVPass, type OSDState } from "@/lib/arena/fpvlook";
import { buildFlare, buildMissile, orient } from "@/lib/arena/vehicles";
import { ArenaSim, type ArenaState } from "@/lib/sim/arena";

const DIFF = 0.2; // fixed tier for the prototype — gentle enough to learn the camera
const MISSILE_VIS = 2.5; // visibility compromise (a real round would be a streak + a trail)

/** A racing-quad envelope (~150 km/h cruise, ~245 boosted, ~7 g): you cannot
 *  out-run a Mach-3 round — you survive by masking behind buildings and terrain. */
const FPV_QUAD = { cruise: 42, vMin: 6, vMax: 68, turnRate: 4.2, rollRate: 6.5, dragK: 0.028, aMaxG: 7 };

/** An arbitrary origin for the OSD's lat/lon readout. The sim is flat-earth local
 *  metres; this only exists so the coordinate field on the overlay ticks like a
 *  real flight controller's. It names no place. */
const SIM_ORIGIN = { lat: 0.0, lon: 0.0 };

interface RunResult {
  status: ArenaState["status"];
  reason: string;
  t: number;
  closest: number;
  score: number;
}

export default function FPVPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const osdRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"loading" | "menu" | "flying" | "done">("loading");
  const [result, setResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState(0);
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    const osd = osdRef.current;
    if (!host || !osd) return;
    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      // ---------------- renderer / scene ----------------
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const scenery = buildArena("city");
      scene.add(scenery.group);
      scene.add(scenery.sun);
      const ambient = scenery.ambient;
      ambient.intensity *= 0.55;
      scene.add(ambient);
      scene.fog = scenery.fog;
      scene.background = scenery.bg;

      const camera = new THREE.PerspectiveCamera(105, host.clientWidth / host.clientHeight, 0.3, 60000);

      // real sky + image-based lighting (same pipeline as the arena)
      const pmrem = new THREE.PMREMGenerator(renderer);
      const loadSky = (path: string) =>
        new RGBELoader().load(path, (hdr) => {
          if (!alive) return;
          const env = pmrem.fromEquirectangular(hdr);
          scene.environment = env.texture;
          scene.background = hdr;
          (hdr as THREE.DataTexture).mapping = THREE.EquirectangularReflectionMapping;
          scene.environmentIntensity = 0.9;
        });

      if (!alive) {
        renderer.dispose();
        host.removeChild(renderer.domElement);
        return;
      }
      loadSky(scenery.hdri);

      // ---------------- sim ----------------
      const seed = Math.floor(Math.random() * 1_000_000);
      const groundHeight = scenery.heightAt;
      const sim = new ArenaSim("drone", DIFF, {
        seed,
        groundHeight,
        launchSites: scenery.launchSites,
        startAlt: 520,
        profile: FPV_QUAD,
        holdFire: 5, // a breath to orient before the battery opens up
      });



      // ---------------- post: the "video" look ----------------
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.45, 0.8, 0.85));
      const fpvPass = makeFPVPass();
      composer.addPass(fpvPass);
      composer.addPass(new OutputPass());

      // ---------------- actors ----------------
      const missiles = new Map<number, { mesh: THREE.Group; trail: SmokeTrail; wasAlive: boolean }>();
      for (const it of sim.state.interceptors) {
        const mesh = buildMissile();
        mesh.scale.setScalar(MISSILE_VIS);
        mesh.visible = false;
        scene.add(mesh);
        // a SAM's trail is a fat, persistent white column — the thing you actually see
        missiles.set(it.id, {
          mesh,
          trail: new SmokeTrail(scene, 0xe8edf3, 600, { size: 26, sizeBase: 10, grow: 30, life: 6, opacity: 0.5, spread: 8 }),
          wasAlive: false,
        });
      }
      // launch plume: the dense vertical smoke column off the rail (ref: real launches)
      const plumeSmoke = new SmokeTrail(scene, 0xf2f4f6, 500, { size: 46, sizeBase: 20, grow: 55, life: 7, opacity: 0.45, spread: 14 });
      const plumes: { x: number; y: number; z: number; t: number }[] = [];
      const plumeVec = new THREE.Vector3();
      const flarePool: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const f = buildFlare();
        f.scale.setScalar(3);
        f.visible = false;
        scene.add(f);
        flarePool.push(f);
      }
      let explosions: Explosion[] = [];

      // ---------------- input / audio / analyzer ----------------
      const controls = new ArenaControls();
      controls.attach(host);
      const audio = new ArenaAudio();
      const analyzerRef = { current: false };
      const onKey = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() === "e") analyzerRef.current = !analyzerRef.current;
      };
      window.addEventListener("keydown", onKey);

      // ---------------- resize ----------------
      const octx = osd.getContext("2d")!;
      const resize = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        osd.width = w * dpr;
        osd.height = h * dpr;
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener("resize", resize);

      // ---------------- loop ----------------
      const clock = new THREE.Clock();
      let bank = 0;
      let ended = false;
      const tmpUp = new THREE.Vector3();
      const tmpDir = new THREE.Vector3();
      const tmpPos = new THREE.Vector3();

      startRef.current = () => {
        sim.start();
        audio.start();
        setPhase("flying");
      };

      renderer.setAnimationLoop(() => {
        const dt = Math.min(0.05, clock.getDelta());
        const input = controls.sample();
        const st = sim.step(dt, input);
        const pl = st.player;


        // ----- camera = the drone's FPV lens -----
        tmpPos.set(pl.pos[0], pl.pos[1], pl.pos[2]);
        tmpDir.set(pl.dir[0], pl.dir[1], pl.dir[2]);
        tmpUp.set(pl.up[0], pl.up[1], pl.up[2]);
        bank += (-input.yaw * 0.45 - bank) * Math.min(1, 6 * dt); // lean into turns
        tmpUp.applyAxisAngle(tmpDir, bank);
        // vibration: g-load + speed
        const shake = Math.min(1, pl.gLoad / 6) * 0.55 + (pl.speed / 420) * 0.2;
        camera.position.copy(tmpPos)
          .addScaledVector(tmpUp, 0.8)
          .add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
        camera.up.copy(tmpUp);
        camera.lookAt(tmpPos.clone().addScaledVector(tmpDir, 60));

        // ----- interceptors -----
        let nLive = 0;
        let warn: OSDState["warn"] = null;
        let nearestTele: OSDState["tele"] = null;
        let nearestR = Infinity;
        for (const it of st.interceptors) {
          const vis = missiles.get(it.id)!;
          if (it.alive) {
            nLive++;
            if (!vis.wasAlive) {
              // launch: flash + smoke column + whoosh, and the thump arrives at the
              // speed of sound — you SEE the distant launch before you HEAR it
              explosions.push(new Explosion(scene, new THREE.Vector3(it.origin[0], it.origin[1], it.origin[2]), 60));
              plumes.push({ x: it.origin[0], y: it.origin[1], z: it.origin[2], t: 0 });
              audio.whoosh();
              audio.boomAt(Math.hypot(it.origin[0] - pl.pos[0], it.origin[1] - pl.pos[1], it.origin[2] - pl.pos[2]));
            }
            vis.mesh.visible = true;
            vis.mesh.position.set(it.pos[0], it.pos[1], it.pos[2]);
            orient(vis.mesh, new THREE.Vector3(it.vel[0], it.vel[1], it.vel[2]), new THREE.Vector3(0, 1, 0));
            vis.trail.emit(vis.mesh.position, dt, 90);
            if (it.tele.R < nearestR) {
              nearestR = it.tele.R;
              nearestTele = it.tele;
              // bearing of the threat relative to our nose (for the OSD chevron)
              const heading = Math.atan2(tmpDir.x, -tmpDir.z);
              const angTo = Math.atan2(it.pos[0] - pl.pos[0], -(it.pos[2] - pl.pos[2]));
              let b = angTo - heading;
              while (b > Math.PI) b -= Math.PI * 2;
              while (b < -Math.PI) b += Math.PI * 2;
              if (it.locked) warn = { dist: it.tele.R, bearing: b };
            }
          } else {
            if (vis.wasAlive) {
              // died mid-air (terrain / fuel / overshoot): blow it up where it was,
              // heard late and quiet with distance
              explosions.push(new Explosion(scene, vis.mesh.position.clone(), 70));
              audio.boomAt(Math.hypot(vis.mesh.position.x - pl.pos[0], vis.mesh.position.y - pl.pos[1], vis.mesh.position.z - pl.pos[2]));
            }
            vis.mesh.visible = false;
          }
          vis.wasAlive = it.alive;
          vis.trail.update(dt);
        }

        // ----- flares -----
        for (let i = 0; i < flarePool.length; i++) {
          const f = st.flares[i];
          if (f) {
            flarePool[i].visible = true;
            flarePool[i].position.set(f.pos[0], f.pos[1], f.pos[2]);
          } else {
            flarePool[i].visible = false;
          }
        }

        // ----- launch plumes (dense white columns rising off the rails) -----
        for (let i = plumes.length - 1; i >= 0; i--) {
          const p = plumes[i];
          p.t += dt;
          if (p.t > 1.8) {
            plumes.splice(i, 1);
            continue;
          }
          plumeVec.set(p.x + (Math.random() - 0.5) * 10, p.y + Math.random() * 150 * p.t, p.z + (Math.random() - 0.5) * 10);
          plumeSmoke.emit(plumeVec, dt, 170);
        }
        plumeSmoke.update(dt);

        // ----- explosions -----
        explosions = explosions.filter((e) => {
          e.update(dt);
          if (e.done) {
            e.dispose(scene);
            return false;
          }
          return true;
        });

        // ----- audio -----
        const spdFrac = (pl.speed - sim.profile.vMin) / (sim.profile.vMax - sim.profile.vMin);
        audio.setEngine(spdFrac);
        audio.setWind(spdFrac);
        audio.setLockWarning(st.status === "flying" && !!warn && warn.dist < 3200);

        // ----- end of run -----
        if (st.status !== "flying" && st.status !== "ready" && !ended) {
          ended = true;
          audio.setLockWarning(false);
          if (st.status === "intercepted" || st.status === "crashed") {
            audio.boom();
            explosions.push(new Explosion(scene, tmpPos.clone(), 110));
          }
          const r: RunResult = { status: st.status, reason: st.reason, t: st.t, closest: st.closest, score: Math.round(st.score) };
          setTimeout(() => {
            setResult(r);
            setPhase("done");
          }, 1000);
        }

        // ----- render: world → video -----
        updateFPVPass(fpvPass, st.t, pl.gLoad, !!warn, Math.max(0, tmpDir.y));
        composer.render();

        // ----- OSD -----
        const latRad = (SIM_ORIGIN.lat * Math.PI) / 180;
        drawFPVOSD(octx, host.clientWidth, host.clientHeight, {
          t: st.t,
          spdKmh: pl.speed * 3.6,
          altM: pl.pos[1] - scenery.heightAt(pl.pos[0], pl.pos[2]),
          throttle: input.throttle,
          g: pl.gLoad,
          flares: st.flaresLeft,
          volts: Math.max(13.6, 16.8 - 2.4 * (st.t / sim.diff.surviveTime) - 0.5 * input.throttle - (input.boost ? 0.35 : 0)),
          lat: SIM_ORIGIN.lat + -pl.pos[2] / 111320,
          lon: SIM_ORIGIN.lon + pl.pos[0] / (111320 * Math.cos(latRad)),
          headingDeg: ((Math.atan2(tmpDir.x, -tmpDir.z) * 180) / Math.PI + 360) % 360,
          rollRad: bank,
          pitchFrac: tmpDir.y,
          warn,
          nLive,
          analyzer: analyzerRef.current,
          tele: nearestTele,
          N: sim.diff.N,
        });
      });

      setPhase("menu");

      cleanup = () => {
        renderer.setAnimationLoop(null);
        window.removeEventListener("resize", resize);
        window.removeEventListener("keydown", onKey);
        controls.detach();
        audio.stop();
        for (const { mesh, trail } of missiles.values()) {
          scene.remove(mesh);
          trail.dispose(scene);
        }
        plumeSmoke.dispose(scene);
        explosions.forEach((e) => e.dispose(scene));
        pmrem.dispose();
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else if (mat) mat.dispose();
        });
        renderer.dispose();
        if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, [runId]);

  return (
    <div className="relative h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-black">
      <div ref={hostRef} className="absolute inset-0" />
      <canvas ref={osdRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {phase === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <span className="font-mono text-sm text-cyan">ACQUIRING SIGNAL…</span>
        </div>
      )}

      {phase === "menu" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/55 text-center">
          <span className="chip">prototype · real-footage look</span>
          <h1 className="font-mono text-4xl font-bold text-ink">FPV // SECTOR 7</h1>
          <p className="max-w-md text-sm text-muted">
            You are the camera. A Patriot battery below is running the real, validated
            proportional navigation — outlast its barrage.

          </p>
          <button className="btn btn-primary" onClick={() => startRef.current()}>
            ▶ ARM &amp; LAUNCH
          </button>
          <p className="font-mono text-xs text-muted">
            mouse steer · W/S throttle · SHIFT boost · SPACE flare · E analyzer
          </p>
        </div>
      )}

      {phase === "done" && result && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
          <h2 className={`font-mono text-3xl font-bold ${result.status === "escaped" ? "text-cyan" : "text-red-400"}`}>
            {result.status === "escaped" ? "SIGNAL SURVIVED" : result.status === "crashed" ? "IMPACT — TERRAIN" : "SIGNAL LOST"}
          </h2>
          <p className="max-w-md text-sm text-muted">{result.reason}</p>
          <p className="font-mono text-xs text-muted">
            time {result.t.toFixed(1)} s · closest {isFinite(result.closest) ? `${Math.round(result.closest)} m` : "—"} · score {result.score}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => { setResult(null); setPhase("loading"); setRunId((r) => r + 1); }}>
              ↻ FLY AGAIN
            </button>
            <Link href="/arena" className="btn">Arena mode →</Link>
          </div>
        </div>
      )}

    </div>
  );
}
