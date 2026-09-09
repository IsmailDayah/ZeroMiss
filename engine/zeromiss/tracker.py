"""Tracker-in-the-loop — radar estimation feeding the seeker.

A real interceptor doesn't get the target's truth; it gets a *noisy* radar return and
must **estimate** the target's state before it can guide on it. This module adds that
layer — estimation and sensor fusion — on top of the guidance core.

Contents
--------
* :func:`radar_measure` — a noisy range/bearing measurement of the target from the
  (known) interceptor position.
* :class:`EKF` — an Extended Kalman Filter tracking the target's
  ``[x, y, vx, vy]`` from those polar measurements (constant-velocity model).
* :class:`IMM` — an Interacting Multiple Model filter blending a *quiet* (low
  process-noise) and a *maneuvering* (high process-noise) EKF, so it tracks a steady
  target tightly **and** a hard-maneuvering one without lag — the textbook win of IMM
  over a single model.
* :class:`Tracker` — the engagement-facing wrapper: ``step()`` predicts every physics
  step and corrects at the radar rate, exposing an estimated target
  :class:`~zeromiss.frames.Kinematic` the guidance law can use.

All randomness flows from the single seeded ``Generator``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .frames import Kinematic, wrap_to_pi


def radar_measure(
    missile: Kinematic, target: Kinematic, rng, sigma_r: float, sigma_beta: float
) -> tuple[float, float]:
    """Return a noisy ``(range, bearing)`` of the target from the interceptor.

    ``range`` [m] and ``bearing`` [rad] (absolute, atan2(dy, dx)) with independent
    Gaussian noise of std ``sigma_r`` and ``sigma_beta``.
    """
    dx = target.x - missile.x
    dy = target.y - missile.y
    r = math.hypot(dx, dy) + rng.normal(0.0, sigma_r)
    beta = math.atan2(dy, dx) + rng.normal(0.0, sigma_beta)
    return r, beta


def _Q_cv(dt: float, q: float) -> np.ndarray:
    """Discrete white-noise-acceleration process covariance for a CV model."""
    dt2 = dt * dt
    dt3 = dt2 * dt
    dt4 = dt2 * dt2
    return q * np.array([
        [dt4 / 4, 0, dt3 / 2, 0],
        [0, dt4 / 4, 0, dt3 / 2],
        [dt3 / 2, 0, dt2, 0],
        [0, dt3 / 2, 0, dt2],
    ])


class EKF:
    """Extended Kalman Filter: target ``[x, y, vx, vy]`` from range/bearing.

    Parameters
    ----------
    q : float
        Process-noise intensity (m^2/s^3). Small => trusts the constant-velocity model;
        large => adapts fast to maneuvers (at the cost of noisier estimates).
    sigma_r, sigma_beta : float
        Measurement noise std (range [m], bearing [rad]).
    """

    def __init__(self, q: float = 50.0, sigma_r: float = 20.0, sigma_beta: float = 5e-3) -> None:
        self.q = q
        self.R = np.diag([sigma_r**2, sigma_beta**2])
        self.x = np.zeros(4)
        self.P = np.eye(4) * 1e6
        self._init = False

    def initialize(self, x: float, y: float, vx: float = 0.0, vy: float = 0.0) -> None:
        self.x = np.array([x, y, vx, vy], dtype=float)
        self.P = np.diag([1e3, 1e3, 1e4, 1e4]).astype(float)
        self._init = True

    def predict(self, dt: float) -> None:
        F = np.array([
            [1, 0, dt, 0],
            [0, 1, 0, dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ], dtype=float)
        self.x = F @ self.x
        self.P = F @ self.P @ F.T + _Q_cv(dt, self.q)

    def _hH(self, sx: float, sy: float) -> tuple[np.ndarray, np.ndarray]:
        dx = self.x[0] - sx
        dy = self.x[1] - sy
        r2 = dx * dx + dy * dy
        r = math.sqrt(max(r2, 1e-9))
        h = np.array([r, math.atan2(dy, dx)])
        H = np.array([
            [dx / r, dy / r, 0.0, 0.0],
            [-dy / r2, dx / r2, 0.0, 0.0],
        ])
        return h, H

    def update(self, z: tuple[float, float], sx: float, sy: float) -> float:
        """Correct with a measurement; return the measurement likelihood (for IMM)."""
        h, H = self._hH(sx, sy)
        y = np.array([z[0] - h[0], wrap_to_pi(z[1] - h[1])])
        S = H @ self.P @ H.T + self.R
        Sinv = np.linalg.inv(S)
        K = self.P @ H.T @ Sinv
        self.x = self.x + K @ y
        self.P = (np.eye(4) - K @ H) @ self.P
        # Gaussian likelihood of the innovation (for IMM mode-probability update)
        det = max(np.linalg.det(2 * np.pi * S), 1e-12)
        return float(math.exp(-0.5 * y @ Sinv @ y) / math.sqrt(det))

    def estimate(self) -> np.ndarray:
        return self.x.copy()


class IMM:
    """Interacting Multiple Model filter over a quiet and a maneuvering CV-EKF.

    Two models share the same state, so mixing is exact. The Markov transition matrix
    ``Pi`` governs how readily the filter switches between "the target is coasting" and
    "the target is maneuvering" — letting it track both regimes without the lag a single
    model suffers.
    """

    def __init__(
        self,
        q_quiet: float = 5.0,
        q_maneuver: float = 5000.0,
        sigma_r: float = 20.0,
        sigma_beta: float = 5e-3,
        pi_stay: float = 0.95,
    ) -> None:
        self.models = [
            EKF(q_quiet, sigma_r, sigma_beta),
            EKF(q_maneuver, sigma_r, sigma_beta),
        ]
        self.mu = np.array([0.5, 0.5])
        self.Pi = np.array([[pi_stay, 1 - pi_stay], [1 - pi_stay, pi_stay]])

    def initialize(self, x: float, y: float, vx: float = 0.0, vy: float = 0.0) -> None:
        for m in self.models:
            m.initialize(x, y, vx, vy)

    def step(self, dt: float, z: tuple[float, float], sx: float, sy: float) -> None:
        n = len(self.models)
        # --- mixing ---
        cbar = self.Pi.T @ self.mu
        cbar = np.where(cbar < 1e-12, 1e-12, cbar)
        mix = (self.Pi * self.mu[:, None]) / cbar[None, :]  # mix[i,j]
        xs = [m.estimate() for m in self.models]
        Ps = [m.P.copy() for m in self.models]
        for j in range(n):
            x0 = sum(mix[i, j] * xs[i] for i in range(n))
            P0 = np.zeros((4, 4))
            for i in range(n):
                d = (xs[i] - x0).reshape(4, 1)
                P0 += mix[i, j] * (Ps[i] + d @ d.T)
            self.models[j].x = x0
            self.models[j].P = P0
        # --- mode-matched predict + update, collect likelihoods ---
        likelihood = np.zeros(n)
        for j, m in enumerate(self.models):
            m.predict(dt)
            likelihood[j] = m.update(z, sx, sy)
        # --- mode probability update ---
        self.mu = cbar * likelihood
        s = self.mu.sum()
        self.mu = self.mu / s if s > 1e-12 else np.ones(n) / n

    def estimate(self) -> np.ndarray:
        return sum(self.mu[j] * self.models[j].estimate() for j in range(len(self.models)))

    @property
    def maneuver_probability(self) -> float:
        return float(self.mu[1])


@dataclass
class TrackerConfig:
    enabled: bool = False
    model: str = "imm"          # "ekf" | "imm"
    sigma_r_m: float = 20.0     # radar range noise [m]
    sigma_beta_mrad: float = 5.0  # radar bearing noise [mrad]
    radar_hz: float = 50.0      # measurement update rate
    q: float = 50.0             # EKF process-noise intensity
    q_quiet: float = 5.0        # IMM quiet-model process noise
    q_maneuver: float = 5000.0  # IMM maneuvering-model process noise


@dataclass
class Tracker:
    """Engagement-facing wrapper: predict every step, correct at the radar rate."""

    cfg: TrackerConfig
    _filter: object = field(default=None, init=False)
    _t_since_update: float = field(default=math.inf, init=False)
    _started: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        sigma_beta = self.cfg.sigma_beta_mrad * 1e-3
        if self.cfg.model.lower() == "ekf":
            self._filter = EKF(self.cfg.q, self.cfg.sigma_r_m, sigma_beta)
        else:
            self._filter = IMM(self.cfg.q_quiet, self.cfg.q_maneuver, self.cfg.sigma_r_m, sigma_beta)

    @property
    def update_dt(self) -> float:
        return 1.0 / self.cfg.radar_hz if self.cfg.radar_hz > 0 else 0.0

    def step(self, missile: Kinematic, target: Kinematic, dt: float, rng) -> Kinematic:
        """Advance the tracker one physics step; return the estimated target Kinematic."""
        f = self._filter
        if not self._started:
            f.initialize(target.x, target.y, target.vx, target.vy)  # type: ignore[attr-defined]
            self._started = True
            self._t_since_update = 0.0
            return target

        self._t_since_update += dt
        if self._t_since_update + 1e-12 >= self.update_dt:
            Ts = self._t_since_update
            self._t_since_update = 0.0
            z = radar_measure(missile, target, rng, self.cfg.sigma_r_m, self.cfg.sigma_beta_mrad * 1e-3)
            if isinstance(f, IMM):
                f.step(Ts, z, missile.x, missile.y)
            else:
                f.predict(Ts)
                f.update(z, missile.x, missile.y)

        est = f.estimate()
        speed = math.hypot(est[2], est[3])
        heading = math.atan2(est[3], est[2]) if speed > 1e-6 else target.heading
        return Kinematic(est[0], est[1], speed if speed > 1e-6 else target.speed, heading)
