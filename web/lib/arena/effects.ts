/**
 * Arena visual FX (Three.js): exhaust smoke puffs, an intercept explosion with flash +
 * expanding shockwave ring + debris, and a small reusable particle helper. Kept GPU-light
 * (points/sprites, capped counts) so it runs on a laptop or phone.
 */

import * as THREE from "three";

// A soft radial-alpha disc so point sprites read as round puffs, not square pixels.
let _discTex: THREE.Texture | null = null;
function softDisc(): THREE.Texture {
  if (_discTex) return _discTex;
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _discTex = new THREE.CanvasTexture(c);
  return _discTex;
}

export interface SmokeOpts {
  /** sprite base size on the material [world units] */
  size?: number;
  /** starting puff size */
  sizeBase?: number;
  /** growth per second of age */
  grow?: number;
  /** puff lifetime [s] */
  life?: number;
  opacity?: number;
  /** random spawn jitter radius [m] */
  spread?: number;
}

export class SmokeTrail {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private ages: Float32Array;
  private sizes: Float32Array;
  private head = 0;
  private readonly max: number;
  private spawnAcc = 0;
  private readonly o: Required<SmokeOpts>;

  constructor(scene: THREE.Scene, color = 0xbfc8d6, max = 220, opts?: SmokeOpts) {
    this.max = max;
    this.o = { size: 18, sizeBase: 8, grow: 22, life: 2.2, opacity: 0.28, spread: 6, ...opts };
    this.positions = new Float32Array(max * 3);
    this.ages = new Float32Array(max).fill(999);
    this.sizes = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.PointsMaterial({ color, size: this.o.size, map: softDisc(), sizeAttenuation: true, transparent: true, opacity: this.o.opacity, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(pos: THREE.Vector3, dt: number, rate = 60): void {
    this.spawnAcc += dt * rate;
    const s = this.o.spread;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const i = this.head;
      this.positions[i * 3] = pos.x + (Math.random() - 0.5) * s;
      this.positions[i * 3 + 1] = pos.y + (Math.random() - 0.5) * s;
      this.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * s;
      this.ages[i] = 0;
      this.head = (this.head + 1) % this.max;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.ages[i] < this.o.life) {
        this.ages[i] += dt;
        this.sizes[i] = this.o.sizeBase + this.ages[i] * this.o.grow;
      } else {
        this.sizes[i] = 0;
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class Explosion {
  private flash: THREE.Mesh;
  private ring: THREE.Mesh;
  private debris: THREE.Points;
  private dvel: Float32Array;
  private t = 0;
  readonly group = new THREE.Group();
  done = false;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, n = 90) {
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 1, depthWrite: false }),
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(40, 60, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    const dpos = new Float32Array(n * 3);
    this.dvel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(140 + Math.random() * 260);
      this.dvel[i * 3] = dir.x;
      this.dvel[i * 3 + 1] = dir.y;
      this.dvel[i * 3 + 2] = dir.z;
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
    this.debris = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: 0xffb454, size: 14, map: softDisc(), transparent: true, opacity: 1, depthWrite: false }));
    this.debris.frustumCulled = false;
    this.group.position.copy(pos);
    this.group.add(this.flash, this.ring, this.debris);
    scene.add(this.group);
  }

  update(dt: number): void {
    this.t += dt;
    const a = Math.max(0, 1 - this.t / 1.2);
    this.flash.scale.setScalar(1 + this.t * 6);
    (this.flash.material as THREE.MeshBasicMaterial).opacity = a * a;
    this.ring.scale.setScalar(1 + this.t * 22);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = a * 0.9;
    const dp = this.debris.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) {
      dp.setX(i, dp.getX(i) + this.dvel[i * 3] * dt);
      dp.setY(i, dp.getY(i) + (this.dvel[i * 3 + 1] - 200 * this.t) * dt);
      dp.setZ(i, dp.getZ(i) + this.dvel[i * 3 + 2] * dt);
    }
    dp.needsUpdate = true;
    (this.debris.material as THREE.PointsMaterial).opacity = a;
    if (this.t > 1.3) this.done = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
  }
}

/** A fading poly-line trail for a moving object (missile/player path ribbon). */
export class PathTrail {
  readonly line: THREE.Line;
  private buf: Float32Array;
  private n = 0;
  private readonly max: number;

  constructor(scene: THREE.Scene, color: number, max = 260) {
    this.max = max;
    this.buf = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.buf, 3));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  /** Clear the trail (e.g. when a battery slot relaunches a fresh round). */
  reset(): void {
    this.n = 0;
    this.line.geometry.setDrawRange(0, 0);
  }

  push(p: THREE.Vector3): void {
    if (this.n >= this.max) {
      this.buf.copyWithin(0, 3);
      this.n = this.max - 1;
    }
    this.buf[this.n * 3] = p.x;
    this.buf[this.n * 3 + 1] = p.y;
    this.buf[this.n * 3 + 2] = p.z;
    this.n++;
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.n);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
