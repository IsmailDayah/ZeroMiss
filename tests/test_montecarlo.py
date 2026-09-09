"""Monte-Carlo tests, incl. the vectorized-vs-scalar V&V cross-check."""

import numpy as np
import pytest

from zeromiss import Engagement
from zeromiss import montecarlo as MC
from zeromiss.scenario import Scenario

PRESETS = ["textbook_kill", "the_weave", "step_maneuver"]


def _scn(name):
    import zeromiss.scenarios as S

    sc = Scenario.from_yaml(S.path(name))
    sc.missile.seeker.ideal = True  # noise-free so the two engines must match exactly
    return sc


@pytest.mark.parametrize("name", PRESETS)
def test_vectorized_matches_scalar(name):
    sc = _scn(name)
    scalar = Engagement(sc).run().miss_distance
    vec = MC.run_campaign(sc, runs=1, seed=0, randomize={}, dt=sc.dynamics.dt).miss[0]
    assert abs(scalar - vec) < 1e-3


def test_campaign_statistics_bounds():
    sc = _scn("the_weave")
    camp = MC.run_campaign(sc, runs=500, seed=1)
    assert 0.0 <= camp.Pk <= 1.0
    assert camp.cep >= 0.0
    assert np.all(camp.miss >= 0.0)
    assert camp.runs == 500


def test_evasion_frontier_monotone_ish():
    # Higher target g should not *increase* P_k (weakly decreasing trend).
    sc = _scn("the_weave")
    sweep = MC.sweep_pk(sc, "target_g", [0, 6, 12, 18], runs=400, seed=3)
    pks = [c.Pk for _, c in sweep]
    assert pks[0] >= pks[-1] - 0.05  # tolerate noise


def test_figures_panel(tmp_path):
    sc = _scn("the_weave")
    headline, panel = MC.figures(sc, tmp_path, runs=300, seed=0)
    assert panel.exists()
    assert 0.0 <= headline.Pk <= 1.0


def test_fast_path_rejects_unsupported_maneuver():
    sc = _scn("the_weave")
    sc.target.maneuver = sc.target.maneuver.__class__(type="jink", amplitude_g=9)
    with pytest.raises(ValueError):
        MC.run_campaign(sc, runs=10, seed=0)


def test_fast_path_rejects_unsupported_law():
    sc = _scn("the_weave")
    sc.missile.guidance.law = "teleport"
    with pytest.raises(ValueError):
        MC.run_campaign(sc, runs=10, seed=0)


def test_unsupported_randomize_key_raises():
    sc = _scn("the_weave")
    from zeromiss.scenario import DistSpec
    with pytest.raises(KeyError):
        MC.run_campaign(sc, runs=10, seed=0, randomize={"nonsense.key": DistSpec(dist="uniform", lo=0, hi=1)})
