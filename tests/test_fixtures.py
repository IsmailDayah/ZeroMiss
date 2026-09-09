"""Fixture export tests."""

import json

from zeromiss.fixtures import FIXTURE_SCENARIOS, build_fixture, export_fixtures


def test_build_fixture_structure():
    name = next(iter(FIXTURE_SCENARIOS))
    rec = build_fixture(name, FIXTURE_SCENARIOS[name], n_samples=50)
    assert rec["columns"][0] == "t"
    assert len(rec["states"]) > 1
    assert rec["result"]["verdict"] in ("HIT", "MISS")
    # every state row matches the column count
    assert all(len(row) == len(rec["columns"]) for row in rec["states"])


def test_export_all(tmp_path):
    export_fixtures(tmp_path, n_samples=40)
    assert (tmp_path / "index.json").exists()
    index = json.loads((tmp_path / "index.json").read_text())
    assert len(index) == len(FIXTURE_SCENARIOS)
    for entry in index:
        assert (tmp_path / entry["file"]).exists()


def test_fixtures_are_deterministic():
    name = "weave_apn"
    a = build_fixture(name, FIXTURE_SCENARIOS[name], n_samples=30)
    b = build_fixture(name, FIXTURE_SCENARIOS[name], n_samples=30)
    assert a["result"] == b["result"]
    assert a["states"] == b["states"]
