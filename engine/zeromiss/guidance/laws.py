"""The guidance zoo: Pursuit -> PPN -> TPN -> APN -> ZEM/OGL.

Each is a one-line pure function of :class:`Geometry` and :class:`GuidanceParams`,
registered under a short name. The catalogue, in the order it teaches:

======  ========================================  =====================================
name    command                                    teaches
======  ========================================  =====================================
pursuit a = N * V_m * heading_error                the naive tail chase (curves in behind)
ppn     a = N * V_m * lambda_dot                    classic ProNav (perp to *velocity*)
tpn     a = N * V_c * lambda_dot                    closing-velocity form (perp to *LOS*)
apn     a = N * V_c * lambda_dot + N/2 * a_t_perp   adds the target-maneuver term
ogl     a = N * zem_perp / t_go^2                   null the Zero-Effort-Miss vector
======  ========================================  =====================================

Identity worth knowing (and asserted in tests): with the maneuver term included,
``ogl`` reduces algebraically to ``apn`` because
``N * zem_perp / t_go^2 = N*V_c*lambda_dot + N/2*a_t_perp``.
"""

from __future__ import annotations

import math

from ..frames import Geometry
from .base import GuidanceParams, register


@register("pursuit")
def pure_pursuit(g: Geometry, p: GuidanceParams) -> float:
    """Pure pursuit: steer the velocity vector straight at the target.

    Implemented as a proportional turn on the heading error (the angle between the
    missile velocity and the line of sight). Produces the characteristic tail chase:
    the missile curves in behind a crossing target and arrives late.
    """
    return p.N * g.V_m * g.heading_error


@register("ppn")
def pure_pronav(g: Geometry, p: GuidanceParams) -> float:
    """Pure Proportional Navigation: a = N * V_m * lambda_dot (perp to velocity)."""
    return p.N * g.V_m * g.lambda_dot


@register("tpn")
def true_pronav(g: Geometry, p: GuidanceParams) -> float:
    """True Proportional Navigation: a = N * V_c * lambda_dot (perp to LOS)."""
    return p.N * g.V_c * g.lambda_dot


@register("apn")
def augmented_pronav(g: Geometry, p: GuidanceParams) -> float:
    """Augmented PN: TPN plus the target-maneuver feed-forward N/2 * a_t_perp.

    The extra term anticipates a constant target acceleration and, in the no-lag limit,
    drives the miss to zero against a maneuvering target that defeats plain TPN.
    """
    base = p.N * g.V_c * g.lambda_dot
    if p.use_target_accel:
        base += 0.5 * p.N * g.a_t_perp
    return base


@register("ogl")
def optimal_zem(g: Geometry, p: GuidanceParams) -> float:
    """Optimal / ZEM guidance: drive the Zero-Effort-Miss to zero.

    a = N * ZEM_perp / t_go^2. The product name pays off here: this law literally
    nulls the "miss if everyone coasts from now" vector visualised in the app.
    """
    if math.isinf(g.t_go) or g.t_go <= 0.0:
        return 0.0
    # If the augmented term is disabled, fall back to a ZEM built from kinematics only.
    zem = g.zem_perp
    if not p.use_target_accel:
        # strip the 0.5 * a_t * t_go^2 contribution
        zem = zem - 0.5 * g.a_t_perp * g.t_go * g.t_go
    return p.N * zem / (g.t_go * g.t_go)


# Convenient alias used in some scenarios / the UI.
register("zem")(optimal_zem)
