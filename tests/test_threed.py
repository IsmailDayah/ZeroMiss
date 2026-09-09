"""True 3-D engagement tests: 3-D proportional navigation."""

import math

import pytest

from zeromiss.threeD import Engagement3D, Maneuver3D, norm, sub


@pytest.mark.parametrize("N", [3.0, 4.0, 5.0])
@pytest.mark.parametrize("tvel", [(-300.0, 0.0, 0.0), (-300.0, 20.0, -15.0), (-280.0, -30.0, 25.0)])
def test_3d_zero_miss_on_cv_target(N, tvel):
    """3-D PN nulls the LOS rotation vector => miss ~ 0 against a constant-velocity target."""
    r = Engagement3D(target_pos=(8000, 500, 600), target_vel=tvel, N=N, a_max_g=50).run()
    assert r.miss_distance < 0.5, r.summary()
    assert r.verdict == "HIT"


@pytest.mark.parametrize("kind", ["weave3d", "barrel", "climb_turn"])
def test_3d_out_of_plane_maneuvers_are_finite(kind):
    r = Engagement3D(
        target_pos=(8000, 400, 500), target_vel=(-320, 0, 0), N=4, a_max_g=50,
        target_a_max_g=10, maneuver=Maneuver3D(kind=kind, amplitude_g=9, period_s=2.0, start_s=1.0),
    ).run()
    assert math.isfinite(r.miss_distance) and r.miss_distance >= 0.0
    assert r.verdict in ("HIT", "MISS")
    assert len(r.frames) > 10


def test_3d_deterministic():
    cfg = dict(target_pos=(9000, 300, -400), target_vel=(-310, 10, 5), N=4,
               maneuver=Maneuver3D(kind="barrel", amplitude_g=8, period_s=1.5, start_s=1.0))
    a = Engagement3D(**cfg).run()
    b = Engagement3D(**cfg).run()
    assert a.miss_distance == b.miss_distance
    assert a.t_flight == b.t_flight


def test_3d_speed_is_conserved():
    """The accel is perpendicular to velocity by construction => |v_M| stays constant."""
    r = Engagement3D(target_pos=(9000, 600, 700), target_vel=(-300, 0, 0), N=4,
                     maneuver=Maneuver3D(kind="weave3d", amplitude_g=8, period_s=2.0, start_s=1.0),
                     a_max_g=50).run()
    f = r.frames
    speeds = []
    for i in range(1, len(f)):
        d = norm(sub(tuple(f[i]["m"]), tuple(f[i - 1]["m"])))
        speeds.append(d / (f[i]["t"] - f[i - 1]["t"]))
    # missile speed nominally 1000 m/s; ZOH+sampling tolerance
    assert all(abs(s - 1000.0) < 25.0 for s in speeds[2:-1]), (min(speeds), max(speeds))


def test_3d_is_genuinely_three_dimensional():
    """The missile must develop real out-of-plane (z) motion chasing a climbing target."""
    r = Engagement3D(target_pos=(8000, 0, 800), target_vel=(-300, 0, 0), N=4,
                     maneuver=Maneuver3D(kind="climb_turn", amplitude_g=9, period_s=2, start_s=1)).run()
    zs = [abs(fr["m"][2]) for fr in r.frames]
    assert max(zs) > 50.0  # interceptor genuinely maneuvers in the third dimension
