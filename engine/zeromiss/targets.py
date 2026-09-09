"""Target & evasion models.

The target is a first-class actor, not a dot on rails. Each model is a callable that
returns the target's *commanded* lateral acceleration at time ``t`` (positive = turn
CCW), which the engagement then clamps to the target g-limit.

======================  ======================================  =========================
type                    behaviour                                purpose
======================  ======================================  =========================
constant_velocity (cv)  straight line                            the sanity case
step                    a single hard break at ``start_s``       the canonical Zarchan case
weave                   sinusoidal lateral g                     the realistic evader
bang_bang               alternating max-g jinks (fixed period)   the hardest classical case
jink                    bang-bang with randomised switch times   unpredictable evasion
scripted                YAML keyframe (t, a_g) interpolation     reproduce a specific path
live                    command set externally each step          Duel mode (the human flies)
======================  ======================================  =========================
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

G0 = 9.80665


class Maneuver:
    """Base class. Subclasses implement :meth:`command`."""

    def command(self, t: float) -> float:  # noqa: D401 - simple contract
        """Return commanded lateral accel [m/s^2] at time ``t`` [s]."""
        return 0.0

    def reset(self) -> None:
        pass


@dataclass
class ConstantVelocity(Maneuver):
    def command(self, t: float) -> float:
        return 0.0


@dataclass
class Step(Maneuver):
    amplitude_g: float = 9.0
    start_s: float = 1.0

    def command(self, t: float) -> float:
        return self.amplitude_g * G0 if t >= self.start_s else 0.0


@dataclass
class Weave(Maneuver):
    amplitude_g: float = 9.0
    period_s: float = 2.0
    start_s: float = 1.0
    phase: float = 0.0

    def command(self, t: float) -> float:
        if t < self.start_s or self.period_s <= 0.0:
            return 0.0
        w = 2.0 * math.pi / self.period_s
        return self.amplitude_g * G0 * math.sin(w * (t - self.start_s) + self.phase)


@dataclass
class BangBang(Maneuver):
    amplitude_g: float = 9.0
    period_s: float = 2.0
    start_s: float = 1.0

    def command(self, t: float) -> float:
        if t < self.start_s or self.period_s <= 0.0:
            return 0.0
        # Square wave: +amp for first half period, -amp for second.
        phase = ((t - self.start_s) % self.period_s) / self.period_s
        s = 1.0 if phase < 0.5 else -1.0
        return s * self.amplitude_g * G0


@dataclass
class Jink(Maneuver):
    """Bang-bang with randomised switch times — unpredictable evasion."""

    amplitude_g: float = 9.0
    start_s: float = 1.0
    mean_interval_s: float = 0.8
    _switch_times: list[float] = field(default_factory=list)
    _signs: list[float] = field(default_factory=list)

    def schedule(self, rng, t_max: float) -> None:
        """Precompute switch times from the seeded RNG (determinism)."""
        self._switch_times = []
        self._signs = []
        t = self.start_s
        sign = 1.0 if rng.random() < 0.5 else -1.0
        while t < t_max:
            self._switch_times.append(t)
            self._signs.append(sign)
            dt = rng.exponential(self.mean_interval_s)
            t += max(dt, 0.05)
            sign = -sign

    def command(self, t: float) -> float:
        if t < self.start_s or not self._switch_times:
            return 0.0
        # find current segment
        sign = self._signs[0]
        for ts, sg in zip(self._switch_times, self._signs, strict=False):
            if t >= ts:
                sign = sg
            else:
                break
        return sign * self.amplitude_g * G0


@dataclass
class Scripted(Maneuver):
    """Piecewise-linear interpolation of commanded g over keyframes ``(t, a_g)``."""

    keyframes: list[tuple[float, float]] = field(default_factory=list)

    def command(self, t: float) -> float:
        kf = self.keyframes
        if not kf:
            return 0.0
        if t <= kf[0][0]:
            return kf[0][1] * G0
        if t >= kf[-1][0]:
            return kf[-1][1] * G0
        for i in range(1, len(kf)):
            t0, a0 = kf[i - 1]
            t1, a1 = kf[i]
            if t <= t1:
                frac = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
                return (a0 + frac * (a1 - a0)) * G0
        return kf[-1][1] * G0


@dataclass
class Live(Maneuver):
    """Externally driven (Duel mode). The host sets :attr:`current` each step."""

    current: float = 0.0

    def command(self, t: float) -> float:
        return self.current


def build_maneuver(spec: dict, rng=None, t_max: float = 15.0) -> Maneuver:
    """Construct a maneuver from a plain dict (used by the scenario layer).

    Parameters
    ----------
    spec : dict
        ``{"type": "weave", "amplitude_g": 9, "period_s": 2.0, "start_s": 1.0}`` etc.
    rng : numpy.random.Generator, optional
        Required for the ``jink`` model's randomised schedule.
    t_max : float
        Engagement horizon, used to pre-schedule the jink switch times.
    """
    spec = dict(spec or {})
    kind = str(spec.pop("type", "constant_velocity")).lower()

    if kind in ("constant_velocity", "cv", "none"):
        return ConstantVelocity()
    if kind == "step":
        return Step(**_take(spec, ("amplitude_g", "start_s")))
    if kind == "weave":
        return Weave(**_take(spec, ("amplitude_g", "period_s", "start_s", "phase")))
    if kind == "bang_bang":
        return BangBang(**_take(spec, ("amplitude_g", "period_s", "start_s")))
    if kind == "jink":
        m = Jink(**_take(spec, ("amplitude_g", "start_s", "mean_interval_s")))
        if rng is not None:
            m.schedule(rng, t_max)
        return m
    if kind == "scripted":
        kfs = spec.get("keyframes", [])
        return Scripted(keyframes=[(float(a), float(b)) for a, b in kfs])
    if kind == "live":
        return Live()
    raise ValueError(f"Unknown target maneuver type: {kind!r}")


def _take(spec: dict, keys: tuple[str, ...]) -> dict:
    return {k: spec[k] for k in keys if k in spec}
