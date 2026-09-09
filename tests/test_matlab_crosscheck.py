"""Python <-> MATLAB/Octave cross-check.

If Octave (or MATLAB) is on PATH, run the ``.m`` re-implementation and assert it
reproduces the Python core's miss distance. Skips cleanly when neither is installed; the
CI ``cross-language`` job installs Octave and runs this for real, making the V&V
three-way (Python <-> TypeScript <-> MATLAB/Octave).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from zeromiss import Engagement
from zeromiss.scenario import Scenario

MFILE = Path(__file__).resolve().parents[1] / "tools" / "matlab" / "zeromiss_validate.m"

CASES = [
    ("headon_offset", 0, 0, 1000, 0, 8000, 600, 300, 195, 4),
    ("crossing", 0, 0, 1000, 10, 7000, 1500, 350, 200, 4),
    ("tail_high_N", 0, 0, 1000, 0, 9000, -400, 300, 185, 5),
]


def _octave_exe() -> str | None:
    for exe in ("octave-cli", "octave"):
        if shutil.which(exe):
            return exe
    return None


def _py_miss(c) -> float:
    _, xM, yM, VM, gM, xT, yT, VT, gT, N = c
    sc = Scenario.from_dict({
        "name": c[0],
        "missile": {
            "speed": VM, "position": [xM, yM], "heading": gM,
            "guidance": {"law": "tpn", "N": N},
            "airframe": {"ideal": True}, "seeker": {"ideal": True},
        },
        "target": {"speed": VT, "position": [xT, yT], "heading": gT,
                   "maneuver": {"type": "constant_velocity"}},
        "termination": {"lethal_radius_m": 5, "t_max_s": 15},
        "dynamics": {"dt": 0.001},
    })
    return Engagement(sc).run().miss_distance


@pytest.mark.skipif(_octave_exe() is None, reason="Octave/MATLAB not on PATH")
def test_octave_matches_python():
    exe = _octave_exe()
    out = subprocess.run(
        [exe, "--no-gui", "--quiet", str(MFILE)],
        capture_output=True, text=True, timeout=300, check=True,
    ).stdout
    parsed = {}
    for line in out.splitlines():
        if "," in line:
            name, val = line.strip().split(",")
            try:
                parsed[name] = float(val)
            except ValueError:
                pass
    assert parsed, f"no parseable output from Octave:\n{out}"
    for c in CASES:
        assert c[0] in parsed, f"missing case {c[0]} in Octave output"
        py = _py_miss(c)
        assert abs(parsed[c[0]] - py) < 1e-2, f"{c[0]}: Octave={parsed[c[0]]:.6f} Python={py:.6f}"
