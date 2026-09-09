"""Coordinate frames, angle utilities, and line-of-sight (LOS) geometry.

This module is **pure and stateless**. Everything downstream —
guidance, the seeker, the engagement loop — consumes the :class:`Geometry` produced
here. Keeping it dependency-free and side-effect-free is what lets the TypeScript twin
reproduce it byte-for-byte.

All quantities are SI (metres, seconds, radians) unless a name says otherwise.

Planar (2-D) convention
-----------------------
* ``x`` points "downrange" (east), ``y`` points "crossrange" (north).
* Heading ``gamma`` (flight-path angle) is measured CCW from +x, in radians.
* A positive lateral acceleration turns the velocity vector CCW (``gamma`` increases).
* The line-of-sight angle ``lambda`` = ``atan2(dy, dx)`` from missile to target.
* The LOS rate ``lambda_dot`` > 0 means the target is drifting CCW across the view.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

TWO_PI = 2.0 * math.pi


def wrap_to_pi(angle: float) -> float:
    """Wrap an angle to ``(-pi, pi]``.

    Used everywhere an angular difference is taken so that, e.g., the difference
    between +179 deg and -179 deg is +2 deg, not -358 deg.
    """
    a = math.fmod(angle + math.pi, TWO_PI)
    if a <= 0.0:
        a += TWO_PI
    return a - math.pi


def deg2rad(deg: float) -> float:
    return deg * math.pi / 180.0


def rad2deg(rad: float) -> float:
    return rad * 180.0 / math.pi


@dataclass(frozen=True, slots=True)
class Kinematic:
    """A constant-speed point mass: position, speed, heading.

    Attributes
    ----------
    x, y : float
        Position [m].
    speed : float
        Magnitude of the velocity [m/s] (constant in the nominal point-mass model).
    heading : float
        Flight-path angle [rad], CCW from +x.
    accel_cmd : float
        The *lateral* acceleration last applied to this body [m/s^2], perpendicular to
        its velocity, positive CCW. Carried for telemetry/visualisation only; the
        integrator uses the value supplied to the derivative, not this field.
    """

    x: float
    y: float
    speed: float
    heading: float
    accel_cmd: float = 0.0

    @property
    def vx(self) -> float:
        return self.speed * math.cos(self.heading)

    @property
    def vy(self) -> float:
        return self.speed * math.sin(self.heading)


@dataclass(frozen=True, slots=True)
class Geometry:
    """Relative engagement geometry — the entire input a guidance law needs.

    One frozen record per step: range, LOS angle and rate, closing velocity and
    time-to-go. A law reads these and returns a lateral acceleration; it never
    touches raw missile or target state.
    """

    R: float            # range to go [m]
    lam: float          # line-of-sight angle [rad]
    lambda_dot: float   # LOS rate [rad/s] — "the star of the show"
    V_c: float          # closing velocity [m/s] (= -R_dot)
    t_go: float         # time-to-go estimate [s]
    zem_perp: float     # zero-effort-miss component perpendicular to LOS [m]
    # Extra context, handy for telemetry & the ZEM/APN terms.
    R_dot: float = 0.0          # range rate [m/s]
    closing: bool = True        # whether the pair is closing (V_c > 0)
    a_t_perp: float = 0.0       # target lateral accel resolved perpendicular to LOS
    V_m: float = 0.0            # missile speed [m/s] (for PPN / pure pursuit gains)
    heading_error: float = 0.0  # wrap(lambda - gamma_M) [rad] (for pure pursuit)
    los_off_boresight: float = 0.0  # wrap(lambda - gamma_M) magnitude vs seeker FOV


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    """Division that degrades gracefully at the singularity R -> 0."""
    if abs(den) < 1e-12:
        return default
    return num / den


def relative_state(
    missile: Kinematic,
    target: Kinematic,
    a_t_perp_los: float = 0.0,
    t_go_floor: float = 1e-3,
) -> Geometry:
    """Compute the relative geometry from missile to target.

    Parameters
    ----------
    missile, target : Kinematic
        The two bodies.
    a_t_perp_los : float
        The target's lateral acceleration resolved perpendicular to the LOS [m/s^2].
        Needed by APN and the ZEM term; pass 0 if unknown/non-maneuvering.
    t_go_floor : float
        Lower clamp on ``t_go`` to avoid divide-by-zero in ``a/t_go^2`` style laws as
        the engagement terminates.

    Returns
    -------
    Geometry
    """
    dx = target.x - missile.x
    dy = target.y - missile.y
    R = math.hypot(dx, dy)
    lam = math.atan2(dy, dx)

    dvx = target.vx - missile.vx
    dvy = target.vy - missile.vy

    # LOS rate: lambda_dot = (dx*dvy - dy*dvx) / R^2
    lambda_dot = _safe_div(dx * dvy - dy * dvx, R * R)

    # Range rate R_dot = (dx*dvx + dy*dvy)/R ; closing velocity V_c = -R_dot.
    R_dot = _safe_div(dx * dvx + dy * dvy, R)
    V_c = -R_dot

    # Time-to-go ~ R / V_c, guarded for non-closing / near-zero closing geometry.
    if V_c > 1e-6:
        t_go = max(R / V_c, t_go_floor)
    else:
        t_go = float("inf")

    # Zero-effort-miss perpendicular to the LOS:
    #   ZEM_perp = R * lambda_dot * t_go + 0.5 * a_t_perp * t_go^2
    # The first term is the relative perpendicular position+velocity projected forward;
    # for a coasting pair, R*lambda_dot is the instantaneous perpendicular closing
    # velocity, so R*lambda_dot*t_go is where it ends up at intercept.
    if math.isinf(t_go):
        zem_perp = 0.0
    else:
        zem_perp = R * lambda_dot * t_go + 0.5 * a_t_perp_los * t_go * t_go

    heading_error = wrap_to_pi(lam - missile.heading)

    return Geometry(
        R=R,
        lam=lam,
        lambda_dot=lambda_dot,
        V_c=V_c,
        t_go=t_go,
        zem_perp=zem_perp,
        R_dot=R_dot,
        closing=V_c > 0.0,
        a_t_perp=a_t_perp_los,
        V_m=missile.speed,
        heading_error=heading_error,
        los_off_boresight=abs(heading_error),
    )


def perpendicular_component(accel: float, accel_heading: float, los_angle: float) -> float:
    """Resolve a lateral accel of a body onto the perpendicular-to-LOS axis.

    A body pulling lateral accel ``accel`` (positive CCW, perpendicular to its own
    velocity of heading ``accel_heading``) has an acceleration vector pointing at
    ``accel_heading + pi/2``. Its component perpendicular to the LOS (the axis at
    ``los_angle + pi/2``) is ``accel * cos(accel_heading - los_angle)``.
    """
    return accel * math.cos(accel_heading - los_angle)
