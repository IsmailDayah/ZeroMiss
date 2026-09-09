"""Guidance-law unit tests on hand-computed geometry."""

import math

import pytest

from zeromiss.frames import Geometry
from zeromiss.guidance import GuidanceParams, available, get_law
from zeromiss.guidance.laws import augmented_pronav, optimal_zem


def _geom(**kw):
    base = dict(R=5000.0, lam=0.0, lambda_dot=0.01, V_c=1300.0, t_go=3.85,
                zem_perp=0.0, R_dot=-1300.0, closing=True, a_t_perp=0.0,
                V_m=1000.0, heading_error=0.0, los_off_boresight=0.0)
    base.update(kw)
    return Geometry(**base)


def test_registry_has_all_laws():
    for name in ("pursuit", "ppn", "tpn", "apn", "ogl", "zem"):
        assert name in available()


def test_tpn_command():
    g = _geom(lambda_dot=0.02, V_c=1300.0)
    p = GuidanceParams(N=4.0)
    assert get_law("tpn")(g, p) == pytest.approx(4.0 * 1300.0 * 0.02)


def test_ppn_command():
    g = _geom(lambda_dot=0.02, V_m=1000.0)
    p = GuidanceParams(N=3.0)
    assert get_law("ppn")(g, p) == pytest.approx(3.0 * 1000.0 * 0.02)


def test_pursuit_drives_heading_error():
    g = _geom(heading_error=0.1, V_m=1000.0)
    p = GuidanceParams(N=4.0)
    assert get_law("pursuit")(g, p) == pytest.approx(4.0 * 1000.0 * 0.1)


def test_apn_adds_maneuver_term():
    g = _geom(lambda_dot=0.01, V_c=1300.0, a_t_perp=50.0)
    p = GuidanceParams(N=4.0, use_target_accel=True)
    expected = 4.0 * 1300.0 * 0.01 + 0.5 * 4.0 * 50.0
    assert get_law("apn")(g, p) == pytest.approx(expected)


def test_apn_without_target_accel_is_tpn():
    g = _geom(lambda_dot=0.01, V_c=1300.0, a_t_perp=50.0)
    p = GuidanceParams(N=4.0, use_target_accel=False)
    assert get_law("apn")(g, p) == pytest.approx(get_law("tpn")(g, p))


def test_ogl_equivalent_to_apn():
    # N * ZEM/t_go^2 == N*Vc*lambda_dot + N/2*a_t_perp  (the known identity)
    t_go = 3.85
    ld = 0.012
    Vc = 1300.0
    a_t_perp = 40.0
    R = Vc * t_go
    zem = R * ld * t_go + 0.5 * a_t_perp * t_go * t_go
    g = _geom(R=R, lambda_dot=ld, V_c=Vc, t_go=t_go, zem_perp=zem, a_t_perp=a_t_perp)
    p = GuidanceParams(N=4.0, use_target_accel=True)
    assert optimal_zem(g, p) == pytest.approx(augmented_pronav(g, p), rel=1e-9)


def test_ogl_infinite_tgo_is_safe():
    g = _geom(t_go=math.inf)
    assert optimal_zem(g, GuidanceParams(N=4.0)) == 0.0


def test_unknown_law_raises():
    with pytest.raises(KeyError):
        get_law("warp_drive")
