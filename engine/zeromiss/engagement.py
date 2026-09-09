"""The engagement orchestrator — the one place state lives.

This wires geometry -> seeker -> guidance -> airframe -> integrator into the lifecycle
state machine and computes the exact miss distance at the interpolated closest-approach
instant (never at a coarse step boundary).

    ARMED --launch--> MIDCOURSE --lock--> TERMINAL --R_dot flips--> INTERCEPT? -> HIT/MISS
                          |
                     loss-of-lock --> COAST

Determinism rule (non-negotiable): *all* randomness comes from the
single ``numpy.random.Generator(seed)`` threaded through :meth:`run`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from .airframe import Airframe
from .dynamics import eom
from .frames import Geometry, Kinematic, perpendicular_component, relative_state
from .guidance.base import GuidanceParams, get_law
from .integrator import rk4_step
from .scenario import Scenario
from .seeker import Seeker
from .targets import build_maneuver
from .telemetry import Sample, Telemetry
from .tracker import Tracker

G0 = 9.80665

# Lifecycle phases.
ARMED = "ARMED"
MIDCOURSE = "MIDCOURSE"
TERMINAL = "TERMINAL"
COAST = "COAST"

# Terminal phase begins inside this range fraction / time-to-go threshold.
_TERMINAL_TGO = 1.0  # seconds-to-go


@dataclass(slots=True)
class Result:
    """Everything the UI and reports need."""

    verdict: str           # "HIT" | "MISS"
    miss_distance: float   # metres, at interpolated closest approach
    peak_g: float          # peak *achieved* g (what the airframe actually pulled)
    peak_g_commanded: float  # peak *commanded* g (can spike at the terminal singularity)
    t_flight: float        # time of closest approach [s]
    seed: int
    law: str
    N: float
    closing_velocity: float  # V_c at closest approach [m/s]
    scenario_name: str
    lethal_radius: float
    telemetry: Telemetry
    lock_lost: bool = False
    timed_out: bool = False

    @property
    def hit(self) -> bool:
        return self.verdict == "HIT"

    def summary(self) -> str:
        return (
            f"{self.verdict}  miss={self.miss_distance:.2f} m  "
            f"peak_g={self.peak_g:.1f}  t={self.t_flight:.3f} s  "
            f"law={self.law} N={self.N:g}  seed={self.seed}"
        )

    # convenience pass-throughs to telemetry exporters
    def to_csv(self, path: str | Path):
        return self.telemetry.to_csv(path)

    def to_json(self, path: str | Path):
        return self.telemetry.to_json(path)

    def to_gif(self, path: str | Path, **kw):
        from .render import animate

        return animate(self, path, **kw)


class Engagement:
    """Construct from a Scenario, then :meth:`run` for a deterministic Result."""

    def __init__(self, scenario: Scenario) -> None:
        self.scenario = scenario

    @classmethod
    def from_yaml(cls, path: str | Path) -> Engagement:
        return cls(Scenario.from_yaml(path))

    @classmethod
    def from_scenario(cls, scenario: Scenario) -> Engagement:
        return cls(scenario)

    def run(self, seed: int | None = None) -> Result:
        sc = self.scenario
        seed = seed if seed is not None else (sc.seed if sc.seed is not None else 0)
        rng = np.random.default_rng(seed)

        # --- assemble the actors from the scenario ---
        missile0 = sc.missile.kinematic()
        target0 = sc.target.kinematic()
        params: GuidanceParams = sc.missile.guidance.to_params()
        law = get_law(sc.missile.guidance.law)
        airframe = Airframe(sc.missile.airframe.to_config())
        seeker = Seeker(sc.missile.seeker.to_config())
        tracker_cfg = sc.missile.tracker.to_config()
        tracker = Tracker(tracker_cfg) if tracker_cfg.enabled else None
        dyn = sc.dynamics.to_config()
        maneuver = build_maneuver(
            sc.target.maneuver.to_dict(), rng=rng, t_max=sc.termination.t_max_s
        )
        target_a_max = sc.target.a_max_g * G0
        cm = sc.target.countermeasure
        decoy: list[float] | None = None  # [x, y, vx, vy] once deployed

        dt = sc.dynamics.dt
        t_max = sc.termination.t_max_s
        Rk = sc.termination.lethal_radius_m
        n_max = int(round(t_max / dt))

        # --- flat state vector ---
        state = (
            missile0.x, missile0.y, missile0.speed, missile0.heading,
            target0.x, target0.y, target0.speed, target0.heading,
        )

        telem = Telemetry()
        peak_g = 0.0
        peak_g_ach = 0.0
        lock_lost = False
        phase = MIDCOURSE

        # closest-approach tracking (parabolic interpolation)
        hist_t: list[float] = []
        hist_R: list[float] = []
        hist_vc: list[float] = []
        min_R = math.inf
        min_R_t = 0.0
        min_R_vc = 0.0
        closest_found = False
        t = 0.0

        for _ in range(n_max + 1):
            xM, yM, VM, gM, xT, yT, VT, gT = state
            missile = Kinematic(xM, yM, VM, gM)
            target = Kinematic(xT, yT, VT, gT)

            # target maneuver (commanded, clamped to its g-limit)
            a_t = maneuver.command(t)
            a_t = max(-target_a_max, min(target_a_max, a_t))

            # geometry (true), resolving target accel perpendicular to LOS
            lam_tmp = math.atan2(yT - yM, xT - xM)
            a_t_perp = perpendicular_component(a_t, gT, lam_tmp)
            g_true = relative_state(missile, target, a_t_perp_los=a_t_perp)

            # countermeasure: while a deployed decoy is seducing the seeker, the seeker
            # tracks the DECOY, not the target — but the miss is still scored vs the target
            seduced = False
            if cm.enabled and t >= cm.deploy_s:
                if decoy is None:
                    decoy = [xT, yT, target.vx, target.vy]  # released at the target's state
                seduced = t < cm.deploy_s + cm.duration_s
            if seduced and decoy is not None:
                sp = math.hypot(decoy[2], decoy[3])
                decoy_kin = Kinematic(decoy[0], decoy[1], sp if sp > 1e-6 else 1e-6,
                                      math.atan2(decoy[3], decoy[2]))
                g_seeker = relative_state(missile, decoy_kin, a_t_perp_los=0.0)
            else:
                g_seeker = g_true

            if tracker is not None:
                # tracker-in-the-loop: estimate the target from noisy radar, guide on it
                est_target = tracker.step(missile, target, dt, rng)
                g_est = relative_state(missile, est_target, a_t_perp_los=0.0)
                g_meas = g_est
                lambda_dot_meas = g_est.lambda_dot
                locked = True
                in_fov = True
            else:
                # seeker measurement (adds lag/noise/FOV/loss-of-lock); tracks g_seeker
                sk = seeker.measure(g_seeker, dt, rng)
                if not sk.locked:
                    lock_lost = True
                g_meas = _with_measured_rate(g_seeker, sk.lambda_dot)
                lambda_dot_meas = sk.lambda_dot
                locked = sk.locked
                in_fov = sk.in_fov

            # guidance command (coast if lock is lost)
            a_cmd = 0.0 if not locked else law(g_meas, params)

            # airframe response (lag + g-limit)
            a_ach = airframe.respond(a_cmd, dt)

            # phase bookkeeping
            if not locked:
                phase = COAST
            elif math.isfinite(g_true.t_go) and g_true.t_go <= _TERMINAL_TGO:
                phase = TERMINAL
            else:
                phase = MIDCOURSE

            g_cmd = a_cmd / G0
            g_ach = a_ach / G0
            peak_g = max(peak_g, abs(g_cmd))
            peak_g_ach = max(peak_g_ach, abs(g_ach))

            telem.add(Sample(
                t=t, x_m=xM, y_m=yM, v_m=VM, gamma_m=gM,
                x_t=xT, y_t=yT, v_t=VT, gamma_t=gT,
                R=g_true.R, lam=g_true.lam, lambda_dot=g_true.lambda_dot,
                lambda_dot_meas=lambda_dot_meas, V_c=g_true.V_c, t_go=g_true.t_go,
                zem_perp=g_true.zem_perp, a_cmd=a_cmd, a_ach=a_ach, a_t=a_t,
                g_cmd=g_cmd, g_ach=g_ach, saturated=airframe.state.saturated,
                locked=locked, in_fov=in_fov, phase=phase,
            ))

            # --- closest-approach detection (R starts increasing after closing) ---
            hist_t.append(t)
            hist_R.append(g_true.R)
            hist_vc.append(g_true.V_c)
            if g_true.R < min_R:
                min_R = g_true.R
                min_R_t = t
                min_R_vc = g_true.V_c
            if len(hist_R) >= 3 and not closest_found:
                R0, R1, R2 = hist_R[-3], hist_R[-2], hist_R[-1]
                if R1 <= R0 and R2 > R1:  # local minimum at the middle sample
                    t_star, R_star = _parabolic_min(
                        hist_t[-3], hist_t[-2], hist_t[-1], R0, R1, R2
                    )
                    min_R = R_star
                    min_R_t = t_star
                    # terminal closing speed just before the min (still closing)
                    min_R_vc = hist_vc[-3]
                    closest_found = True
                    break

            # --- integrate one fixed RK4 step (zero-order hold on a_ach, a_t) ---
            state = rk4_step(
                state, lambda s, _t, _am=a_ach, _at=a_t: eom(s, _am, _at, dyn), dt, t
            )
            # propagate the decoy (decelerating, ballistic) if one is out
            if decoy is not None:
                decay = max(0.0, 1.0 - cm.decel_per_s * dt)
                decoy[2] *= decay
                decoy[3] *= decay
                decoy[0] += decoy[2] * dt
                decoy[1] += decoy[3] * dt
            t += dt

        timed_out = not closest_found
        verdict = "HIT" if min_R <= Rk else "MISS"

        return Result(
            verdict=verdict,
            miss_distance=min_R,
            peak_g=peak_g_ach,
            peak_g_commanded=peak_g,
            t_flight=min_R_t,
            seed=int(seed),
            law=sc.missile.guidance.law,
            N=params.N,
            closing_velocity=min_R_vc,
            scenario_name=sc.name,
            lethal_radius=Rk,
            telemetry=telem,
            lock_lost=lock_lost,
            timed_out=timed_out,
        )


def _with_measured_rate(g: Geometry, lambda_dot_meas: float) -> Geometry:
    """Substitute the seeker's measured LOS rate and recompute the ZEM accordingly."""
    if math.isinf(g.t_go):
        zem = g.zem_perp
    else:
        zem = g.R * lambda_dot_meas * g.t_go + 0.5 * g.a_t_perp * g.t_go * g.t_go
    return replace(g, lambda_dot=lambda_dot_meas, zem_perp=zem)


def _parabolic_min(
    t0: float, t1: float, t2: float, R0: float, R1: float, R2: float
) -> tuple[float, float]:
    """Vertex of the parabola through three equally-spaced range samples.

    Returns ``(t_min, R_min)``. Falls back to the middle sample if degenerate.
    """
    denom = R0 - 2.0 * R1 + R2
    if abs(denom) < 1e-12:
        return t1, R1
    # offset of the vertex from the middle sample, in units of the step
    x = 0.5 * (R0 - R2) / denom
    x = max(-1.0, min(1.0, x))
    dt = t1 - t0
    t_min = t1 + x * dt
    # parabola value at the vertex (in local coords with middle at 0)
    a = 0.5 * denom
    b = 0.5 * (R2 - R0)
    R_min = R1 + b * x + a * x * x
    return t_min, max(R_min, 0.0)
