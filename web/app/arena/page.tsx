"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { ArenaAudio } from "@/lib/arena/audio";
import { ArenaControls } from "@/lib/arena/controls";
import { Explosion, PathTrail, SmokeTrail } from "@/lib/arena/effects";
import { THEMES, buildArena, type ArenaTheme } from "@/lib/arena/environments";
import { drawMinimap, drawTacticalPiP } from "@/lib/arena/hud2d";
import { type ScoreEntry, loadScores, parseChallenge, saveScore, shareLink } from "@/lib/arena/meta";
import { buildFlare, buildMissile, buildPlayer, orient } from "@/lib/arena/vehicles";
import { ArenaSim, difficultyFor, type ArenaState, type Interceptor, type VehicleKind } from "@/lib/sim/arena";

const CYAN = 0x37e0e6;
const AMBER = 0xffb454;
const PLAYER_VIS = { drone: 22, jet: 7 };
const MISSILE_VIS = 9;
const CAM_BACK = 260;
const CAM_UP = 80;

type Phase = "menu" | "playing" | "result";

interface Hud {
  t: number;
  speed: number;
  throttle: number;
  g: number;
  energy: number;
  score: number;
  flares: number;
  locked: boolean;
  closest: number;
  nearest: { R: number; Vc: number; lambdaDot: number; tGo: number; cmdG: number; achG: number; saturated: boolean; seduced: boolean } | null;
}

export default function ArenaPage() {
  return (
    <Suspense fallback={<div className="py-10 text-muted">Loading Arena…</div>}>
      <ArenaInner />
    </Suspense>
  );
}

function ArenaInner() {
  const params = useSearchParams();
  const chal = parseChallenge(params);
  const mountRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const pipRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const [vehicle, setVehicle] = useState<VehicleKind>(chal.vehicle ?? "jet");
  const [theme, setTheme] = useState<ArenaTheme>(chal.theme ?? "desert");
  const [difficulty, setDifficulty] = useState(chal.difficulty ?? 0.4);
  const [overlay, setOverlay] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [result, setResult] = useState<{ win: boolean; title: string; reason: string; score: number; t: number; best: number; share: string } | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [tutorial, setTutorial] = useState(false);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const tutorialRef = useRef(tutorial);
  tutorialRef.current = tutorial;
  const seedRef = useRef<number>(chal.seed ?? Math.floor(Math.random() * 1_000_000));

  useEffect(() => {
    setScores(loadScores());
    setTutorial(typeof localStorage !== "undefined" && !localStorage.getItem("zeromiss_arena_tut"));
  }, []);

  // engine refs (live across frames)
  const rafRef = useRef(0);
  const cleanupRef = useRef<() => void>(() => {});

  const startGame = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setResult(null);

    const scene = new THREE.Scene();
    const scenery = buildArena(theme);
    scene.background = scenery.bg;
    scene.fog = scenery.fog;
    // IBL from the HDRI does most of the fill now, so ease off the flat ambient
    scenery.ambient.intensity *= 0.55;
    scene.environmentIntensity = 0.9;
    scene.add(scenery.group, scenery.sun, scenery.ambient);

    // sim built AFTER scenery so it knows terrain height (crash, safe spawn) + battery sites
    const sim = new ArenaSim(vehicle, difficulty, { seed: seedRef.current, groundHeight: scenery.heightAt, launchSites: scenery.launchSites });
    const controls = new ArenaControls();
    const audio = new ArenaAudio();

    const camera = new THREE.PerspectiveCamera(62, mount.clientWidth / mount.clientHeight, 1, 40000);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    // cinematic colour: ACES filmic tonemapping in linear→sRGB
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Intercept Arena");

    // real sky + image-based lighting: load the theme's CC0 HDRI, use it as the sky
    // background AND the environment map so metal (jet, missiles, canisters) reflects it
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader().load(scenery.hdri, (hdrTex) => {
      hdrTex.mapping = THREE.EquirectangularReflectionMapping;
      const envMap = pmrem.fromEquirectangular(hdrTex).texture;
      scene.environment = envMap;
      scene.background = hdrTex; // the actual photographed sky
      scene.backgroundIntensity = 1.0;
    });

    // post-processing: bloom so afterburners, launch plumes, explosions and lit windows glow
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(mount.clientWidth, mount.clientHeight);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.55, 0.85, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // player model
    const player = buildPlayer(vehicle, CYAN);
    player.scale.multiplyScalar(PLAYER_VIS[vehicle]);
    scene.add(player);
    const playerTrail = new PathTrail(scene, CYAN, 200);
    const playerSmoke = new SmokeTrail(scene, 0xdfe6ee, 160);

    // interceptors — one reusable visual per battery slot (the battery reloads slots)
    const missiles = sim.state.interceptors.map(() => {
      const m = buildMissile(AMBER);
      m.scale.multiplyScalar(MISSILE_VIS);
      m.visible = false;
      scene.add(m);
      return { group: m, trail: new PathTrail(scene, AMBER, 220), smoke: new SmokeTrail(scene, 0xb8c0cc, 200), dead: false, wasAlive: false };
    });

    // LOS line (engineer overlay)
    const losGeo = new THREE.BufferGeometry();
    losGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const los = new THREE.Line(losGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 60, gapSize: 40, transparent: true, opacity: 0.6 }));
    los.visible = false;
    scene.add(los);

    const flareMeshes: { mesh: THREE.Mesh; ref: object }[] = [];
    const explosions: Explosion[] = [];

    controls.attach(renderer.domElement);
    audio.start();
    sim.start();

    const camPos = new THREE.Vector3(...sim.state.player.pos);
    let shake = 0;
    let last = 0;
    let ended = false;

    const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

    const syncFlares = (st: ArenaState) => {
      // add meshes for new flares, remove dead
      while (flareMeshes.length < st.flares.length) {
        const mesh = buildFlare();
        scene.add(mesh);
        flareMeshes.push({ mesh, ref: st.flares[flareMeshes.length] });
      }
      for (let i = flareMeshes.length - 1; i >= 0; i--) {
        const fm = flareMeshes[i];
        const f = st.flares.find((x) => x === fm.ref);
        if (!f) {
          scene.remove(fm.mesh);
          flareMeshes.splice(i, 1);
        } else {
          fm.mesh.position.set(f.pos[0], f.pos[1], f.pos[2]);
          (fm.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, f.life / f.max);
          fm.mesh.scale.setScalar(8 + (1 - f.life / f.max) * 10);
        }
      }
    };

    const loop = (now: number) => {
      if (!last) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // pause the simulation while the tutorial overlay is up (don't get killed reading)
      if (!tutorialRef.current) sim.step(dt, controls.sample());
      const st = sim.state;
      const pl = st.player;

      // player model
      player.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
      orient(player, v3(pl.dir), v3(pl.up));
      playerTrail.push(v3(pl.pos));
      // emit exhaust from behind the craft, not its centre (F-22 is long, Tello short)
      const exhaust = v3(pl.pos).add(v3(pl.dir).multiplyScalar(vehicle === "jet" ? -48 : -12));
      playerSmoke.emit(exhaust, dt, pl.energy > 0.7 ? 45 : 22);
      playerSmoke.update(dt);
      // spin drone rotors / pulse jet burner
      player.traverse((o) => {
        if (o.userData.spin) o.rotation.y += dt * 40;
        if (o.userData.burner) o.scale.y = 1 + (pl.speed / 900) * (0.6 + Math.random() * 0.4);
      });

      // interceptors (reusable battery slots)
      st.interceptors.forEach((it, i) => {
        const mm = missiles[i];
        // a slot that just died (terrain / overshoot / out of fuel) blows up once
        if (mm.wasAlive && !it.alive) {
          explosions.push(new Explosion(scene, v3(it.pos), 50));
          audio.boom();
          mm.dead = true;
        }
        // a slot that just relaunched gets a fresh trail + a boost plume at the battery
        if (!mm.wasAlive && it.alive) {
          mm.trail.reset();
          mm.dead = false;
          explosions.push(new Explosion(scene, v3(it.origin), 26));
          audio.whoosh();
        }
        mm.wasAlive = it.alive;

        if (!it.alive) {
          mm.group.visible = false;
          return;
        }
        mm.group.visible = true;
        mm.group.position.set(it.pos[0], it.pos[1], it.pos[2]);
        orient(mm.group, v3(it.vel), new THREE.Vector3(0, 1, 0));
        mm.trail.push(v3(it.pos));
        mm.smoke.emit(v3(it.pos), dt, 110);
        mm.smoke.update(dt);
        mm.group.traverse((o) => {
          if (o.userData.flame) o.scale.y = 1 + Math.random() * 0.5;
        });
      });
      const hunters = st.interceptors.filter((it) => it.active && it.alive);
      const nearest: Interceptor | null = hunters.length
        ? hunters.reduce((a, b) => (b.tele.R < a.tele.R ? b : a))
        : null;

      syncFlares(st);

      // engineer overlay LOS line
      los.visible = overlayRef.current && !!nearest;
      if (los.visible && nearest) {
        const arr = los.geometry.attributes.position as THREE.BufferAttribute;
        arr.array.set([pl.pos[0], pl.pos[1], pl.pos[2], nearest.tele.pos[0], nearest.tele.pos[1], nearest.tele.pos[2]]);
        arr.needsUpdate = true;
        los.computeLineDistances();
      }

      // explosions
      for (let i = explosions.length - 1; i >= 0; i--) {
        explosions[i].update(dt);
        if (explosions[i].done) {
          explosions[i].dispose(scene);
          explosions.splice(i, 1);
        }
      }

      // chase camera (smoothed) + shake
      const back = v3(pl.dir).multiplyScalar(-CAM_BACK);
      const desired = v3(pl.pos).add(back).add(new THREE.Vector3(0, CAM_UP, 0));
      camPos.lerp(desired, 1 - Math.pow(0.0016, dt));
      // don't let the chase camera sink into terrain / buildings
      const camFloor = scenery.heightAt(camPos.x, camPos.z) + 60;
      if (camPos.y < camFloor) camPos.y = camFloor;
      shake = Math.max(0, shake - dt * 2);
      const sh = shake * 18;
      camera.position.copy(camPos).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
      camera.lookAt(v3(pl.pos).add(v3(pl.dir).multiplyScalar(120)));

      // audio — only while the engagement is live; silenced the instant it ends
      if (st.status === "flying") {
        audio.setEngine(pl.energy);
        audio.setLockWarning(!!nearest && nearest.tele.locked && nearest.tele.R < 2500);
        if (nearest && nearest.tele.R < 700) shake = Math.max(shake, 0.4);
      }

      // HUD
      const n: Interceptor | null = nearest;
      setHud({
        t: st.t,
        speed: pl.speed,
        throttle: controls.sample().throttle,
        g: pl.gLoad,
        energy: pl.energy,
        score: st.score,
        flares: st.flaresLeft,
        locked: !!n && n.tele.locked,
        closest: st.closest,
        nearest: n
          ? { R: n.tele.R, Vc: n.tele.Vc, lambdaDot: n.tele.lambdaDot, tGo: n.tele.tGo, cmdG: n.tele.cmdG, achG: n.tele.achG, saturated: n.tele.saturated, seduced: n.tele.seduced }
          : null,
      });

      composer.render();

      // 2-D HUD canvases
      if (minimapRef.current) drawMinimap(minimapRef.current, st);
      if (overlayRef.current && pipRef.current) drawTacticalPiP(pipRef.current, st);

      if (st.status !== "flying" && !ended) {
        ended = true;
        audio.stop(); // kill the engine drone + lock beep the moment the game ends
        const win = st.status === "escaped";
        if (!win) {
          explosions.push(new Explosion(scene, v3(pl.pos)));
          audio.boom();
          shake = 1;
          player.visible = false;
        }
        const score = Math.round(st.score);
        const all = saveScore({ score, vehicle, theme, difficulty, t: st.t, win, date: Date.now() });
        const newBest = all.reduce((m, e) => Math.max(m, e.score), 0);
        const share = shareLink({ vehicle, theme, difficulty, seed: sim.seed });
        setScores(all);
        // let the explosion play, then show the card
        const title = st.status === "escaped" ? "YOU ESCAPED" : st.status === "crashed" ? "YOU CRASHED" : "INTERCEPTED";
        setTimeout(() => {
          setResult({ win, title, reason: st.reason, score, t: st.t, best: newBest, share });
          setPhase("result");
        }, win ? 300 : 1100);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    cleanupRef.current = () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      controls.detach();
      audio.stop();
      composer.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    };
    // expose controls for mobile buttons
    (mount as unknown as { _ctl?: ArenaControls })._ctl = controls;
  }, [vehicle, theme, difficulty]);

  const begin = () => {
    // honour a challenge-link seed; otherwise a fresh engagement each launch
    seedRef.current = chal.seed ?? Math.floor(Math.random() * 1_000_000);
    // mark the tutorial as seen for next time, but let it show over this first game
    if (typeof localStorage !== "undefined") localStorage.setItem("zeromiss_arena_tut", "1");
    setPhase("playing");
    // wait a tick for the canvas mount to render
    setTimeout(startGame, 30);
  };
  const quit = () => {
    cleanupRef.current();
    setPhase("menu");
    setHud(null);
  };
  const retry = () => {
    cleanupRef.current();
    setResult(null);
    setPhase("playing");
    setTimeout(startGame, 30);
  };

  useEffect(() => () => cleanupRef.current(), []);

  const ctl = () => (mountRef.current as unknown as { _ctl?: ArenaControls })?._ctl;
  const d = difficultyFor(difficulty);

  return (
    <div className="py-4">
      {phase === "menu" && (
        <Menu
          vehicle={vehicle} setVehicle={setVehicle}
          theme={theme} setTheme={setTheme}
          difficulty={difficulty} setDifficulty={setDifficulty}
          diffName={d.name} salvo={d.maxConcurrent} survive={d.surviveTime}
          onStart={begin} scores={scores} challenge={chal.seed !== undefined}
        />
      )}

      {phase !== "menu" && (
        <div className="relative">
          <div ref={mountRef} className="relative h-[78vh] w-full overflow-hidden rounded-xl border border-grid bg-bg" />

          {/* radar minimap (always) + tactical PiP (engineer overlay) */}
          <canvas ref={minimapRef} className="pointer-events-none absolute left-3 top-20 h-28 w-28" aria-hidden />
          {overlay && (
            <div className="pointer-events-none absolute right-3 top-28 w-52">
              <div className="mb-1 rounded-t-md border border-grid bg-bg/85 px-2 py-1 text-[10px] uppercase tracking-wider text-cyan">Tactical view (the real LOS plot)</div>
              <canvas ref={pipRef} className="h-32 w-full rounded-b-md border border-x-grid border-b-grid" aria-hidden />
            </div>
          )}

          {hud && phase === "playing" && (
            <GameHud hud={hud} overlay={overlay} onToggleOverlay={() => setOverlay((v) => !v)} onQuit={quit}
              onFlare={() => ctl()?.triggerFlare()} onBoostDown={() => ctl()?.setBoost(true)} onBoostUp={() => ctl()?.setBoost(false)}
              setThrottle={(v) => ctl()?.setThrottle(v)} surviveTime={d.surviveTime} />
          )}

          {tutorial && phase === "playing" && !result && (
            <TutorialOverlay onClose={() => setTutorial(false)} vehicle={vehicle} />
          )}

          {result && (
            <ResultCard result={result} onRetry={retry} onMenu={quit} />
          )}
        </div>
      )}
    </div>
  );
}

function TutorialOverlay({ onClose, vehicle }: { onClose: () => void; vehicle: VehicleKind }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/55 backdrop-blur-sm" onClick={onClose}>
      <div className="card max-w-sm p-5 text-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-cyan">How to survive</h3>
        <ul className="mt-2 space-y-1 text-muted">
          <li>🖱️ <strong>Move the mouse</strong> to steer the {vehicle} (or arrows / I-J-K-L).</li>
          <li>⚡ <strong>Shift</strong> = boost · <strong>W/S</strong> = throttle.</li>
          <li>✦ <strong>Space</strong> = drop a flare to seduce the seeker.</li>
          <li>🎯 The missile uses real proportional navigation — beat it by turning hard <em>late</em> (force it past its g-limit), breaking its lock, or flaring.</li>
          <li>📐 Hit <strong>Engineer overlay</strong> to watch the live line-of-sight rate it&apos;s nulling.</li>
        </ul>
        <button className="btn btn-primary mt-4 w-full" onClick={onClose}>Got it — fly!</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Menu
function Menu(props: {
  vehicle: VehicleKind; setVehicle: (v: VehicleKind) => void;
  theme: ArenaTheme; setTheme: (t: ArenaTheme) => void;
  difficulty: number; setDifficulty: (n: number) => void;
  diffName: string; salvo: number; survive: number; onStart: () => void;
  scores: ScoreEntry[]; challenge: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl py-6">
      <h1 className="text-3xl font-bold">Intercept Arena</h1>
      {props.challenge && (
        <div className="mt-2 inline-block rounded-md border border-cyan bg-cyan/10 px-3 py-1 text-sm text-cyan">
          ⚔ You&apos;ve been sent a challenge — same vehicle, arena, difficulty &amp; spawn. Beat their score.
        </div>
      )}
      <p className="mt-2 max-w-prose text-muted">
        You fly. A proportional-navigation interceptor hunts you with the <em>real</em>, validated
        guidance math. Survive {Math.round(props.survive)}s to escape — by out-turning it past its
        g-limit, breaking its seeker lock, or seducing it with a flare. Toggle the engineer overlay
        to watch the line-of-sight rate it&apos;s driving to zero.
      </p>

      <div className="mt-6 grid gap-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Vehicle</h3>
          <div className="flex gap-2">
            {(["jet", "drone"] as VehicleKind[]).map((v) => (
              <button key={v} onClick={() => props.setVehicle(v)}
                className={`rounded-md border px-4 py-2 text-sm transition ${props.vehicle === v ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"}`}>
                {v === "jet" ? "F-22 Raptor" : "DJI Tello"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Arena</h3>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => props.setTheme(t.id)}
                className={`rounded-md border px-3 py-2 text-sm transition ${props.theme === t.id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">
            Difficulty — <span className="text-ink">{props.diffName}</span>{" "}
            <span className="text-muted">(battery keeps {props.salvo} missile{props.salvo > 1 ? "s" : ""} airborne · survive {Math.round(props.survive)}s)</span>
          </h3>
          <input type="range" min={0} max={1} step={0.01} value={props.difficulty}
            onChange={(e) => props.setDifficulty(parseFloat(e.target.value))} className="w-full max-w-md"
            aria-label="Difficulty" />
          <div className="mt-1 flex max-w-md justify-between text-[10px] text-muted"><span>Rookie</span><span>Top Gun</span></div>
        </div>

        <button onClick={props.onStart} className="btn btn-primary w-fit text-base">▶ Launch engagement</button>

        <p className="text-xs text-muted">
          Controls — <strong>mouse</strong>: steer · <strong>W/S</strong>: throttle · <strong>Shift</strong>: boost ·
          <strong> Space</strong>: flare · <strong>arrows / I-J-K-L</strong>: steer · touch + gamepad supported.
        </p>

        {props.scores.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Your best runs</h3>
            <div className="overflow-hidden rounded-md border border-grid">
              <table className="w-full text-left text-xs">
                <thead className="bg-panel text-muted">
                  <tr><th className="px-3 py-1.5">#</th><th>Score</th><th>Result</th><th>Vehicle</th><th>Arena</th><th>Survived</th></tr>
                </thead>
                <tbody>
                  {props.scores.slice(0, 6).map((s, i) => (
                    <tr key={i} className="border-t border-grid">
                      <td className="px-3 py-1.5 tnum text-muted">{i + 1}</td>
                      <td className="tnum text-cyan">{s.score}</td>
                      <td style={{ color: s.win ? "#37e0e6" : "#ff5d5d" }}>{s.win ? "escaped" : "caught"}</td>
                      <td className="capitalize">{s.vehicle}</td>
                      <td className="capitalize">{s.theme}</td>
                      <td className="tnum">{s.t.toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- HUD
function GameHud(props: {
  hud: Hud; overlay: boolean; onToggleOverlay: () => void; onQuit: () => void;
  onFlare: () => void; onBoostDown: () => void; onBoostUp: () => void;
  setThrottle: (v: number) => void; surviveTime: number;
}) {
  const h = props.hud;
  const deg = (x: number) => (x * 180) / Math.PI;
  const survivePct = Math.min(100, (h.t / props.surviveTime) * 100);
  return (
    <>
      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="card pointer-events-auto flex items-center gap-4 px-3 py-2 text-sm">
          <span className="tnum">⏱ {(props.surviveTime - h.t > 0 ? props.surviveTime - h.t : 0).toFixed(1)}s</span>
          <span className="tnum text-cyan">score {Math.round(h.score)}</span>
          <span className="tnum">flares {h.flares}</span>
        </div>
        <div className="card pointer-events-auto flex items-center gap-2 px-2 py-1.5">
          <button onClick={props.onToggleOverlay}
            className={`rounded px-2 py-1 text-xs ${props.overlay ? "bg-cyan/10 text-cyan" : "text-muted"}`}>Engineer overlay</button>
          <button onClick={props.onQuit} className="rounded px-2 py-1 text-xs text-muted hover:text-ink">Quit</button>
        </div>
      </div>

      {/* survive progress */}
      <div className="pointer-events-none absolute inset-x-0 top-16 mx-auto h-1 w-1/2 overflow-hidden rounded bg-panel/70">
        <div className="h-full bg-cyan transition-all" style={{ width: `${survivePct}%` }} />
      </div>

      {/* lock warning */}
      {h.locked && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 animate-pulse2 rounded-md border border-danger bg-bg/70 px-4 py-1 text-sm font-bold text-danger">
          ◎ MISSILE LOCK {h.nearest ? `· ${h.nearest.R.toFixed(0)} m` : ""}
        </div>
      )}

      {/* bottom-left flight HUD */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-xs">
        <span className="tnum">SPD {h.speed.toFixed(0)} m/s</span>
        <span className="tnum" style={{ color: h.g > 18 ? "#ff5d5d" : undefined }}>g {h.g.toFixed(1)}</span>
        <span className="tnum">THR {(h.throttle * 100).toFixed(0)}%</span>
      </div>

      {/* engineer overlay panel */}
      {props.overlay && h.nearest && (
        <div className="pointer-events-none absolute bottom-3 right-3 w-64 rounded-md border border-grid bg-bg/85 p-3 text-xs">
          <div className="mb-1 font-semibold uppercase tracking-wider text-cyan">Nearest interceptor — live GN&amp;C</div>
          <Row k="Range R" v={`${h.nearest.R.toFixed(0)} m`} />
          <Row k="Closing Vc" v={`${h.nearest.Vc.toFixed(0)} m/s`} />
          <Row k="LOS rate λ̇" v={`${deg(h.nearest.lambdaDot).toFixed(2)} °/s`} accent={Math.abs(deg(h.nearest.lambdaDot)) < 0.3 ? "#ff5d5d" : "#37e0e6"} />
          <Row k="t-go" v={isFinite(h.nearest.tGo) ? `${h.nearest.tGo.toFixed(1)} s` : "—"} />
          <Row k="cmd g" v={h.nearest.cmdG.toFixed(0)} accent={h.nearest.saturated ? "#ff5d5d" : undefined} />
          <Row k="achieved g" v={h.nearest.achG.toFixed(0)} />
          <div className="mt-1 text-[10px] text-muted">
            {h.nearest.seduced ? "Seduced by your flare." : h.nearest.saturated ? "Airframe SATURATED — it can't pull this." : Math.abs(deg(h.nearest.lambdaDot)) < 0.3 ? "λ̇ → 0: constant bearing, you're being led." : "Make λ̇ grow — force it to turn harder."}
          </div>
        </div>
      )}

      {/* mobile buttons */}
      <div className="absolute bottom-20 right-3 flex items-end gap-3 sm:hidden">
        {/* true vertical throttle (reliable touch hit-box, max at top) */}
        <div className="flex flex-col items-center gap-1 rounded-md bg-bg/55 px-2 py-2">
          <input type="range" min={0} max={1} step={0.05} defaultValue={0.7}
            onChange={(e) => props.setThrottle(parseFloat(e.target.value))}
            style={{ writingMode: "vertical-lr", direction: "rtl", width: 26, height: 132 }}
            aria-label="throttle" />
          <span className="text-[10px] text-muted">THR</span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button className="btn h-14 w-14 rounded-full" onPointerDown={props.onBoostDown} onPointerUp={props.onBoostUp}>⏵⏵</button>
          <button className="btn h-14 w-14 rounded-full" onPointerDown={props.onFlare}>✦</button>
        </div>
      </div>
    </>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className="tnum" style={{ color: accent }}>{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Result
function ResultCard({ result, onRetry, onMenu }: { result: { win: boolean; title: string; reason: string; score: number; t: number; best: number; share: string }; onRetry: () => void; onMenu: () => void }) {
  const [copied, setCopied] = useState(false);
  const doShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "ZeroMiss — Intercept Arena", text: `I scored ${result.score} dodging a proportional-navigation missile. Beat me:`, url: result.share });
      else {
        await navigator.clipboard?.writeText(result.share);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled share */
    }
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg/55 backdrop-blur-sm">
      <div className="card max-w-md p-6 text-center">
        <div className="tnum text-3xl font-bold tracking-widest" style={{ color: result.win ? "#37e0e6" : "#ff5d5d" }}>
          {result.title}
        </div>
        <p className="mt-3 text-sm text-muted">{result.reason}</p>
        <div className="mt-4 flex justify-center gap-6 text-sm">
          <div><div className="text-[10px] uppercase text-muted">Score</div><div className="tnum text-lg text-cyan">{result.score}</div></div>
          <div><div className="text-[10px] uppercase text-muted">Time</div><div className="tnum text-lg">{result.t.toFixed(1)}s</div></div>
          <div><div className="text-[10px] uppercase text-muted">Best</div><div className="tnum text-lg">{result.best}</div></div>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button onClick={onRetry} className="btn btn-primary">↺ Fly again</button>
          <button onClick={doShare} className="btn">{copied ? "Link copied!" : "⚔ Challenge a friend"}</button>
          <button onClick={onMenu} className="btn">Menu</button>
        </div>
      </div>
    </div>
  );
}
