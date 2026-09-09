"""Integrator unit + numerical-order tests."""

import math

from zeromiss.dynamics import eom
from zeromiss.integrator import integrate, rk4_step


def test_straight_line_goes_straight():
    # No accel, heading 0 -> pure +x motion.
    state = (0.0, 0.0, 1000.0, 0.0, 1e9, 1e9, 1.0, 0.0)
    s = state
    for _ in range(1000):
        s = rk4_step(s, lambda st, _t: eom(st, 0.0, 0.0), 0.001)
    assert s[0] == math.isclose(s[0], 1000.0, rel_tol=1e-9) or abs(s[0] - 1000.0) < 1e-6
    assert abs(s[1]) < 1e-9  # y unchanged


def test_constant_turn_traces_circle():
    V, a = 300.0, 300.0
    R = V * V / a
    omega = a / V
    state = (0.0, 0.0, V, 0.0, 1e9, 1e9, 1.0, 0.0)
    T = 2.0
    n = int(T / 0.001)
    s = state
    for _ in range(n):
        s = rk4_step(s, lambda st, _t: eom(st, a, 0.0), 0.001)
    th = omega * T
    ex = R * math.sin(th)
    ey = R * (1 - math.cos(th))
    assert math.hypot(s[0] - ex, s[1] - ey) < 1e-3


def test_rk4_fourth_order():
    V, a, T = 200.0, 200.0, 10.0
    R = V * V / a
    omega = a / V

    def err(dt):
        n = int(round(T / dt))
        traj = integrate((0.0, 0.0, V, 0.0, 1e9, 1e9, 1.0, 0.0),
                         lambda st, _t: eom(st, a, 0.0), dt, n)
        th = omega * T
        ex, ey = R * math.sin(th), R * (1 - math.cos(th))
        return math.hypot(traj[-1][0] - ex, traj[-1][1] - ey)

    ratio = err(0.05) / err(0.0125)  # quarter the step
    assert ratio > 100.0  # expect ~256 for O(dt^4)
