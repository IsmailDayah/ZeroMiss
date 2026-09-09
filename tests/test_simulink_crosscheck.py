"""Python <-> MATLAB/Simulink cross-check.

If MATLAB is on PATH, build + run the Simulink model (``matlab/build_zeromiss_simulink.m``)
and assert its miss distances match the Python core. Skips cleanly when MATLAB isn't
installed (it's proprietary and cannot run in CI/the sandbox). This is the fourth V&V
leg: Python <-> TypeScript <-> Octave <-> C++ <-> Simulink.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from zeromiss import Engagement
from zeromiss.scenario import Scenario

ROOT = Path(__file__).resolve().parents[1]

CASES = [
    ("headon_offset", 0, 0, 1000, 0, 8000, 600, 300, 195, 4),
    ("crossing", 0, 0, 1000, 10, 7000, 1500, 350, 200, 4),
    ("tail_high_N", 0, 0, 1000, 0, 9000, -400, 300, 185, 5),
]


def _py_miss(c) -> float:
    _, xM, yM, VM, gM, xT, yT, VT, gT, N = c
    sc = Scenario.from_dict({
        "name": c[0],
        "missile": {"speed": VM, "position": [xM, yM], "heading": gM,
                    "guidance": {"law": "tpn", "N": N},
                    "airframe": {"ideal": True}, "seeker": {"ideal": True}},
        "target": {"speed": VT, "position": [xT, yT], "heading": gT,
                   "maneuver": {"type": "constant_velocity"}},
        "termination": {"lethal_radius_m": 5, "t_max_s": 15},
        "dynamics": {"dt": 0.001},
    })
    return Engagement(sc).run().miss_distance


@pytest.mark.skipif(shutil.which("matlab") is None, reason="MATLAB not on PATH")
def test_simulink_matches_python():
    out = subprocess.run(
        ["matlab", "-batch", "addpath('matlab'); build_zeromiss_simulink"],
        cwd=str(ROOT), capture_output=True, text=True, timeout=1800, check=True,
    ).stdout
    parsed = {}
    for line in out.splitlines():
        if "," in line and not line.strip().startswith("saved"):
            name, _, val = line.strip().partition(",")
            try:
                parsed[name] = float(val)
            except ValueError:
                pass
    assert parsed, f"no parseable Simulink output:\n{out}"
    for c in CASES:
        assert c[0] in parsed, f"missing case {c[0]} in Simulink output"
        # Simulink ode4 (fixed-step RK4) vs the Python RK4 — agree within 5 cm
        assert abs(parsed[c[0]] - _py_miss(c)) < 0.05, f"{c[0]}: SL={parsed[c[0]]} Py={_py_miss(c)}"
