"""Seeker & airframe model unit tests."""

import numpy as np

from zeromiss.airframe import Airframe, AirframeConfig
from zeromiss.frames import Geometry
from zeromiss.seeker import Seeker, SeekerConfig


def _g(lambda_dot=0.01, R=5000.0, off=0.0):
    return Geometry(R=R, lam=0.0, lambda_dot=lambda_dot, V_c=1300.0, t_go=3.85,
                    zem_perp=0.0, R_dot=-1300.0, closing=True, a_t_perp=0.0,
                    V_m=1000.0, heading_error=off, los_off_boresight=abs(off))


def test_airframe_clamps_to_g_limit():
    af = Airframe(AirframeConfig(ideal=False, a_max_g=40.0, autopilot_tau=0.0))
    out = af.respond(1e6, 0.001)
    assert out <= 40.0 * 9.80665 + 1e-6
    assert af.state.saturated is True


def test_airframe_lag_approaches_command():
    af = Airframe(AirframeConfig(ideal=False, a_max_g=1000.0, autopilot_tau=0.1))
    cmd = 100.0
    val = 0.0
    for _ in range(2000):  # 2 s, ~20 time constants
        val = af.respond(cmd, 0.001)
    assert abs(val - cmd) < 1.0


def test_airframe_ideal_passthrough():
    af = Airframe(AirframeConfig(ideal=True))
    assert af.respond(123.4, 0.001) == 123.4


def test_seeker_ideal_passthrough():
    sk = Seeker(SeekerConfig(ideal=True))
    rng = np.random.default_rng(0)
    out = sk.measure(_g(lambda_dot=0.02), 0.001, rng)
    assert out.lambda_dot == 0.02
    assert out.locked is True


def test_seeker_loss_of_lock_outside_fov():
    sk = Seeker(SeekerConfig(ideal=False, fov_deg=10.0, loss_of_lock_timeout_s=0.05,
                             noise_mrad=0.0, tau=0.05, update_hz=1000))
    rng = np.random.default_rng(0)
    # off-boresight 30 deg >> 10 deg FOV -> lock lost after the timeout
    out = None
    for _ in range(200):
        out = sk.measure(_g(off=np.radians(30)), 0.001, rng)
    assert out.locked is False
    assert out.lambda_dot == 0.0


def test_seeker_lag_filters_toward_truth():
    sk = Seeker(SeekerConfig(ideal=False, fov_deg=60.0, noise_mrad=0.0, tau=0.1, update_hz=1000))
    rng = np.random.default_rng(0)
    out = None
    for _ in range(1000):
        out = sk.measure(_g(lambda_dot=0.02), 0.001, rng)
    assert abs(out.lambda_dot - 0.02) < 1e-3
