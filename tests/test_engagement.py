"""Engagement-loop tests: miss distance, determinism, hit/miss."""


from zeromiss import Engagement
from zeromiss.scenario import Scenario


def _sc(**over):
    d = {
        "name": "t", "seed": 0,
        "missile": {"guidance": {"law": over.pop("law", "tpn"), "N": over.pop("N", 4.0)},
                    "airframe": over.pop("airframe", {"ideal": True}),
                    "seeker": {"ideal": True},
                    "heading": over.pop("heading", 0.0)},
        "target": {"speed": 300, "position": over.pop("tpos", [8000, 0]),
                   "heading": over.pop("theading", 180),
                   "maneuver": over.pop("maneuver", {"type": "constant_velocity"})},
        "termination": {"lethal_radius_m": over.pop("Rk", 5.0), "t_max_s": 15.0},
    }
    assert not over, over
    return Scenario.from_dict(d)


def test_miss_near_zero_cv_target():
    r = Engagement(_sc(N=4.0, tpos=[8000, 800], theading=190)).run()
    assert r.miss_distance < 0.5
    assert r.verdict == "HIT"


def test_determinism_same_seed_same_result():
    sc = _sc(N=4.0, tpos=[8000, 500], theading=190,
             maneuver={"type": "weave", "amplitude_g": 6, "period_s": 2.0, "start_s": 1.0})
    r1 = Engagement(sc).run(seed=42)
    r2 = Engagement(sc).run(seed=42)
    assert r1.miss_distance == r2.miss_distance
    assert r1.verdict == r2.verdict
    assert len(r1.telemetry) == len(r2.telemetry)


def test_miss_distance_nonnegative_and_finite():
    r = Engagement(_sc(law="pursuit", N=5.0, tpos=[6000, 2500], theading=200)).run()
    assert r.miss_distance >= 0.0
    assert r.miss_distance < 1e6


def test_lethal_radius_decides_verdict():
    sc_hit = _sc(N=4.0, tpos=[8000, 800], theading=190, Rk=5.0)
    sc_miss = _sc(law="pursuit", N=5.0, tpos=[6000, 2500], theading=200, Rk=1.0)
    assert Engagement(sc_hit).run().verdict == "HIT"
    assert Engagement(sc_miss).run().verdict == "MISS"


def test_peak_g_bounded_by_airframe():
    sc = _sc(N=5.0, airframe={"ideal": False, "a_max_g": 30, "autopilot_tau": 0.2},
             tpos=[8000, 500], theading=180,
             maneuver={"type": "weave", "amplitude_g": 9, "period_s": 2.0, "start_s": 1.0})
    r = Engagement(sc).run()
    assert r.peak_g <= 30.0 + 1e-6


def test_higher_N_tightens_intercept():
    base = dict(tpos=[8000, 500], theading=180,
                maneuver={"type": "weave", "amplitude_g": 6, "period_s": 2.0, "start_s": 1.0},
                airframe={"ideal": False, "a_max_g": 60, "autopilot_tau": 0.2})
    m3 = Engagement(_sc(N=3.0, **base)).run().miss_distance
    m5 = Engagement(_sc(N=5.0, **base)).run().miss_distance
    assert m5 <= m3 + 1e-6
