"""Telemetry record + exporter tests."""

import json

import zeromiss.scenarios as S
from zeromiss import Engagement
from zeromiss.scenario import Scenario


def _telem():
    return Engagement(Scenario.from_yaml(S.path("textbook_kill"))).run().telemetry


def test_columns_and_records():
    t = _telem()
    assert "t" in t.columns and "R" in t.columns
    recs = t.to_records()
    assert len(recs) == len(t)
    assert set(t.columns) <= set(recs[0].keys())


def test_to_csv(tmp_path):
    t = _telem()
    p = t.to_csv(tmp_path / "t.csv")
    text = p.read_text(encoding="utf-8")
    assert text.splitlines()[0].startswith("t,")
    assert len(text.splitlines()) == len(t) + 1


def test_to_json(tmp_path):
    t = _telem()
    p = t.to_json(tmp_path / "t.json")
    data = json.loads(p.read_text(encoding="utf-8"))
    assert len(data) == len(t)


def test_to_dataframe_and_parquet(tmp_path):
    t = _telem()
    df = t.to_dataframe()
    assert len(df) == len(t)
    p = t.to_parquet(tmp_path / "t.parquet")
    assert p.exists()


def test_downsample():
    t = _telem()
    d = t.downsample(50)
    assert len(d) <= len(t)
    assert d.rows[-1] is t.rows[-1]
    assert d.column("t")[0] == t.column("t")[0]
