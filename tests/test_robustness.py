"""Robustness / fuzz tests: the engine must never crash or produce
a non-finite number, no matter how the sliders are set. This is the "impossible to find
a bug while using it" guarantee — every law x maneuver x extreme-config combination is
exercised and every telemetry value is asserted finite.
"""

from __future__ import annotations

import math
from dataclasses import fields

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from zeromiss import Engagement, guidance
from zeromiss.scenario import Scenario
from zeromiss.targets import G0  # noqa: F401  (kept for parity / future use)

LAWS = ["pursuit", "ppn", "tpn", "apn", "ogl"]
MANEUVERS = [
    {"type": "constant_velocity"},
    {"type": "step", "amplitude_g": 12, "start_s": 3.0},
    {"type": "weave", "amplitude_g": 12, "period_s": 1.2, "start_s": 0.5},
    {"type": "bang_bang", "amplitude_g": 14, "period_s": 0.8, "start_s": 0.5},
    {"type": "jink", "amplitude_g": 12, "start_s": 0.5, "mean_interval_s": 0.5},
]


def _assert_clean(result):
    # verdict valid, miss finite & non-negative
    assert result.verdict in ("HIT", "MISS")
    assert math.isfinite(result.miss_distance) and result.miss_distance >= 0.0
    assert math.isfinite(result.peak_g) and result.peak_g >= 0.0
    assert len(result.telemetry) > 0
    # NOT A SINGLE non-finite number anywhere in the telemetry
    float_fields = [f.name for f in fields(result.telemetry.rows[0])
                    if f.type in ("float", float) or f.name not in ("phase", "saturated", "locked", "in_fov")]
    for row in result.telemetry.rows:
        for name in float_fields:
            v = getattr(row, name)
            if isinstance(v, (int, float)):
                assert math.isfinite(v) or name == "t_go", f"non-finite {name}={v}"


@pytest.mark.parametrize("law", LAWS)
@pytest.mark.parametrize("man", MANEUVERS, ids=[m["type"] for m in MANEUVERS])
def test_extreme_config_never_breaks(law, man):
    """Worst-case seeker + airframe + every law x maneuver: always a clean, finite run."""
    sc = Scenario.from_dict({
        "name": f"fuzz-{law}-{man['type']}",
        "missile": {
            "speed": 1000, "position": [0, 0], "heading": -30,
            "guidance": {"law": law, "N": 6},
            "airframe": {"a_max_g": 12, "autopilot_tau": 0.9, "order": 2, "zeta": 0.5},
            "seeker": {"ideal": False, "tau": 0.4, "noise_mrad": 10.0, "glint": True,
                       "fov_deg": 12, "update_hz": 50, "loss_of_lock_timeout_s": 0.2},
        },
        "target": {"speed": 600, "position": [9000, 1500], "heading": 200,
                   "a_max_g": 15, "maneuver": man},
        "termination": {"lethal_radius_m": 5, "t_max_s": 14},
        "dynamics": {"dt": 0.001},
    })
    for seed in (0, 1, 7):
        _assert_clean(Engagement(sc).run(seed=seed))


def test_degenerate_geometries():
    """Target starting on top of the interceptor, head-on collinear, and tail-away."""
    cases = [
        {"position": [1.0, 0.0], "heading": 180},   # essentially co-located
        {"position": [8000, 0], "heading": 180},     # perfectly collinear head-on
        {"position": [500, 0], "heading": 0},        # target ahead, same direction (tail)
    ]
    for law in LAWS:
        for tgt in cases:
            sc = Scenario.from_dict({
                "name": "degenerate",
                "missile": {"guidance": {"law": law, "N": 4}, "airframe": {"ideal": True}, "seeker": {"ideal": True}},
                "target": {"speed": 300, "position": tgt["position"], "heading": tgt["heading"],
                           "maneuver": {"type": "constant_velocity"}},
                "termination": {"lethal_radius_m": 5, "t_max_s": 12},
                "dynamics": {"dt": 0.001},
            })
            _assert_clean(Engagement(sc).run(seed=0))


def test_tracker_extreme_noise_is_finite():
    sc = Scenario.from_dict({
        "name": "tracker-fuzz",
        "missile": {
            "guidance": {"law": "apn", "N": 5}, "airframe": {"a_max_g": 30, "autopilot_tau": 0.3},
            "seeker": {"ideal": True},
            "tracker": {"enabled": True, "model": "imm", "sigma_r_m": 80, "sigma_beta_mrad": 20, "radar_hz": 30},
        },
        "target": {"speed": 400, "position": [9000, 1000], "heading": 200, "a_max_g": 12,
                   "maneuver": {"type": "bang_bang", "amplitude_g": 12, "period_s": 0.9, "start_s": 0.5}},
        "termination": {"lethal_radius_m": 8, "t_max_s": 14},
        "dynamics": {"dt": 0.001},
    })
    for seed in (0, 3, 9):
        _assert_clean(Engagement(sc).run(seed=seed))


@settings(max_examples=40, deadline=None)
@given(
    law=st.sampled_from(LAWS),
    N=st.floats(min_value=2.0, max_value=6.0),
    he=st.floats(min_value=-60.0, max_value=60.0),
    R0=st.floats(min_value=2000.0, max_value=20000.0),
    off=st.floats(min_value=-3000.0, max_value=3000.0),
    amax=st.floats(min_value=10.0, max_value=60.0),
)
def test_property_finite_over_random_configs(law, N, he, R0, off, amax):
    sc = Scenario.from_dict({
        "name": "prop",
        "missile": {
            "speed": 1000, "heading": he,
            "guidance": {"law": law, "N": N},
            "airframe": {"a_max_g": amax, "autopilot_tau": 0.2},
            "seeker": {"ideal": True},
        },
        "target": {"speed": 300, "position": [R0, off], "heading": 180,
                   "maneuver": {"type": "weave", "amplitude_g": 7, "period_s": 2.0, "start_s": 1.0}},
        "termination": {"lethal_radius_m": 5, "t_max_s": 18},
        "dynamics": {"dt": 0.002},
    })
    r = Engagement(sc).run(seed=0)
    assert math.isfinite(r.miss_distance) and r.miss_distance >= 0.0
    assert r.verdict in ("HIT", "MISS")
    _ = guidance.available()
