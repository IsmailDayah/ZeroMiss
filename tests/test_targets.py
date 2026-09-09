"""Target maneuver model tests."""

import numpy as np
import pytest

from zeromiss.targets import (
    G0,
    BangBang,
    Live,
    Scripted,
    Step,
    Weave,
    build_maneuver,
)


def test_step():
    m = Step(amplitude_g=9, start_s=1.0)
    assert m.command(0.5) == 0.0
    assert m.command(1.5) == pytest.approx(9 * G0)


def test_weave_sign_and_zero_before_start():
    m = Weave(amplitude_g=9, period_s=2.0, start_s=1.0)
    assert m.command(0.5) == 0.0
    assert m.command(1.0) == pytest.approx(0.0, abs=1e-9)  # sin(0)
    assert m.command(1.5) > 0  # quarter period up


def test_bang_bang_alternates():
    m = BangBang(amplitude_g=10, period_s=2.0, start_s=0.0)
    assert m.command(0.1) == pytest.approx(10 * G0)
    assert m.command(1.1) == pytest.approx(-10 * G0)


def test_scripted_interpolates():
    m = Scripted(keyframes=[(0.0, 0.0), (2.0, 10.0)])
    assert m.command(1.0) == pytest.approx(5.0 * G0)
    assert m.command(-1.0) == pytest.approx(0.0)
    assert m.command(5.0) == pytest.approx(10.0 * G0)


def test_live_external():
    m = Live()
    m.current = 42.0
    assert m.command(99.0) == 42.0


def test_build_maneuver_and_jink_determinism():
    rng1 = np.random.default_rng(0)
    rng2 = np.random.default_rng(0)
    j1 = build_maneuver({"type": "jink", "amplitude_g": 10, "start_s": 1.0}, rng=rng1, t_max=10)
    j2 = build_maneuver({"type": "jink", "amplitude_g": 10, "start_s": 1.0}, rng=rng2, t_max=10)
    ts = [t * 0.5 for t in range(20)]
    assert [j1.command(t) for t in ts] == [j2.command(t) for t in ts]


def test_build_maneuver_unknown():
    with pytest.raises(ValueError):
        build_maneuver({"type": "teleport"})
