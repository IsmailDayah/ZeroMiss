"""Validation against known results.

Each check ships three ways: a machine-checkable assertion (here +
``tests/``), a figure (``notebooks/`` via these data functions), and a plain-English
docs paragraph. ``zeromiss validate`` runs :func:`run_all` and prints a pass/fail table.

The cases:
  (a) zero miss on a non-maneuvering target for N>=3   — PN's defining property
  (b) heading-error washout                            — initial aim error contributes 0
  (c) the Zarchan step-maneuver miss curve             — the headline; shape + N-ordering
  (d) APN cancels a step TPN cannot                    — miss_APN < 0.1 * miss_TPN
  (e) RK4 order of accuracy                            — quarter dt -> ~256x less error
  (f) step-convergence audit                           — halving dt barely moves the miss
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .engagement import Engagement
from .scenario import Scenario

G0 = 9.80665


@dataclass
class Case:
    name: str
    category: str
    passed: bool
    detail: str
    value: float = float("nan")
    tol: float = float("nan")


@dataclass
class CurvePoint:
    t_over_tau: float
    norm_miss: float


# --------------------------------------------------------------------------- helpers
def _scenario(**over) -> Scenario:
    """Build a clean (ideal-seeker) engagement scenario programmatically."""
    base: dict = {
        "name": over.pop("name", "validation"),
        "seed": over.pop("seed", 0),
        "missile": {
            "speed": 1000.0,
            "position": [0.0, 0.0],
            "heading": over.pop("missile_heading", 0.0),
            "guidance": {"law": over.pop("law", "tpn"), "N": over.pop("N", 4.0)},
            "airframe": over.pop("airframe", {"ideal": True}),
            "seeker": {"ideal": True},
        },
        "target": {
            "speed": over.pop("target_speed", 300.0),
            "position": over.pop("target_position", [8000.0, 0.0]),
            "heading": over.pop("target_heading", 180.0),
            "a_max_g": over.pop("target_a_max_g", 100.0),
            "maneuver": over.pop("maneuver", {"type": "constant_velocity"}),
        },
        "termination": {
            "lethal_radius_m": over.pop("lethal_radius_m", 5.0),
            "t_max_s": over.pop("t_max_s", 30.0),
        },
        "dynamics": {"dt": over.pop("dt", 0.001)},
    }
    assert not over, f"unused kwargs: {over}"
    return Scenario.from_dict(base)


# --------------------------------------------------------------------------- (a)
def case_zero_miss() -> Case:
    """(a) Non-maneuvering target, no lag, N>=3 -> miss ~ 0 across a grid."""
    worst = 0.0
    detail_bits = []
    for N in (3.0, 4.0, 5.0):
        for off in (-1500.0, 0.0, 1500.0):
            sc = _scenario(N=N, target_position=[8000.0, off], target_heading=180.0)
            r = Engagement(sc).run()
            worst = max(worst, r.miss_distance)
        detail_bits.append(f"N={N:g}:{worst:.2f}m")
    tol = 0.5
    return Case(
        "Zero miss (CV target, N>=3)", "closed-form", worst < tol,
        f"worst miss {worst:.3f} m over N×offset grid (tol {tol} m)", worst, tol,
    )


# --------------------------------------------------------------------------- (b)
def case_heading_error_washout() -> Case:
    """(b) Initial heading error washes out for N>2; miss stays ~0 and g decays."""
    worst = 0.0
    g_decays = True
    for HE in (-45.0, -20.0, 20.0, 45.0):
        sc = _scenario(N=4.0, missile_heading=HE, target_position=[8000.0, 0.0])
        r = Engagement(sc).run()
        worst = max(worst, r.miss_distance)
        # commanded g should trend down over the back half of flight
        g = [abs(v) for v in r.telemetry.column("g_ach")]
        if len(g) > 20:
            mid = g[len(g) // 2]
            late = g[int(len(g) * 0.85)]
            if late > mid + 1.0:
                g_decays = False
    tol = 0.5
    passed = worst < tol and g_decays
    return Case(
        "Heading-error washout", "closed-form", passed,
        f"worst miss {worst:.3f} m (tol {tol}); latax decays={g_decays}", worst, tol,
    )


# --------------------------------------------------------------------------- (c)
# t_F/tau abscissa, kept in the linear (small-perturbation) regime the textbook
# adjoint analysis assumes. A larger maneuver would curve the target tens of degrees
# over a long flight and leave that regime, distorting the high-t_F tail.
_ZARCHAN_TOT = (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0)


def zarchan_step_curve(N: float, tau: float = 1.0, n_T_g: float = 1.0) -> list[CurvePoint]:
    """The dimensionless step-maneuver miss curve for a single-lag system.

    Sweeps normalized flight time ``t_F/tau`` by varying initial range, with the target
    stepping at launch through a single first-order autopilot lag ``tau``. Returns
    ``miss / (n_T * tau^2)`` vs ``t_F/tau``. The maneuver is kept small so the engagement
    stays in the linear regime the published curve is derived in; the family then shows
    the textbook behaviour: rises to a worst-case peak, higher ``N`` lowers the peak, and
    the settled miss scales with ``tau^2`` (halve the lag, quarter the miss).
    """
    Vc = 1000.0 + 300.0  # head-on closing speed (constant: target turns, doesn't speed up)
    n_T = n_T_g * G0
    pts: list[CurvePoint] = []
    for tot in _ZARCHAN_TOT:
        t_F = tot * tau
        R0 = Vc * t_F
        sc = _scenario(
            N=N,
            target_position=[R0, 0.0],
            target_heading=180.0,
            airframe={"ideal": False, "a_max_g": 5000.0, "autopilot_tau": tau, "order": 1},
            maneuver={"type": "step", "amplitude_g": n_T_g, "start_s": 0.0},
            target_a_max_g=5000.0,
            t_max_s=t_F + 5.0,
            dt=0.0005,
            lethal_radius_m=0.0,
        )
        r = Engagement(sc).run()
        pts.append(CurvePoint(tot, r.miss_distance / (n_T * tau * tau)))
    return pts


def zarchan_linear_curve(N: float, tau: float = 1.0, n_T: float = 1.0) -> list[CurvePoint]:
    """The linearized single-lag homing-loop reference (Zarchan adjoint formulation).

    An *independent* derivation of the same family: the terminal-homing loop linearized
    about the collision triangle, with a single first-order autopilot lag::

        ZEM   = y + ydot * t_go
        a_cmd = N' * ZEM / t_go^2           (PN, effective navigation ratio N' = N)
        ydotdot = n_T - a_M                  (relative lateral kinematics, step n_T)
        a_M_dot = (a_cmd - a_M) / tau        (first-order autopilot)

    Integrated to a small terminal time-to-go cutoff, the residual ``|y|`` is the miss.
    This is a third reference (alongside the nonlinear sim and the published curve) and
    pins the worst-case abscissa: its N=3 peak lands at ``t_F/tau ~ 2.5``.
    """
    pts: list[CurvePoint] = []
    for tot in _ZARCHAN_TOT:
        t_F = tot * tau
        steps = 8000
        dt = t_F / steps
        y = v = a_M = 0.0
        t = 0.0
        miss = 0.0
        cutoff = 0.02 * tau
        while t_F - t > cutoff:
            t_go = t_F - t
            a_cmd = N * (y + v * t_go) / (t_go * t_go)
            ydd = n_T - a_M
            a_md = (a_cmd - a_M) / tau
            y += v * dt
            v += ydd * dt
            a_M += a_md * dt
            t += dt
            miss = abs(y)
        pts.append(CurvePoint(tot, miss / (n_T * tau * tau)))
    return pts


def case_zarchan_linear_agreement() -> Case:
    """(c2) The nonlinear sim agrees with the linearized closed-form reference.

    Cross-checks the simulated Zarchan curve against the independent linear homing-loop
    model: both must show the same N-ordering, a worst-case peak in the textbook band,
    and a peak abscissa for N=3 that agrees between the two models.
    """
    lin = {N: zarchan_linear_curve(N) for N in (3.0, 4.0, 5.0)}
    sim = zarchan_step_curve(3.0)
    lin_peaks = {N: max(p.norm_miss for p in c) for N, c in lin.items()}
    ordering = lin_peaks[3.0] > lin_peaks[4.0] > lin_peaks[5.0]
    c3 = lin[3.0]
    lin_peak_tot = max(c3, key=lambda p: p.norm_miss).t_over_tau
    sim_peak_tot = max(sim, key=lambda p: p.norm_miss).t_over_tau
    in_band = 1.5 <= lin_peak_tot <= 4.0
    abscissa_agree = abs(lin_peak_tot - sim_peak_tot) <= 1.5
    passed = ordering and in_band and abscissa_agree
    return Case(
        "Zarchan: nonlinear vs linear closed-form", "headline", passed,
        f"linear peak@t/τ={lin_peak_tot:g} (band {in_band}), sim peak@t/τ={sim_peak_tot:g}, "
        f"|Δ|<=1.5={abscissa_agree}, ordering={ordering}",
    )


def case_zarchan_curve() -> Case:
    """(c) The headline: reproduce the Zarchan curve's shape and N-ordering."""
    curves = {N: zarchan_step_curve(N) for N in (3.0, 4.0, 5.0)}
    peaks = {N: max(p.norm_miss for p in c) for N, c in curves.items()}
    # Property 1: higher N lowers the peak miss (more maneuver-tolerant).
    ordering = peaks[3.0] > peaks[4.0] > peaks[5.0]
    # Property 2: the N=3 curve rises to a worst-case peak (not at the smallest t_F/tau).
    c3 = curves[3.0]
    peak_idx = max(range(len(c3)), key=lambda i: c3[i].norm_miss)
    rises = 0 < peak_idx < len(c3) - 1
    peak_tot = c3[peak_idx].t_over_tau
    # Property 3: monotone decay after the peak (the linear-regime curve does not rise again).
    tail = [p.norm_miss for p in c3[peak_idx:]]
    monotone = all(tail[i + 1] <= tail[i] + 1e-3 for i in range(len(tail) - 1))
    # Property 4: settles well below the peak (halving lag quarters miss => small tail).
    settles = c3[-1].norm_miss < 0.3 * peaks[3.0]
    passed = ordering and rises and monotone and settles
    return Case(
        "Zarchan step-maneuver curve", "headline", passed,
        f"peaks N3/N4/N5 = {peaks[3.0]:.3f}/{peaks[4.0]:.3f}/{peaks[5.0]:.3f}; "
        f"peak@t/τ={peak_tot:g}; ordering={ordering} rises={rises} monotone={monotone} settles={settles}",
    )


# --------------------------------------------------------------------------- (d)
def case_apn_beats_tpn() -> Case:
    """(d) APN cancels the lag-induced step miss that TPN cannot.

    Set at the Zarchan worst-case of the step-maneuver curve (t_F/tau ~ 2 with a large
    autopilot lag), where the first-order autopilot leaves TPN several metres short. APN
    feeds the constant target maneuver forward and drives the miss back to ~0.
    """
    tau = 1.0
    t_F = 2.0 * tau
    Vc = 1300.0  # head-on closing speed
    common = dict(
        target_position=[Vc * t_F, 0.0], target_heading=180.0,
        airframe={"ideal": False, "a_max_g": 5000.0, "autopilot_tau": tau, "order": 1},
        target_a_max_g=5000.0,
        maneuver={"type": "step", "amplitude_g": 3.0, "start_s": 0.0},
        t_max_s=t_F + 5.0, lethal_radius_m=0.0, dt=0.0005,
    )
    r_tpn = Engagement(_scenario(law="tpn", N=3.0, **common)).run()
    r_apn = Engagement(_scenario(law="apn", N=3.0, **common)).run()
    ratio = r_apn.miss_distance / max(r_tpn.miss_distance, 1e-9)
    tol = 0.1
    passed = ratio < tol
    return Case(
        "APN cancels a step TPN cannot", "closed-form", passed,
        f"miss TPN={r_tpn.miss_distance:.2f} m, APN={r_apn.miss_distance:.3f} m, "
        f"ratio={ratio:.3f} (tol {tol})", ratio, tol,
    )


# --------------------------------------------------------------------------- (e)
def case_rk4_order() -> Case:
    """(e) RK4 global error ~ O(dt^4): quartering dt cuts closest-approach error ~256x."""
    from .dynamics import eom
    from .integrator import integrate

    # A pure turning missile (constant lateral accel) traces a known circular arc.
    # Parameters chosen so the global error is well above the float64 roundoff floor
    # at the coarse step (so the 4th-order ratio is observable, not noise-limited).
    V, a = 200.0, 200.0
    R_circle = V * V / a
    omega = a / V
    T = 10.0  # several revolutions
    state0 = (0.0, 0.0, V, 0.0, 1e9, 1e9, 1.0, 0.0)  # target far away, irrelevant

    def err_at(dt: float) -> float:
        n = int(round(T / dt))
        traj = integrate(state0, lambda s, _t: eom(s, a, 0.0), dt, n)
        xM, yM = traj[-1][0], traj[-1][1]
        # exact arc position after time T
        th = omega * T
        ex = R_circle * math.sin(th)
        ey = R_circle * (1.0 - math.cos(th))
        return math.hypot(xM - ex, yM - ey)

    e1 = err_at(0.05)
    e2 = err_at(0.0125)  # quartered
    ratio = e1 / max(e2, 1e-18)
    # Expect ~256; allow a generous band (numerical floor can intrude when error tiny).
    passed = ratio > 100.0
    return Case(
        "RK4 order of accuracy", "numerical", passed,
        f"error ratio on /4 step = {ratio:.0f} (expect ~256, need >100)", ratio, 256.0,
    )


# --------------------------------------------------------------------------- (f)
def case_step_convergence() -> Case:
    """(f) Step-convergence audit: halving dt barely moves the miss.

    Uses a smooth, well-conditioned intercept (constant-velocity offset target, ideal
    airframe) so the audit measures *integration* convergence rather than the discrete
    guidance-update sensitivity that a hard-maneuvering terminal geometry would inject.
    """
    sc_kwargs = dict(
        law="tpn", N=4.0, target_position=[8000.0, 500.0], target_heading=180.0,
        airframe={"ideal": True},
        maneuver={"type": "constant_velocity"},
        t_max_s=15.0, lethal_radius_m=0.0,
    )
    r1 = Engagement(_scenario(dt=0.002, **sc_kwargs)).run()
    r2 = Engagement(_scenario(dt=0.001, **sc_kwargs)).run()
    d = abs(r1.miss_distance - r2.miss_distance)
    tol = 0.1
    return Case(
        "Step-convergence audit", "numerical", d < tol,
        f"|miss(dt) - miss(dt/2)| = {d:.4f} m (tol {tol} m)", d, tol,
    )


# --------------------------------------------------------------------------- driver
ALL_CASES = (
    case_zero_miss,
    case_heading_error_washout,
    case_zarchan_curve,
    case_zarchan_linear_agreement,
    case_apn_beats_tpn,
    case_rk4_order,
    case_step_convergence,
)


def run_all() -> list[Case]:
    return [fn() for fn in ALL_CASES]


@dataclass
class Report:
    cases: list[Case] = field(default_factory=list)

    @property
    def all_passed(self) -> bool:
        return all(c.passed for c in self.cases)


def report() -> Report:
    return Report(run_all())
