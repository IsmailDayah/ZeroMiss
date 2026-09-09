"""Countermeasure (decoy/flare) tests."""

import copy

from zeromiss import Engagement
from zeromiss.scenario import Scenario

# A crossing geometry (non-zero LOS rate) so a decoy can actually pull the seeker off.
BASE = {
    "name": "cm",
    "missile": {
        "speed": 1000, "position": [0, 0], "heading": 0,
        "guidance": {"law": "tpn", "N": 4},
        "airframe": {"a_max_g": 40, "autopilot_tau": 0.2},
        "seeker": {"ideal": False, "tau": 0.05, "noise_mrad": 0, "fov_deg": 80, "update_hz": 100},
    },
    "target": {"speed": 350, "position": [7000, 2600], "heading": 215,
               "maneuver": {"type": "constant_velocity"}},
    "termination": {"lethal_radius_m": 5, "t_max_s": 15},
    "dynamics": {"dt": 0.001},
}


def _run(cm=None, seed=1):
    d = copy.deepcopy(BASE)
    if cm is not None:
        d["target"]["countermeasure"] = cm
    return Engagement(Scenario.from_dict(d)).run(seed=seed)


def test_no_decoy_hits():
    assert _run().verdict == "HIT"


def test_well_timed_terminal_decoy_causes_a_miss():
    base = _run()
    seduced = _run({"enabled": True, "deploy_s": 4.5, "duration_s": 1.5, "decel_per_s": 5.0})
    assert seduced.verdict == "MISS"
    assert seduced.miss_distance > base.miss_distance + 10.0


def test_disabled_countermeasure_is_a_noop():
    base = _run()
    off = _run({"enabled": False, "deploy_s": 4.5, "duration_s": 1.5, "decel_per_s": 5.0})
    assert off.miss_distance == base.miss_distance  # byte-identical when disabled


def test_decoy_is_deterministic():
    cm = {"enabled": True, "deploy_s": 4.5, "duration_s": 1.5, "decel_per_s": 5.0}
    assert _run(cm).miss_distance == _run(cm).miss_distance
