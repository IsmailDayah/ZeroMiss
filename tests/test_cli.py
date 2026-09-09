"""CLI tests via Typer's CliRunner."""

from typer.testing import CliRunner

from zeromiss.cli import app

runner = CliRunner()


def test_list():
    res = runner.invoke(app, ["list"])
    assert res.exit_code == 0
    assert "the_weave" in res.stdout


def test_validate():
    res = runner.invoke(app, ["validate"])
    assert res.exit_code == 0
    assert "passed" in res.stdout.lower()


def test_run_preset_with_artifacts(tmp_path):
    res = runner.invoke(app, [
        "run", "textbook_kill", "--seed", "7", "--csv", "--plot", "--out", str(tmp_path),
    ])
    assert res.exit_code == 0
    assert "HIT" in res.stdout
    assert (tmp_path / "textbook_kill.csv").exists()
    assert (tmp_path / "textbook_kill.png").exists()


def test_run_bad_scenario():
    res = runner.invoke(app, ["run", "does_not_exist"])
    assert res.exit_code != 0


def test_compare():
    res = runner.invoke(app, ["compare", "the_weave", "--law", "tpn", "--law", "apn"])
    assert res.exit_code == 0
    assert "TPN" in res.stdout and "APN" in res.stdout


def test_export_fixtures(tmp_path):
    res = runner.invoke(app, ["export-fixtures", "--out", str(tmp_path)])
    assert res.exit_code == 0
    assert (tmp_path / "index.json").exists()


def test_montecarlo_small(tmp_path):
    res = runner.invoke(app, ["montecarlo", "textbook_kill", "--runs", "200", "--out", str(tmp_path)])
    assert res.exit_code == 0
    assert "P_k" in res.stdout
