/**
 * Arena input — turns keyboard / mouse-steer / touch / gamepad into an ArenaInput each
 * frame. Mouse-steering (fly toward the cursor) is the default and the reason the craft
 * feels responsive instead of "barely moving."
 */

import type { ArenaInput } from "../sim/arena";

export class ArenaControls {
  private keys = new Set<string>();
  private el: HTMLElement | null = null;
  private mouseX = 0; // -1..1 relative to center
  private mouseY = 0;
  private mouseActive = false;
  private touchVec = { x: 0, y: 0 };
  private touching = false;
  private throttle = 0.7;
  private boostBtn = false;
  private flareBtn = false;
  private flareEdge = false;

  attach(el: HTMLElement): void {
    this.el = el;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    el.addEventListener("mousemove", this.onMouseMove);
    el.addEventListener("mouseleave", this.onMouseLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("touchstart", this.onTouch, { passive: false });
    el.addEventListener("touchmove", this.onTouch, { passive: false });
    el.addEventListener("touchend", this.onTouchEnd);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    const el = this.el;
    if (el) {
      el.removeEventListener("mousemove", this.onMouseMove);
      el.removeEventListener("mouseleave", this.onMouseLeave);
      el.removeEventListener("wheel", this.onWheel);
      el.removeEventListener("touchstart", this.onTouch);
      el.removeEventListener("touchmove", this.onTouch);
      el.removeEventListener("touchend", this.onTouchEnd);
    }
  }

  // external buttons (mobile UI) can poke these
  setBoost(v: boolean): void {
    this.boostBtn = v;
  }
  triggerFlare(): void {
    this.flareEdge = true;
  }
  setThrottle(v: number): void {
    this.throttle = Math.max(0, Math.min(1, v));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.key.toLowerCase());
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
    if (e.key === " ") this.flareEdge = true;
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private onMouseMove = (e: MouseEvent) => {
    const r = (this.el as HTMLElement).getBoundingClientRect();
    this.mouseX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2.2));
    this.mouseY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2.2));
    this.mouseActive = true;
  };
  private onMouseLeave = () => {
    this.mouseActive = false;
    this.mouseX = 0;
    this.mouseY = 0;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.throttle = Math.max(0, Math.min(1, this.throttle - Math.sign(e.deltaY) * 0.08));
  };

  private onTouch = (e: TouchEvent) => {
    e.preventDefault();
    const r = (this.el as HTMLElement).getBoundingClientRect();
    const t = e.touches[0];
    // left half of the screen acts as a steering pad
    const lx = (t.clientX - r.left) / r.width;
    if (lx < 0.6) {
      this.touchVec.x = Math.max(-1, Math.min(1, (lx / 0.6 - 0.5) * 2.4));
      this.touchVec.y = Math.max(-1, Math.min(1, ((t.clientY - r.top) / r.height - 0.5) * 2.4));
      this.touching = true;
    }
  };
  private onTouchEnd = () => {
    this.touching = false;
    this.touchVec = { x: 0, y: 0 };
  };

  private gamepad(): { yaw: number; pitch: number; throttle: number; boost: boolean; flare: boolean } | null {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return null;
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    return {
      yaw: dz(gp.axes[0] ?? 0),
      pitch: dz(gp.axes[1] ?? 0),
      throttle: (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0),
      boost: !!gp.buttons[7]?.pressed,
      flare: !!gp.buttons[0]?.pressed,
    };
  }

  sample(): ArenaInput {
    const k = this.keys;
    let yaw = 0, pitch = 0, roll = 0;

    // keyboard arrows (and IJKL) as an alternative to the mouse
    if (k.has("arrowleft") || k.has("j")) yaw -= 1;
    if (k.has("arrowright") || k.has("l")) yaw += 1;
    if (k.has("arrowup") || k.has("i")) pitch += 1;
    if (k.has("arrowdown") || k.has("k")) pitch -= 1;
    if (k.has("a")) roll -= 1;
    if (k.has("d")) roll += 1;

    // mouse steering dominates when the pointer is over the canvas
    if (this.mouseActive && yaw === 0 && pitch === 0) {
      yaw = this.mouseX;
      pitch = -this.mouseY;
    }
    if (this.touching) {
      yaw = this.touchVec.x;
      pitch = -this.touchVec.y;
    }

    // throttle: W/S adjust, persist
    if (k.has("w")) this.throttle = Math.min(1, this.throttle + 0.02);
    if (k.has("s")) this.throttle = Math.max(0, this.throttle - 0.02);

    const gp = this.gamepad();
    if (gp) {
      if (gp.yaw) yaw = gp.yaw;
      if (gp.pitch) pitch = -gp.pitch;
      if (gp.throttle) this.throttle = Math.max(0, Math.min(1, this.throttle + gp.throttle * 0.03));
    }

    const boost = this.boostBtn || k.has("shift") || !!gp?.boost;
    const flare = this.flareEdge || this.flareBtn || !!gp?.flare;
    this.flareEdge = false; // consume edge

    return {
      yaw: Math.max(-1, Math.min(1, yaw)),
      pitch: Math.max(-1, Math.min(1, pitch)),
      roll,
      throttle: this.throttle,
      boost,
      flare: flare as unknown as boolean,
    };
  }
}
