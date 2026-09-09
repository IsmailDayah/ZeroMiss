"""Equations of motion for the planar (3-DOF) point-mass engagement.

The engagement state is a flat 8-tuple so it threads cleanly through the RK4 stepper::

    (x_M, y_M, V_M, gamma_M,  x_T, y_T, V_T, gamma_T)

A guidance/target lateral acceleration only *turns* the velocity vector of a
constant-speed point mass::

    gamma_dot = a / V        x_dot = V cos(gamma)      y_dot = V sin(gamma)

Optional realism:

* ``induced_drag`` — high-g turns bleed speed: ``V_dot = -k * a^2 / V``.
* ``gravity`` — a vertical-plane gravity term on heading and speed.

Both default **off**; the validation suite runs the pure constant-speed model.
"""

from __future__ import annotations

from dataclasses import dataclass

from .integrator import State

G0 = 9.80665  # standard gravity [m/s^2]


@dataclass(frozen=True, slots=True)
class DynamicsConfig:
    """Toggles for optional physical realism. Defaults reproduce the textbook model."""

    induced_drag: bool = False
    drag_coeff: float = 0.0      # dimensionless induced-drag factor k in V_dot = -k a^2/V
    gravity: bool = False        # treat the plane as vertical and apply g
    gravity_value: float = G0


def eom(
    state: State,
    a_m: float,
    a_t: float,
    cfg: DynamicsConfig | None = None,
) -> State:
    """Return the time-derivative of the engagement state.

    Parameters
    ----------
    state : 8-tuple
        ``(x_M, y_M, V_M, gamma_M, x_T, y_T, V_T, gamma_T)``.
    a_m, a_t : float
        Lateral (perpendicular-to-velocity) accelerations of missile and target
        [m/s^2], positive CCW. Held constant across the RK4 step (zero-order hold),
        which is what makes the Python and TypeScript engines bit-comparable.
    cfg : DynamicsConfig, optional
        Realism toggles; ``None`` => pure constant-speed model.

    Returns
    -------
    8-tuple
        ``d(state)/dt``.
    """
    xM, yM, VM, gM, xT, yT, VT, gT = state
    cfg = cfg or _DEFAULT_CFG

    # Missile kinematics.
    dxM = VM * _cos(gM)
    dyM = VM * _sin(gM)
    dVM = 0.0
    dgM = a_m / VM if VM > 1e-9 else 0.0

    # Target kinematics.
    dxT = VT * _cos(gT)
    dyT = VT * _sin(gT)
    dVT = 0.0
    dgT = a_t / VT if VT > 1e-9 else 0.0

    if cfg.induced_drag and cfg.drag_coeff > 0.0:
        dVM -= cfg.drag_coeff * (a_m * a_m) / VM if VM > 1e-9 else 0.0
        dVT -= cfg.drag_coeff * (a_t * a_t) / VT if VT > 1e-9 else 0.0

    if cfg.gravity:
        g = cfg.gravity_value
        # Vertical-plane convention: gamma measured from horizontal.
        dgM -= (g * _cos(gM)) / VM if VM > 1e-9 else 0.0
        dgT -= (g * _cos(gT)) / VT if VT > 1e-9 else 0.0
        dVM -= g * _sin(gM)
        dVT -= g * _sin(gT)

    return (dxM, dyM, dVM, dgM, dxT, dyT, dVT, dgT)


# --- tiny trig shims so the call sites read like the equations above ---
def _cos(a: float) -> float:
    from math import cos

    return cos(a)


def _sin(a: float) -> float:
    from math import sin

    return sin(a)


_DEFAULT_CFG = DynamicsConfig()
