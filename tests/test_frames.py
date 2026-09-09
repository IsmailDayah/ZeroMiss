"""Geometry & LOS unit tests on hand-computed cases."""

import math

import pytest

from zeromiss.frames import Kinematic, relative_state, wrap_to_pi


def test_wrap_to_pi():
    assert wrap_to_pi(0.0) == pytest.approx(0.0)
    assert wrap_to_pi(math.pi) == pytest.approx(math.pi)
    assert wrap_to_pi(-math.pi) == pytest.approx(math.pi)
    assert wrap_to_pi(3 * math.pi) == pytest.approx(math.pi)
    # 179deg minus -179deg = 358deg, which wraps to -2deg (not +358)
    a = wrap_to_pi(math.radians(179) - math.radians(-179))
    assert a == pytest.approx(math.radians(-2), abs=1e-9)


def test_range_and_los_headon():
    m = Kinematic(0, 0, 1000, 0.0)
    t = Kinematic(8000, 0, 300, math.pi)  # heading 180 deg, closing
    g = relative_state(m, t)
    assert g.R == pytest.approx(8000.0)
    assert g.lam == pytest.approx(0.0)
    # head-on closing: V_c = V_M + V_T = 1300
    assert g.V_c == pytest.approx(1300.0)
    assert g.t_go == pytest.approx(8000.0 / 1300.0, rel=1e-9)
    # collinear -> zero LOS rate
    assert g.lambda_dot == pytest.approx(0.0, abs=1e-12)


def test_los_rate_sign_crossing_target():
    # Target directly ahead moving +y (crossing up) => LOS rotates CCW => lambda_dot > 0
    m = Kinematic(0, 0, 1000, 0.0)
    t = Kinematic(5000, 0, 300, math.pi / 2)  # moving +y
    g = relative_state(m, t)
    assert g.lambda_dot > 0


def test_closing_velocity_receding():
    # Target moving away faster than missile closes => not closing
    m = Kinematic(0, 0, 100, 0.0)
    t = Kinematic(5000, 0, 300, 0.0)  # both +x, target faster, opening
    g = relative_state(m, t)
    assert g.V_c < 0
    assert g.closing is False
    assert math.isinf(g.t_go)


def test_zem_zero_on_collision_course():
    # If perpendicular relative velocity is zero (pure closing), ZEM ~ 0
    m = Kinematic(0, 0, 1000, 0.0)
    t = Kinematic(8000, 0, 300, math.pi)
    g = relative_state(m, t)
    assert g.zem_perp == pytest.approx(0.0, abs=1e-6)
