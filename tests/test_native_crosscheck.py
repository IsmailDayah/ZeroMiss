"""Python <-> C++ cross-check.

If the pybind11 extension has been built (``python native/setup_native.py build_ext
--inplace``), assert the C++ hot loop reproduces the Python core's miss distance to
machine tolerance. Skips cleanly when the extension isn't built (no compiler locally);
the CI ``cross-language`` job builds it on ubuntu and runs this for real.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from zeromiss import Engagement
from zeromiss.scenario import Scenario

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))

try:
    import zeromiss_native  # type: ignore
    HAVE_NATIVE = True
except ImportError:
    HAVE_NATIVE = False

# (name, xM,yM,VM,gM_deg, xT,yT,VT,gT_deg, N) — identical to the .m + C++ cases
CASES = [
    ("headon_offset", 0, 0, 1000, 0, 8000, 600, 300, 195, 4),
    ("crossing", 0, 0, 1000, 10, 7000, 1500, 350, 200, 4),
    ("tail_high_N", 0, 0, 1000, 0, 9000, -400, 300, 185, 5),
]


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


@pytest.mark.skipif(not HAVE_NATIVE, reason="C++ extension not built (run native/setup_native.py)")
@pytest.mark.parametrize("c", CASES, ids=[c[0] for c in CASES])
def test_cpp_matches_python(c):
    py = _py_miss(c)
    cpp = zeromiss_native.run_tpn_cv(
        float(c[1]), float(c[2]), float(c[3]), float(c[4]),
        float(c[5]), float(c[6]), float(c[7]), float(c[8]),
        float(c[9]), 0.001, 15.0,
    )
    assert abs(cpp - py) < 1e-3, f"{c[0]}: C++={cpp:.6f} Python={py:.6f}"
