"""Fixed-step RK4 integrator.

Deliberately a *fixed-step* classical Runge-Kutta 4, not an adaptive solver, so that:

* runs are bit-reproducible from a seed, and
* the TypeScript twin (``web/lib/sim/integrator.ts``) reproduces them to tolerance.

The state is a flat tuple of floats so the arithmetic order is identical in Python and
JS (both IEEE-754 doubles). No NumPy in the hot loop — that keeps the two engines from
diverging on vectorised reductions.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

State = tuple[float, ...]
Deriv = Callable[[State, float], State]


def rk4_step(state: State, deriv: Deriv, dt: float, t: float = 0.0) -> State:
    """One classical RK4 step.

    Parameters
    ----------
    state : tuple of float
        Current state vector.
    deriv : callable ``(state, t) -> dstate/dt``
        The equations of motion. Must return a sequence the same length as ``state``.
    dt : float
        Step size [s].
    t : float
        Current time [s] (passed to ``deriv`` for time-dependent forcing).

    Returns
    -------
    tuple of float
        State advanced by ``dt``.
    """
    k1 = deriv(state, t)
    s2 = _axpy(state, k1, 0.5 * dt)
    k2 = deriv(s2, t + 0.5 * dt)
    s3 = _axpy(state, k2, 0.5 * dt)
    k3 = deriv(s3, t + 0.5 * dt)
    s4 = _axpy(state, k3, dt)
    k4 = deriv(s4, t + dt)

    out = []
    sixth = dt / 6.0
    for i in range(len(state)):
        out.append(state[i] + sixth * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]))
    return tuple(out)


def euler_step(state: State, deriv: Deriv, dt: float, t: float = 0.0) -> State:
    """Forward-Euler step — only used by the integrator-order convergence test."""
    k1 = deriv(state, t)
    return _axpy(state, k1, dt)


def _axpy(state: Sequence[float], k: Sequence[float], a: float) -> State:
    """Return ``state + a*k`` element-wise."""
    return tuple(state[i] + a * k[i] for i in range(len(state)))


def integrate(
    state0: State,
    deriv: Deriv,
    dt: float,
    n_steps: int,
    method: str = "rk4",
) -> list[State]:
    """Integrate ``n_steps`` and return the full trajectory including the initial state.

    Used by the order-of-accuracy / convergence audits. The live
    engagement loop calls :func:`rk4_step` directly so it can interleave the seeker,
    airframe, and termination checks each step.
    """
    stepper = rk4_step if method == "rk4" else euler_step
    traj = [state0]
    s = state0
    t = 0.0
    for _ in range(n_steps):
        s = stepper(s, deriv, dt, t)
        t += dt
        traj.append(s)
    return traj
