"""The seeker / sensor model.

A perfect seeker makes guidance look too easy and hides the real engineering. The
seeker turns *true* relative geometry into the *measured* LOS rate the guidance law
actually receives, degraded by:

* **Seeker lag** — a first-order lag (time constant ``tau``) on the LOS rate.
* **Noise** — range-independent angular jitter ``sigma_theta`` plus optional
  **glint** that worsens as ``R -> 0`` (the classic terminal-homing headache).
* **Field of view** — a ``+/- fov`` half-angle gimbal limit; exceed it and you get
  **loss-of-lock** (the reticle goes red and the missile coasts).
* **Finite update rate** — the seeker runs at e.g. 100 Hz under the 1 kHz physics with
  a zero-order hold, exposing sample-rate effects.

The contract::

    class Seeker:
        def measure(self, g: Geometry, dt: float, rng) -> SeekerOut: ...
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .frames import Geometry, deg2rad


@dataclass(frozen=True, slots=True)
class SeekerConfig:
    """Seeker tuning."""

    ideal: bool = True               # if True, perfect measurement (ignores all below)
    tau: float = 0.1                 # LOS-rate lag time constant [s]
    noise_mrad: float = 1.0          # range-independent angular noise, RMS [mrad]
    glint: bool = False              # enable range-dependent (1/R) glint noise
    glint_ref_m: float = 1000.0      # glint reference range: sigma_glint = noise at R=this
    glint_gain_mrad: float = 2.0     # glint magnitude [mrad] at glint_ref_m
    fov_deg: float = 30.0            # gimbal/FOV half-angle [deg]
    update_hz: float = 100.0         # seeker sample rate [Hz]
    loss_of_lock_timeout_s: float = 0.5  # coast this long out-of-FOV before giving up

    @property
    def fov_rad(self) -> float:
        return deg2rad(self.fov_deg)

    @property
    def update_dt(self) -> float:
        return 1.0 / self.update_hz if self.update_hz > 0 else 0.0


@dataclass(frozen=True, slots=True)
class SeekerOut:
    """One seeker measurement."""

    lambda_dot: float    # measured LOS rate [rad/s] (what guidance consumes)
    locked: bool         # currently tracking the target
    in_fov: bool         # target within the gimbal field of view this step
    sigma: float         # noise std actually applied this update [rad]
    lock_lost_for: float  # seconds spent out of lock (0 while locked)


class Seeker:
    """Stateful seeker filter. One instance per engagement.

    All randomness comes from the ``rng`` passed into :meth:`measure`,
    so a fixed seed reproduces the run. The ideal seeker uses no randomness, which is
    what the TypeScript cross-validation fixtures rely on.
    """

    def __init__(self, cfg: SeekerConfig | None = None) -> None:
        self.cfg = cfg or SeekerConfig()
        self._t_since_update = math.inf   # force an update on the first call
        self._held = SeekerOut(0.0, True, True, 0.0, 0.0)
        self._lock_lost_for = 0.0
        self._locked = True

    def reset(self) -> None:
        self._t_since_update = math.inf
        self._held = SeekerOut(0.0, True, True, 0.0, 0.0)
        self._lock_lost_for = 0.0
        self._locked = True

    def measure(self, g: Geometry, dt: float, rng) -> SeekerOut:
        """Return the measured LOS rate for this physics step.

        Parameters
        ----------
        g : Geometry
            True relative geometry this step.
        dt : float
            Physics step [s].
        rng : numpy.random.Generator
            The single seeded RNG threaded through the engagement.
        """
        cfg = self.cfg

        # --- Ideal path: perfect, instantaneous, unlimited FOV. ---
        if cfg.ideal:
            return SeekerOut(g.lambda_dot, True, True, 0.0, 0.0)

        # --- Field-of-view / loss-of-lock bookkeeping (runs every physics step). ---
        in_fov = g.los_off_boresight <= cfg.fov_rad
        if in_fov:
            self._lock_lost_for = 0.0
            self._locked = True
        else:
            self._lock_lost_for += dt
            if self._lock_lost_for > cfg.loss_of_lock_timeout_s:
                self._locked = False

        # --- Zero-order hold between seeker updates. ---
        self._t_since_update += dt
        if self._t_since_update < cfg.update_dt and self._held is not None:
            held = self._held
            return SeekerOut(
                held.lambda_dot if self._locked else 0.0,
                self._locked,
                in_fov,
                held.sigma,
                self._lock_lost_for,
            )

        Ts = max(self._t_since_update, cfg.update_dt)
        self._t_since_update = 0.0

        # --- Noise on the measured LOS rate. ---
        sigma_ang = cfg.noise_mrad * 1e-3  # mrad -> rad
        if cfg.glint and g.R > 1e-6:
            sigma_ang += (cfg.glint_gain_mrad * 1e-3) * (cfg.glint_ref_m / g.R)
        # Angular noise on the LOS angle turns into rate noise ~ sigma_ang / Ts.
        rate_noise = rng.normal(0.0, sigma_ang) / Ts if sigma_ang > 0 else 0.0
        measured = g.lambda_dot + rate_noise

        # --- First-order lag on the LOS rate. ---
        if cfg.tau > 0.0:
            alpha = 1.0 - math.exp(-Ts / cfg.tau)
        else:
            alpha = 1.0
        prev = self._held.lambda_dot
        filtered = prev + alpha * (measured - prev)

        out = SeekerOut(
            lambda_dot=filtered if self._locked else 0.0,
            locked=self._locked,
            in_fov=in_fov,
            sigma=sigma_ang,
            lock_lost_for=self._lock_lost_for,
        )
        self._held = out
        return out
