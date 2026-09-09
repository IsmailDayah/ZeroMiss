"""Monte-Carlo campaigns & probability-of-kill.

A single engagement is an anecdote; a thousand is engineering. This module randomises
initial conditions from declared distributions and runs whole campaigns to produce the
trade-off figures: **P_k vs N**, the **evasion frontier** (P_k vs target g), miss
histograms, and sensitivity surfaces.

Speed: the inner loop is **NumPy-vectorised over the batch dimension** — every sample
advances simultaneously — so 10k-100k engagements run in seconds without a backend. The
vectorised step mirrors the scalar :mod:`engagement` engine's equations exactly; a unit
test cross-checks the two agree (independent re-implementation = verification).

Supported in the fast path: laws ``pursuit/ppn/tpn/apn/ogl``; targets
``constant_velocity/step/weave/bang_bang``; first-order autopilot lag + g-limit; ideal
or lag+noise+FOV seeker. (Jink/scripted/live and 2nd-order airframe fall outside the
fast path — use the scalar engine for those.)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .scenario import DistSpec, Scenario

G0 = 9.80665


@dataclass
class Campaign:
    """Outcome arrays for one randomised campaign + the headline statistics."""

    miss: np.ndarray        # closest-approach distance per run [m]
    hit: np.ndarray         # bool: miss <= lethal radius
    peak_g: np.ndarray      # peak achieved g per run
    t_flight: np.ndarray    # time of closest approach per run [s]
    lethal_radius: float
    runs: int
    label: str = ""

    @property
    def Pk(self) -> float:
        return float(self.hit.mean())

    @property
    def cep(self) -> float:
        """Circular Error Probable — the median miss distance."""
        return float(np.median(self.miss))

    @property
    def mean_miss(self) -> float:
        return float(self.miss.mean())

    def summary(self) -> str:
        return (
            f"runs={self.runs}  P_k={self.Pk:.3f}  CEP={self.cep:.2f} m  "
            f"mean_miss={self.mean_miss:.2f} m  peak_g(med)={np.median(self.peak_g):.1f}"
        )


# --------------------------------------------------------------------------- overrides
def _bearing(p_from, p_to) -> float:
    return math.atan2(p_to[1] - p_from[1], p_to[0] - p_from[0])


def _sample_arrays(
    scenario: Scenario, randomize: dict[str, DistSpec], n: int, rng
) -> dict[str, np.ndarray]:
    """Draw n samples for every randomised key; defaults pulled from the scenario."""
    sc = scenario
    mpos = sc.missile.position
    tpos = sc.target.position
    R0_nom = math.hypot(tpos[0] - mpos[0], tpos[1] - mpos[1])
    bearing = _bearing(mpos, tpos)
    man = sc.target.maneuver.to_dict()

    def draw(spec: DistSpec) -> np.ndarray:
        return np.array([spec.sample(rng) for _ in range(n)], dtype=float)

    out: dict[str, np.ndarray] = {}
    # nominal (constant) defaults
    out["R0"] = np.full(n, R0_nom)
    out["HE_deg"] = np.zeros(n)
    out["N"] = np.full(n, sc.missile.guidance.N)
    out["amp_g"] = np.full(n, float(man.get("amplitude_g", 0.0)))
    out["start_s"] = np.full(n, float(man.get("start_s", 1.0)))
    out["period_s"] = np.full(n, float(man.get("period_s", 2.0)))
    out["noise_mrad"] = np.full(n, sc.missile.seeker.noise_mrad)
    out["tau_a"] = np.full(n, sc.missile.airframe.autopilot_tau)
    out["bearing"] = np.full(n, bearing)

    alias = {
        "R0": "R0", "HE_deg": "HE_deg", "N": "N", "guidance.N": "N",
        "amplitude_g": "amp_g", "target_g": "amp_g",
        "start_s": "start_s", "period_s": "period_s",
        "seeker.noise_mrad": "noise_mrad", "noise_mrad": "noise_mrad",
        "airframe.autopilot_tau": "tau_a", "autopilot_tau": "tau_a",
    }
    for key, spec in randomize.items():
        k = key.split(".")[-1] if key not in alias else key
        target = alias.get(key, alias.get(k, None))
        if target is None:
            # maneuver-prefixed keys like "weave.start_s"
            target = alias.get(k)
        if target is None:
            raise KeyError(f"randomize key {key!r} is not supported by the fast MC path")
        out[target] = draw(spec)
    return out


# --------------------------------------------------------------------------- fast core
def _simulate_batch(
    scenario: Scenario,
    arr: dict[str, np.ndarray],
    seeds: np.ndarray,
    dt: float,
) -> Campaign:
    sc = scenario
    n = len(arr["R0"])
    law = sc.missile.guidance.law.lower()
    man_type = sc.target.maneuver.to_dict().get("type", "constant_velocity").lower()

    VM = float(sc.missile.speed)
    VT = float(sc.target.speed)
    a_max = sc.missile.airframe.a_max_g * G0
    ideal_air = sc.missile.airframe.ideal
    t_max = sc.termination.t_max_s
    Rk = sc.termination.lethal_radius_m
    target_a_max = sc.target.a_max_g * G0
    use_tgt_accel = sc.missile.guidance.use_target_accel

    seeker_ideal = sc.missile.seeker.ideal
    sk_tau = sc.missile.seeker.tau
    sk_fov = math.radians(sc.missile.seeker.fov_deg)
    update_every = max(1, int(round((1.0 / sc.missile.seeker.update_hz) / dt))) if sc.missile.seeker.update_hz > 0 else 1
    Ts = update_every * dt

    # initial states (vectorised)
    bearing = arr["bearing"]
    R0 = arr["R0"]
    xM = np.zeros(n) + sc.missile.position[0]
    yM = np.zeros(n) + sc.missile.position[1]
    xT = xM + R0 * np.cos(bearing)
    yT = yM + R0 * np.sin(bearing)
    gM = np.radians(sc.missile.heading + arr["HE_deg"])
    gT = np.full(n, math.radians(sc.target.heading))
    a_ach = np.zeros(n)
    held_ld = np.zeros(n)
    lock_lost_for = np.zeros(n)
    locked = np.ones(n, dtype=bool)
    rng_noise = [np.random.default_rng(int(s)) for s in seeds] if not seeker_ideal and arr["noise_mrad"].any() else None

    N = arr["N"]
    amp = arr["amp_g"] * G0
    start = arr["start_s"]
    period = arr["period_s"]
    tau_a = arr["tau_a"]

    min_R = np.full(n, np.inf)
    R_hist2 = np.full(n, np.inf)  # R two steps ago
    R_hist1 = np.full(n, np.inf)  # R one step ago
    miss = np.full(n, np.inf)
    t_at_min = np.zeros(n)
    peak_g = np.zeros(n)
    finalized = np.zeros(n, dtype=bool)

    n_steps = int(round(t_max / dt))
    t = 0.0
    for step in range(n_steps + 1):
        active = ~finalized
        # geometry
        dx = xT - xM
        dy = yT - yM
        R = np.hypot(dx, dy)
        lam = np.arctan2(dy, dx)
        vMx = VM * np.cos(gM)
        vMy = VM * np.sin(gM)
        vTx = VT * np.cos(gT)
        vTy = VT * np.sin(gT)
        dvx = vTx - vMx
        dvy = vTy - vMy
        R2 = np.maximum(R * R, 1e-9)
        ld = (dx * dvy - dy * dvx) / R2
        Rdot = (dx * dvx + dy * dvy) / np.maximum(R, 1e-9)
        Vc = -Rdot
        with np.errstate(divide="ignore", invalid="ignore"):
            t_go = np.where(Vc > 1e-6, R / np.maximum(Vc, 1e-9), 1e9)
        t_go = np.clip(t_go, 1e-3, 1e9)

        # target maneuver (vectorised)
        if man_type in ("constant_velocity", "cv", "none"):
            a_t = np.zeros(n)
        elif man_type == "step":
            a_t = np.where(t >= start, amp, 0.0)
        elif man_type == "weave":
            w = 2.0 * np.pi / np.maximum(period, 1e-6)
            a_t = np.where(t >= start, amp * np.sin(w * (t - start)), 0.0)
        elif man_type == "bang_bang":
            phase = np.mod(np.maximum(t - start, 0.0), period) / np.maximum(period, 1e-6)
            a_t = np.where(t >= start, np.where(phase < 0.5, amp, -amp), 0.0)
        else:
            raise ValueError(f"fast MC does not support maneuver {man_type!r}")
        a_t = np.clip(a_t, -target_a_max, target_a_max)
        a_t_perp = a_t * np.cos(gT - lam)

        # seeker
        if seeker_ideal:
            ld_meas = ld
        else:
            in_fov = np.abs(_wrap(lam - gM)) <= sk_fov
            lock_lost_for = np.where(in_fov, 0.0, lock_lost_for + dt)
            locked = lock_lost_for <= sc.missile.seeker.loss_of_lock_timeout_s
            if step % update_every == 0:
                meas = ld.copy()
                if rng_noise is not None:
                    sigma = arr["noise_mrad"] * 1e-3
                    noise = np.array([g.normal(0.0, s) for g, s in zip(rng_noise, sigma, strict=False)])
                    meas = meas + noise / Ts
                alpha = 1.0 - math.exp(-Ts / sk_tau) if sk_tau > 0 else 1.0
                held_ld = held_ld + alpha * (meas - held_ld)
            ld_meas = np.where(locked, held_ld, 0.0)

        # guidance command (vectorised)
        zem = R * ld_meas * t_go + (0.5 * a_t_perp * t_go * t_go if use_tgt_accel else 0.0)
        if law == "tpn":
            a_cmd = N * Vc * ld_meas
        elif law == "ppn":
            a_cmd = N * VM * ld_meas
        elif law == "apn":
            a_cmd = N * Vc * ld_meas + (0.5 * N * a_t_perp if use_tgt_accel else 0.0)
        elif law in ("ogl", "zem"):
            a_cmd = N * zem / (t_go * t_go)
        elif law == "pursuit":
            a_cmd = N * VM * _wrap(lam - gM)
        else:
            raise ValueError(f"fast MC does not support law {law!r}")
        if not seeker_ideal:
            a_cmd = np.where(locked, a_cmd, 0.0)

        # airframe
        if ideal_air:
            a_ach = a_cmd
        else:
            a_cmd_cl = np.clip(a_cmd, -a_max, a_max)
            alpha_a = 1.0 - np.exp(-dt / np.maximum(tau_a, 1e-9))
            a_ach = a_ach + alpha_a * (a_cmd_cl - a_ach)

        peak_g = np.where(active, np.maximum(peak_g, np.abs(a_ach) / G0), peak_g)

        # closest-approach detection with parabolic refine (per active batch)
        newmin = R < min_R
        min_R = np.where(active & newmin, R, min_R)
        detect = active & (R_hist1 <= R_hist2) & (R > R_hist1) & np.isfinite(R_hist2)
        if detect.any():
            R0p, R1p, R2p = R_hist2[detect], R_hist1[detect], R[detect]
            denom = R0p - 2.0 * R1p + R2p
            x = np.where(np.abs(denom) < 1e-12, 0.0, 0.5 * (R0p - R2p) / denom)
            x = np.clip(x, -1.0, 1.0)
            a_par = 0.5 * denom
            b_par = 0.5 * (R2p - R0p)
            Rmin = np.maximum(R1p + b_par * x + a_par * x * x, 0.0)
            miss[detect] = Rmin
            t_at_min[detect] = (t - dt) + x * dt
            finalized[detect] = True
        R_hist2 = R_hist1
        R_hist1 = R

        # integrate (RK4) — vectorised, zero-order hold on a_ach & a_t
        st = (xM, yM, gM, xT, yT, gT)
        st = _rk4_vec(st, VM, VT, a_ach, a_t, dt)
        xM, yM, gM, xT, yT, gT = st
        t += dt
        if finalized.all():
            break

    # any never-finalized runs: use running min
    miss = np.where(np.isfinite(miss), miss, min_R)
    hit = miss <= Rk
    return Campaign(
        miss=miss, hit=hit, peak_g=peak_g, t_flight=t_at_min,
        lethal_radius=Rk, runs=n, label=sc.name,
    )


def _wrap(a):
    return (a + np.pi) % (2.0 * np.pi) - np.pi


def _deriv_vec(st, VM, VT, a_m, a_t):
    xM, yM, gM, xT, yT, gT = st
    return (
        VM * np.cos(gM), VM * np.sin(gM), a_m / VM,
        VT * np.cos(gT), VT * np.sin(gT), a_t / VT,
    )


def _rk4_vec(st, VM, VT, a_m, a_t, dt):
    k1 = _deriv_vec(st, VM, VT, a_m, a_t)
    s2 = tuple(st[i] + 0.5 * dt * k1[i] for i in range(6))
    k2 = _deriv_vec(s2, VM, VT, a_m, a_t)
    s3 = tuple(st[i] + 0.5 * dt * k2[i] for i in range(6))
    k3 = _deriv_vec(s3, VM, VT, a_m, a_t)
    s4 = tuple(st[i] + dt * k3[i] for i in range(6))
    k4 = _deriv_vec(s4, VM, VT, a_m, a_t)
    return tuple(
        st[i] + (dt / 6.0) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(6)
    )


# --------------------------------------------------------------------------- public API
def run_campaign(
    scenario: Scenario,
    runs: int | None = None,
    seed: int = 0,
    randomize: dict[str, DistSpec] | None = None,
    dt: float | None = None,
    label: str = "",
) -> Campaign:
    """Run one randomised campaign and return its outcome statistics."""
    if randomize is None:
        randomize = scenario.montecarlo.randomize if scenario.montecarlo else {}
    if runs is None:
        runs = scenario.montecarlo.runs if scenario.montecarlo else 10000
    if dt is None:
        dt = max(scenario.dynamics.dt, 0.002)  # a coarser MC step keeps 100k runs fast
    rng = np.random.default_rng(seed)
    arr = _sample_arrays(scenario, randomize, runs, rng)
    seeds = rng.integers(0, 2**31 - 1, size=runs)
    camp = _simulate_batch(scenario, arr, seeds, dt)
    camp.label = label or scenario.name
    return camp


def sweep_pk(
    scenario: Scenario,
    key: str,
    values,
    runs: int = 5000,
    seed: int = 0,
    randomize: dict[str, DistSpec] | None = None,
) -> list[tuple[float, Campaign]]:
    """Sweep one scenario knob and return (value, Campaign) — e.g. P_k vs N."""
    out = []
    base = scenario.model_dump()
    for i, v in enumerate(values):
        d = _set_dotted(dict_deepcopy(base), key, v)
        sc = Scenario.from_dict(d)
        camp = run_campaign(sc, runs=runs, seed=seed + i, randomize=randomize,
                            label=f"{key}={v}")
        out.append((float(v), camp))
    return out


def dict_deepcopy(d):
    import copy

    return copy.deepcopy(d)


def _set_dotted(d: dict, key: str, value) -> dict:
    """Set ``a.b.c`` style keys; also understands the friendly aliases used in sweeps."""
    aliases = {
        "N": "missile.guidance.N",
        "law": "missile.guidance.law",
        "target_g": "target.maneuver.amplitude_g",
        "amplitude_g": "target.maneuver.amplitude_g",
        "noise_mrad": "missile.seeker.noise_mrad",
        "autopilot_tau": "missile.airframe.autopilot_tau",
    }
    path = aliases.get(key, key).split(".")
    node = d
    for p in path[:-1]:
        node = node.setdefault(p, {})
    node[path[-1]] = value
    return d


# --------------------------------------------------------------------------- figures
def figures(scenario: Scenario, out_dir, runs: int = 8000, seed: int = 0):
    """Generate the publication panel + return the headline campaign."""
    from pathlib import Path

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from .render import AMBER, BG, CYAN, WHITE, _style

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    randomize = scenario.montecarlo.randomize if scenario.montecarlo else {}

    headline = run_campaign(scenario, runs=runs, seed=seed, randomize=randomize)

    # P_k vs N
    Ns = [2, 3, 4, 5, 6]
    pk_n = sweep_pk(scenario, "N", Ns, runs=max(2000, runs // 3), seed=seed,
                    randomize=randomize)
    # evasion frontier: P_k vs target g
    gs = [0, 3, 6, 9, 12, 15]
    pk_g = sweep_pk(scenario, "target_g", gs, runs=max(2000, runs // 3), seed=seed + 100,
                    randomize={k: v for k, v in randomize.items() if "amplitude" not in k and k != "target_g"})

    fig, axs = plt.subplots(2, 2, figsize=(11, 8))
    fig.patch.set_facecolor(BG)
    for ax in axs.flat:
        _style(ax)

    # miss histogram
    ax = axs[0, 0]
    finite = headline.miss[np.isfinite(headline.miss)]
    ax.hist(np.clip(finite, 0, np.percentile(finite, 99)), bins=40, color=CYAN, alpha=0.85)
    ax.axvline(headline.lethal_radius, color="#ff5d5d", ls="--", lw=1.2, label="lethal radius")
    ax.axvline(headline.cep, color=AMBER, ls="-", lw=1.2, label=f"CEP={headline.cep:.1f} m")
    ax.set_title(f"Miss distribution  (P_k={headline.Pk:.2f})")
    ax.set_xlabel("miss [m]")
    ax.set_ylabel("count")
    _leg(ax, WHITE)

    # P_k vs N
    ax = axs[0, 1]
    ax.plot([n for n, _ in pk_n], [c.Pk for _, c in pk_n], "o-", color=CYAN)
    ax.set_title("P_k vs navigation constant N")
    ax.set_xlabel("N")
    ax.set_ylabel("P_k")
    ax.set_ylim(0, 1.02)

    # evasion frontier
    ax = axs[1, 0]
    ax.plot([g for g, _ in pk_g], [c.Pk for _, c in pk_g], "o-", color=AMBER)
    ax.set_title("Evasion frontier:  P_k vs target g")
    ax.set_xlabel("target maneuver [g]")
    ax.set_ylabel("P_k")
    ax.set_ylim(0, 1.02)

    # peak-g distribution
    ax = axs[1, 1]
    ax.hist(np.clip(headline.peak_g, 0, np.percentile(headline.peak_g, 99)), bins=40,
            color=AMBER, alpha=0.85)
    ax.axvline(scenario.missile.airframe.a_max_g, color="#ff5d5d", ls="--", lw=1.2,
               label=f"g-limit={scenario.missile.airframe.a_max_g:g}")
    ax.set_title("Peak achieved-g distribution")
    ax.set_xlabel("peak g")
    ax.set_ylabel("count")
    _leg(ax, WHITE)

    fig.suptitle(f"{scenario.name} — Monte Carlo ({headline.runs} runs)", color=WHITE, fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    panel = out_dir / "montecarlo_panel.png"
    fig.savefig(panel, dpi=130, facecolor=BG)
    plt.close(fig)
    return headline, panel


def _leg(ax, color):
    leg = ax.legend(loc="best", framealpha=0.15, fontsize=8)
    if leg:
        for t in leg.get_texts():
            t.set_color(color)
