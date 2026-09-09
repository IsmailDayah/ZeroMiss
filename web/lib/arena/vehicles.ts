/**
 * Procedural 3-D vehicle models for the Arena (Three.js). Built from primitives so the
 * bundle ships zero external assets (no licensing, ITAR-clean, small) — but shaped to
 * read as the real things: a DJI Tello micro-drone, an F-22 Raptor, and a Patriot
 * (PAC-3) air-defence battery. Each returns a THREE.Group oriented +X-forward, +Y-up to
 * match the sim's velocity frame (the battery is static and faces +X = toward the target).
 */

import * as THREE from "three";

const CYAN = 0x37e0e6;
const AMBER = 0xffb454;

function mat(color: number, opts: { emissive?: number; metal?: number; rough?: number; flat?: boolean } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissive ? 0.6 : 0,
    metalness: opts.metal ?? 0.5,
    roughness: opts.rough ?? 0.5,
    flatShading: opts.flat ?? false, // smooth by default; opt-in facets for the stealth jet
  });
}

/** DJI Tello — wide, flat white micro-drone with a front camera and four prop motors. */
export function buildTello(accent = CYAN): THREE.Group {
  const g = new THREE.Group();
  const shell = mat(0xeef0f3, { metal: 0.15, rough: 0.55 }); // glossy white plastic
  const grey = mat(0xb9bec6, { metal: 0.2, rough: 0.6 });
  const dark = mat(0x23272e, { metal: 0.4, rough: 0.5 });
  const glass = mat(0x0a0c11, { metal: 0.9, rough: 0.08 });

  // main body — wide & flat (the real Tello is 98×93×41 mm)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 1.7), shell);
  g.add(body);
  // chamfered lower belly (lighter grey) for a two-tone moulded look
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 1.5), grey);
  belly.position.y = -0.26;
  g.add(belly);
  // top vent grille
  const vent = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.9), dark);
  vent.position.y = 0.24;
  g.add(vent);
  for (let i = -2; i <= 2; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.05), shell);
    slot.position.set(0, 0.27, i * 0.18);
    g.add(slot);
  }

  // signature forward camera module + lens
  const camHousing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.62), dark);
  camHousing.position.set(0.92, -0.06, 0);
  g.add(camHousing);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.16, 18), glass);
  lens.rotation.z = Math.PI / 2;
  lens.position.set(1.12, -0.06, 0);
  g.add(lens);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 8, 18), grey);
  lensRing.rotation.y = Math.PI / 2;
  lensRing.position.set(1.16, -0.06, 0);
  g.add(lensRing);
  // downward vision-positioning sensor on the belly
  const vps = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14), glass);
  vps.rotation.x = Math.PI / 2;
  vps.position.set(-0.1, -0.38, 0);
  g.add(vps);
  // rear status LED
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), mat(accent, { emissive: accent }));
  led.position.set(-0.92, 0.05, 0);
  g.add(led);

  // four motor arms + motors + prop guards + translucent spinning props
  const motorMat = dark;
  const propMat = new THREE.MeshStandardMaterial({ color: 0xced3da, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const corners: [number, number][] = [[1.0, 1.0], [1.0, -1.0], [-1.0, 1.0], [-1.0, -1.0]];
  for (const [x, z] of corners) {
    // tapered arm reaching out to the motor pod
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), shell);
    arm.position.set(x * 0.72, -0.02, z * 0.72);
    arm.rotation.y = Math.atan2(z, x);
    g.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.26, 14), motorMat);
    motor.position.set(x, 0.12, z);
    g.add(motor);
    // prop-guard ring (the Tello's recognisable feature)
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 22), grey);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(x, 0.28, z);
    g.add(guard);
    const propGeo = new THREE.CircleGeometry(0.58, 18);
    propGeo.rotateX(-Math.PI / 2); // bake flat so the spin axis is local +Y
    const prop = new THREE.Mesh(propGeo, propMat);
    prop.position.set(x, 0.3, z);
    prop.userData.spin = true;
    g.add(prop);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, 0.12), shell);
    blade.position.set(x, 0.3, z);
    blade.userData.spin = true;
    g.add(blade);
  }
  g.scale.setScalar(2.4);
  return g;
}

/** F-22 Raptor — faceted gunmetal stealth fighter: diamond wings, twin canted tails. */
export function buildF22(accent = CYAN): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(0x5b6470, { metal: 0.55, rough: 0.45, flat: true });
  const skinDark = mat(0x434b56, { metal: 0.55, rough: 0.45, flat: true });

  // faceted fuselage from stacked tapered boxes
  const mid = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 1.6), skin);
  g.add(mid);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.5, 1.2), skinDark);
  lower.position.y = -0.45;
  g.add(lower);
  // chiseled nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3.2, 4), skin);
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.x = Math.PI / 4;
  nose.position.set(3.9, 0, 0);
  nose.scale.set(1, 0.6, 1);
  g.add(nose);
  // canopy (tinted bubble)
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshStandardMaterial({ color: 0x1b2738, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.85 }));
  canopy.scale.set(2.0, 0.7, 0.9);
  canopy.position.set(1.7, 0.45, 0);
  g.add(canopy);

  // diamond (trapezoidal) wings — built from a flat extrude-ish shape via scaled boxes
  const wingShape = new THREE.Shape();
  wingShape.moveTo(1.6, 0);
  wingShape.lineTo(-1.4, 0);
  wingShape.lineTo(-2.6, 4.4);
  wingShape.lineTo(-1.0, 4.4);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.12, bevelEnabled: false });
  wingGeo.rotateX(-Math.PI / 2);
  const wingR = new THREE.Mesh(wingGeo, skinDark);
  wingR.position.set(-0.2, -0.1, 0);
  g.add(wingR);
  const wingL = wingR.clone();
  wingL.scale.z = -1;
  g.add(wingL);

  // twin canted vertical stabilizers
  for (const s of [1, -1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 0.1), skinDark);
    tail.position.set(-2.2, 0.7, s * 0.7);
    tail.rotation.x = s * 0.32; // canted outward
    g.add(tail);
    // horizontal stabilizer
    const ht = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.6), skinDark);
    ht.position.set(-2.4, 0, s * 1.0);
    g.add(ht);
  }

  // twin engine nozzles + afterburner glow
  for (const s of [1, -1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.7, 12), skinDark);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-2.7, -0.1, s * 0.45);
    g.add(nozzle);
    const burn = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.8, 12), new THREE.MeshBasicMaterial({ color: 0xff7a33, transparent: true, opacity: 0.85 }));
    burn.rotation.z = Math.PI / 2;
    burn.position.set(-3.7, -0.1, s * 0.45);
    burn.userData.burner = true;
    g.add(burn);
  }
  // intake accents
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 1.7), mat(accent, { emissive: accent }));
  stripe.position.set(2.4, 0.1, 0);
  g.add(stripe);

  g.scale.setScalar(2.4);
  return g;
}

export function buildPlayer(kind: "drone" | "jet", accent = CYAN): THREE.Group {
  return kind === "drone" ? buildTello(accent) : buildF22(accent);
}

/** A homing interceptor missile. */
export function buildMissile(color = AMBER): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5.2, 16), mat(0xe7edf5, { metal: 0.8, rough: 0.3 }));
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 16), mat(color, { emissive: color }));
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(3.3, 0, 0);
  g.add(nose);
  const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x0b0d12, { metal: 0.9, rough: 0.1 }));
  seeker.rotation.z = -Math.PI / 2;
  seeker.position.set(3.9, 0, 0);
  g.add(seeker);
  const finMat = mat(0x8896a8, { metal: 0.7, rough: 0.4 });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.85), finMat);
    fin.position.set(-2.0, 0, 0);
    fin.rotation.x = (i * Math.PI) / 2;
    fin.position.y = Math.cos((i * Math.PI) / 2) * 0.45;
    fin.position.z = Math.sin((i * Math.PI) / 2) * 0.45;
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.85 }));
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-3.5, 0, 0);
  flame.userData.flame = true;
  g.add(flame);
  g.scale.setScalar(3.0);
  return g;
}

/** A bright burning flare/decoy sprite. */
export function buildFlare(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.95 }),
  );
}

/**
 * Patriot (PAC-3) launching station — an M983 tractor + M901 trailer carrying the
 * elevated 4-canister launcher. Static; faces +X (toward the target the sim aims at).
 */
export function buildPatriotBattery(): THREE.Group {
  const g = new THREE.Group();
  const drab = mat(0x55563c, { metal: 0.35, rough: 0.8 }); // olive drab
  const darker = mat(0x282a1d, { metal: 0.3, rough: 0.85 });
  const rubber = mat(0x131414, { metal: 0.1, rough: 0.95 });
  const tube = mat(0x5f6044, { metal: 0.4, rough: 0.7 });

  // --- trailer chassis ---
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(13, 1.0, 4.2), drab);
  chassis.position.y = 1.6;
  g.add(chassis);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 3.6), darker);
  deck.position.y = 2.15;
  g.add(deck);
  // bogies: three axles per side
  for (const sz of [-1, 1]) {
    for (const wx of [-4.4, -1.6, 4.0]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.7, 18), rubber);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.95, sz * 2.25);
      g.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.74, 10), drab);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(wx, 0.95, sz * 2.25);
      g.add(hub);
    }
  }
  // outrigger jacks (deployed for firing)
  for (const sx of [-5.2, 5.2]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 8), darker);
    leg.position.set(sx, 0.9, sz * 2.6);
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12), darker);
    foot.position.set(sx, 0.1, sz * 2.6);
    g.add(foot);
  }

  // --- elevating launcher assembly (pivots at the rear of the deck) ---
  const beam = new THREE.Group();
  beam.position.set(-3.6, 2.3, 0);
  // structural backing frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4.6, 4.2), darker);
  frame.position.set(-0.4, 2.2, 0);
  beam.add(frame);
  // 4 launch canisters in a 2×2 pack
  const canL = 8.2;
  for (const cy of [-1.1, 1.1]) for (const cz of [-1.1, 1.1]) {
    const can = new THREE.Mesh(new THREE.BoxGeometry(canL, 1.95, 1.95), tube);
    can.position.set(canL / 2 - 0.2, 2.2 + cy, cz);
    beam.add(can);
    // ribbing
    for (const rx of [-2.5, 0, 2.5]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.05, 2.05), darker);
      rib.position.set(canL / 2 - 0.2 + rx, 2.2 + cy, cz);
      beam.add(rib);
    }
    // muzzle cover (lighter)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.95, 1.95), drab);
    cap.position.set(canL - 0.3, 2.2 + cy, cz);
    beam.add(cap);
  }
  beam.rotation.z = THREE.MathUtils.degToRad(40); // elevate the pack
  g.add(beam);

  return g;
}

/** AN/MPQ-65 phased-array radar — an octagonal panel tilted back on its own trailer. */
export function buildRadar(): THREE.Group {
  const g = new THREE.Group();
  const drab = mat(0x55563c, { metal: 0.35, rough: 0.8 });
  const darker = mat(0x282a1d, { metal: 0.3, rough: 0.85 });
  const rubber = mat(0x131414, { metal: 0.1, rough: 0.95 });
  const array = new THREE.MeshStandardMaterial({ color: 0x223240, metalness: 0.6, roughness: 0.35, emissive: 0x0c1a2a, emissiveIntensity: 0.5 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(8, 1.0, 4), drab);
  chassis.position.y = 1.6;
  g.add(chassis);
  for (const sz of [-1, 1]) for (const wx of [-2.6, 2.6]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.7, 16), rubber);
    w.rotation.x = Math.PI / 2;
    w.position.set(wx, 0.95, sz * 2.1);
    g.add(w);
  }
  // octagonal phased-array panel, tilted back
  const panel = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 8), array);
  panel.rotation.x = Math.PI / 2; // face forward
  panel.position.set(0, 4.4, -0.3);
  panel.rotation.x = THREE.MathUtils.degToRad(72); // tilt back ~18°
  g.add(panel);
  const backFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 5.0, 0.6), darker);
  backFrame.position.set(0, 3.2, -1.4);
  backFrame.rotation.x = THREE.MathUtils.degToRad(18);
  g.add(backFrame);
  return g;
}

/** Orient a group so its local +X axis points along `dir` (with `up` as up). */
export function orient(obj: THREE.Object3D, dir: THREE.Vector3, up: THREE.Vector3): void {
  const f = dir.clone().normalize();
  const u = up.clone().normalize();
  const r = new THREE.Vector3().crossVectors(u, f).normalize();
  const u2 = new THREE.Vector3().crossVectors(f, r).normalize();
  const m = new THREE.Matrix4().makeBasis(f, u2, r);
  obj.quaternion.setFromRotationMatrix(m);
}
