"""Optional-realism tests: induced drag + gravity behind flags."""

import math

from zeromiss import Engagement
from zeromiss.scenario import Scenario

WEAVE = {"type": "weave", "amplitude_g": 9, "period_s": 2.0, "start_s": 1.0}


def _run(dynamics, maneuver=None, seed=1):
    sc = Scenario.from_dict({
        "name": "realism",
        "missile": {"guidance": {"law": "apn", "N": 4},
                    "airframe": {"a_max_g": 40, "autopilot_tau": 0.2}, "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [8000, 500], "heading": 180,
                   "maneuver": maneuver or {"type": "constant_velocity"}},
        "termination": {"lethal_radius_m": 5, "t_max_s": 15},
        "dynamics": dynamics,
    })
    return Engagement(sc).run(seed=seed)


def test_no_realism_keeps_speed_constant():
    r = _run({"dt": 0.001}, WEAVE)
    v = r.telemetry.column("v_m")
    assert all(abs(s - v[0]) < 1e-6 for s in v)  # constant-speed point mass


def test_drag_loses_energy_monotonically():
    """Drag-on runs lose energy monotonically (no gravity)."""
    r = _run({"dt": 0.001, "induced_drag": True, "drag_coeff": 0.02}, WEAVE)
    v = r.telemetry.column("v_m")
    assert v[-1] < v[0]  # the maneuvering missile bled speed to induced drag
    assert all(v[i + 1] <= v[i] + 1e-9 for i in range(len(v) - 1))  # monotone


def test_gravity_runs_finite_and_valid():
    r = _run({"dt": 0.001, "gravity": True}, {"type": "constant_velocity"})
    assert r.verdict in ("HIT", "MISS")
    assert all(math.isfinite(x) for x in r.telemetry.column("v_m"))
    assert all(math.isfinite(x) for x in r.telemetry.column("y_m"))
