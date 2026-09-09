"""Scenario schema + YAML loading tests."""

import pytest
from pydantic import ValidationError

import zeromiss.scenarios as S
from zeromiss import Engagement
from zeromiss.scenario import Scenario


def test_defaults_merge():
    # textbook_kill omits missile.speed -> should inherit 1000 from _defaults.yaml
    sc = Scenario.from_yaml(S.path("textbook_kill"))
    assert sc.missile.speed == 1000.0
    assert sc.dynamics.dt == 0.001


@pytest.mark.parametrize("name", S.names())
def test_every_preset_loads_and_runs(name):
    sc = Scenario.from_yaml(S.path(name))
    r = Engagement(sc).run()
    assert r.verdict in ("HIT", "MISS")
    assert len(r.telemetry) > 0


def test_roundtrip_yaml(tmp_path):
    sc = Scenario.from_yaml(S.path("the_weave"))
    p = tmp_path / "rt.yaml"
    sc.to_yaml(p)
    sc2 = Scenario.from_yaml(p)
    assert sc2.missile.guidance.law == sc.missile.guidance.law
    assert sc2.target.maneuver.to_dict()["type"] == "weave"


def test_unknown_field_rejected():
    with pytest.raises(ValidationError):
        Scenario.from_dict({"missile": {"guidance": {"law": "tpn", "bogus": 1}}})
