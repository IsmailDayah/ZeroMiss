"""Property-based tests across randomized geometries."""

from hypothesis import given, settings
from hypothesis import strategies as st

from zeromiss import Engagement
from zeromiss.scenario import Scenario


def _sc(N, R0, offset, he):
    return Scenario.from_dict({
        "name": "prop", "seed": 0,
        "missile": {"heading": he, "guidance": {"law": "tpn", "N": N},
                    "airframe": {"ideal": True}, "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [R0, offset], "heading": 180,
                   "maneuver": {"type": "constant_velocity"}},
        "termination": {"lethal_radius_m": 5.0, "t_max_s": 30.0},
    })


@settings(max_examples=40, deadline=None)
@given(
    N=st.floats(min_value=3.0, max_value=5.0),
    R0=st.floats(min_value=4000.0, max_value=12000.0),
    offset=st.floats(min_value=-2000.0, max_value=2000.0),
    he=st.floats(min_value=-30.0, max_value=30.0),
)
def test_cv_target_always_hit_ideal(N, R0, offset, he):
    """Ideal PN with N>=3, no lag/noise, always intercepts a constant-velocity target."""
    r = Engagement(_sc(N, R0, offset, he)).run()
    assert r.verdict == "HIT", f"miss={r.miss_distance:.2f} N={N} R0={R0} off={offset} he={he}"


@settings(max_examples=40, deadline=None)
@given(
    N=st.floats(min_value=3.0, max_value=6.0),
    R0=st.floats(min_value=3000.0, max_value=14000.0),
    offset=st.floats(min_value=-3000.0, max_value=3000.0),
)
def test_miss_finite_nonnegative(N, R0, offset):
    r = Engagement(_sc(N, R0, offset, 0.0)).run()
    assert r.miss_distance >= 0.0
    assert r.miss_distance < 1e6
