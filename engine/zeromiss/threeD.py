"""True 3-D engagement.

This is an *additive* module — the validated planar core is untouched. Here the
interceptor and target are full 3-D point masses, guided by **3-D proportional
navigation**:

    Omega   = (R_vec x V_rel) / (R_vec . R_vec)      # LOS angular-velocity vector
    a_cmd   = N * (Omega x v_M)                       # accel, automatically perp to v_M

Because ``Omega x v_M`` is perpendicular to ``v_M``, the command turns the velocity
without changing its magnitude — speed is conserved by construction, exactly like the
planar model. Targets can maneuver out of plane (climbing/weaving/barrel), so the
engagement is genuinely three-dimensional, not a planar path drawn in 3-D.

All vectors are plain length-3 tuples so the TypeScript twin reproduces the arithmetic
order byte-for-byte (same cross-validation discipline as the 2-D engine).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

G0 = 9.80665
Vec3 = tuple[float, float, float]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def clamp_mag(a: Vec3, max_mag: float) -> Vec3:
    m = norm(a)
    if m > max_mag and m > 1e-12:
        return scale(a, max_mag / m)
    return a


@dataclass
class Maneuver3D:
    """Target lateral-acceleration profile in 3-D (always applied perpendicular to v_T)."""

    kind: str = "constant_velocity"
    amplitude_g: float = 0.0
    period_s: float = 2.0
    start_s: float = 1.0

    def command(self, t: float, v_T: Vec3) -> Vec3:
        if self.kind in ("constant_velocity", "cv") or t < self.start_s:
            return (0.0, 0.0, 0.0)
        amp = self.amplitude_g * G0
        # Build two unit vectors perpendicular to v_T (the maneuver plane / axes).
        vhat = _unit(v_T)
        up = (0.0, 0.0, 1.0)
        e1 = _unit(cross(vhat, up))
        if norm(e1) < 1e-6:
            e1 = _unit(cross(vhat, (0.0, 1.0, 0.0)))
        e2 = _unit(cross(vhat, e1))
        w = 2.0 * math.pi / max(self.period_s, 1e-6)
        ph = w * (t - self.start_s)
        if self.kind == "weave3d":          # sinusoid in the e2 (out-of-plane) axis
            return scale(e2, amp * math.sin(ph))
        if self.kind == "barrel":           # rotating accel => helical evasion
            return add(scale(e1, amp * math.cos(ph)), scale(e2, amp * math.sin(ph)))
        if self.kind == "climb_turn":       # steady out-of-plane + lateral break
            return add(scale(e1, amp * 0.7), scale(e2, amp * 0.7))
        return (0.0, 0.0, 0.0)


def _unit(a: Vec3) -> Vec3:
    m = norm(a)
    return scale(a, 1.0 / m) if m > 1e-12 else (0.0, 0.0, 0.0)


@dataclass
class Result3D:
    verdict: str
    miss_distance: float
    peak_g: float
    t_flight: float
    seed: int
    law: str
    N: float
    lethal_radius: float
    frames: list[dict] = field(default_factory=list)

    @property
    def hit(self) -> bool:
        return self.verdict == "HIT"

    def summary(self) -> str:
        return (f"{self.verdict}  miss={self.miss_distance:.2f} m  peak_g={self.peak_g:.1f}  "
                f"t={self.t_flight:.3f} s  3D-PN N={self.N:g}")


@dataclass
class Engagement3D:
    """A 3-D point-mass intercept under 3-D proportional navigation."""

    missile_pos: Vec3 = (0.0, 0.0, 0.0)
    missile_vel: Vec3 = (1000.0, 0.0, 0.0)
    target_pos: Vec3 = (8000.0, 500.0, 600.0)
    target_vel: Vec3 = (-300.0, 0.0, 0.0)
    N: float = 4.0
    a_max_g: float = 40.0
    target_a_max_g: float = 12.0
    maneuver: Maneuver3D = field(default_factory=Maneuver3D)
    lethal_radius_m: float = 5.0
    t_max_s: float = 15.0
    dt: float = 0.001
    seed: int = 0

    def run(self) -> Result3D:
        rM, vM = self.missile_pos, self.missile_vel
        rT, vT = self.target_pos, self.target_vel
        a_max = self.a_max_g * G0
        t_a_max = self.target_a_max_g * G0
        dt = self.dt
        n = int(round(self.t_max_s / dt))
        peak_g = 0.0
        min_R = math.inf
        min_R_t = 0.0
        R_hist: list[float] = []
        t_hist: list[float] = []
        frames: list[dict] = []
        closest = False
        t = 0.0
        frame_every = max(1, n // 400)

        for step in range(n + 1):
            R_vec = sub(rT, rM)
            V_rel = sub(vT, vM)
            R = norm(R_vec)
            R2 = max(R * R, 1e-9)
            omega = scale(cross(R_vec, V_rel), 1.0 / R2)
            # 3-D proportional navigation: a = N * (Omega x v_M), inherently perp to v_M
            a_cmd = scale(cross(omega, vM), self.N)
            a_ach = clamp_mag(a_cmd, a_max)
            g_ach = norm(a_ach) / G0
            peak_g = max(peak_g, g_ach)

            a_T = clamp_mag(self.maneuver.command(t, vT), t_a_max)

            if step % frame_every == 0 or step == n:
                frames.append({
                    "t": t,
                    "m": [rM[0], rM[1], rM[2]],
                    "tg": [rT[0], rT[1], rT[2]],
                    "R": R, "g": g_ach,
                })

            if R < min_R:
                min_R = R
                min_R_t = t
            R_hist.append(R)
            t_hist.append(t)
            if len(R_hist) >= 3 and not closest:
                R0, R1, R2v = R_hist[-3], R_hist[-2], R_hist[-1]
                if R1 <= R0 and R2v > R1:
                    min_R, min_R_t = _parabolic_min(t_hist[-3], t_hist[-2], R0, R1, R2v, dt)
                    closest = True
                    break

            rM, vM, rT, vT = _rk4(rM, vM, rT, vT, a_ach, a_T, dt)
            t += dt

        verdict = "HIT" if min_R <= self.lethal_radius_m else "MISS"
        return Result3D(
            verdict=verdict, miss_distance=min_R, peak_g=peak_g, t_flight=min_R_t,
            seed=self.seed, law="pn3d", N=self.N, lethal_radius=self.lethal_radius_m,
            frames=frames,
        )


def _deriv(rM, vM, rT, vT, aM, aT):
    return vM, aM, vT, aT


def _rk4(rM, vM, rT, vT, aM, aT, dt):
    # velocities turn under (constant) accel; positions advance — classic RK4 in 3-D
    k1 = _deriv(rM, vM, rT, vT, aM, aT)
    rM2 = add(rM, scale(k1[0], dt / 2))
    vM2 = add(vM, scale(k1[1], dt / 2))
    rT2 = add(rT, scale(k1[2], dt / 2))
    vT2 = add(vT, scale(k1[3], dt / 2))
    k2 = _deriv(rM2, vM2, rT2, vT2, aM, aT)
    rM3 = add(rM, scale(k2[0], dt / 2))
    vM3 = add(vM, scale(k2[1], dt / 2))
    rT3 = add(rT, scale(k2[2], dt / 2))
    vT3 = add(vT, scale(k2[3], dt / 2))
    k3 = _deriv(rM3, vM3, rT3, vT3, aM, aT)
    rM4 = add(rM, scale(k3[0], dt))
    vM4 = add(vM, scale(k3[1], dt))
    rT4 = add(rT, scale(k3[2], dt))
    vT4 = add(vT, scale(k3[3], dt))
    k4 = _deriv(rM4, vM4, rT4, vT4, aM, aT)

    def comb(a, b, c, d):
        return add(add(a, scale(b, 2)), add(scale(c, 2), d))

    rM = add(rM, scale(comb(k1[0], k2[0], k3[0], k4[0]), dt / 6))
    vM = add(vM, scale(comb(k1[1], k2[1], k3[1], k4[1]), dt / 6))
    rT = add(rT, scale(comb(k1[2], k2[2], k3[2], k4[2]), dt / 6))
    vT = add(vT, scale(comb(k1[3], k2[3], k3[3], k4[3]), dt / 6))
    return rM, vM, rT, vT


def _parabolic_min(t0, t1, R0, R1, R2, dt):
    denom = R0 - 2.0 * R1 + R2
    if abs(denom) < 1e-12:
        return R1, t1
    x = max(-1.0, min(1.0, 0.5 * (R0 - R2) / denom))
    a = 0.5 * denom
    b = 0.5 * (R2 - R0)
    return max(R1 + b * x + a * x * x, 0.0), t1 + x * dt
