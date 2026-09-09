"""The airframe & autopilot model.

Guidance *commands* an acceleration; the airframe *delivers* it imperfectly:

* **g-limit** — a hard clamp ``|a| <= a_max`` (e.g. 40 g).
* **Autopilot lag** — a first- or (optional) second-order response between commanded
  and achieved acceleration. This single lag is the dominant real-world miss source
  for a maneuvering target, and the reason ``N`` and ``tau`` must be co-tuned.
* **Saturation** — when the command exceeds the limit the response saturates and the
  HUD flags the "commanding more than I can pull" state.

The contract::

    class Airframe:
        def respond(self, a_cmd: float, dt: float) -> float: ...
"""

from __future__ import annotations

from dataclasses import dataclass

G0 = 9.80665


@dataclass(frozen=True, slots=True)
class AirframeConfig:
    """Airframe tuning."""

    ideal: bool = False           # if True: no lag, no limit (used by analytic checks)
    a_max_g: float = 40.0         # acceleration limit [g]
    autopilot_tau: float = 0.2    # lag time constant [s]
    order: int = 1                # 1 = first-order lag, 2 = second-order
    zeta: float = 0.7             # damping ratio (order==2 only)

    @property
    def a_max(self) -> float:
        return self.a_max_g * G0


@dataclass(slots=True)
class AirframeState:
    """Mutable airframe state, exposed for telemetry."""

    achieved: float = 0.0
    rate: float = 0.0          # da/dt, used by the second-order model
    commanded: float = 0.0     # raw command this step (pre-clamp)
    clamped: float = 0.0       # command after the g-limit
    saturated: bool = False


class Airframe:
    """Stateful airframe filter. One instance per missile per engagement."""

    def __init__(self, cfg: AirframeConfig | None = None) -> None:
        self.cfg = cfg or AirframeConfig()
        self.state = AirframeState()

    def reset(self) -> None:
        self.state = AirframeState()

    def respond(self, a_cmd: float, dt: float) -> float:
        """Map a commanded lateral accel to the achieved one this step.

        Returns the achieved acceleration [m/s^2]. Side-effects update ``self.state``
        (achieved, saturation flag) for the HUD/telemetry.
        """
        cfg = self.cfg
        st = self.state
        st.commanded = a_cmd

        if cfg.ideal:
            st.clamped = a_cmd
            st.saturated = False
            st.achieved = a_cmd
            st.rate = 0.0
            return a_cmd

        # g-limit clamp + saturation flag.
        a_max = cfg.a_max
        if a_cmd > a_max:
            clamped = a_max
            st.saturated = True
        elif a_cmd < -a_max:
            clamped = -a_max
            st.saturated = True
        else:
            clamped = a_cmd
            st.saturated = False
        st.clamped = clamped

        tau = cfg.autopilot_tau
        if tau <= 0.0:
            st.achieved = clamped
            st.rate = 0.0
            return clamped

        if cfg.order >= 2:
            # Second-order: a'' = wn^2 (cmd - a) - 2 zeta wn a'.  Explicit sub-step.
            wn = 1.0 / tau
            accel_of_a = wn * wn * (clamped - st.achieved) - 2.0 * cfg.zeta * wn * st.rate
            st.rate += dt * accel_of_a
            st.achieved += dt * st.rate
        else:
            # First-order exact ZOH: a += (1 - e^{-dt/tau}) (cmd - a).
            import math

            alpha = 1.0 - math.exp(-dt / tau)
            st.achieved += alpha * (clamped - st.achieved)
            st.rate = 0.0

        return st.achieved
