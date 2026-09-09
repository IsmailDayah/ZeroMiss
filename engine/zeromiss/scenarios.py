"""Convenience access to the bundled ``scenarios/*.yaml`` presets.

    from zeromiss import scenarios
    scenarios.names()                 # ['bang_bang', 'tail_chase', 'the_weave', ...]
    eng = scenarios.load("the_weave") # -> Engagement

Locates the repo's top-level ``scenarios/`` directory by walking up from this file, so
it works from a source checkout. (When pip-installed without the data dir, pass an
explicit path to :meth:`Engagement.from_yaml` instead.)
"""

from __future__ import annotations

from pathlib import Path

from .scenario import Scenario


def scenarios_dir() -> Path:
    """Find the top-level ``scenarios/`` directory (source checkout)."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        cand = parent / "scenarios"
        if cand.is_dir() and any(cand.glob("*.yaml")):
            return cand
    # default to repo-root guess
    return here.parents[2] / "scenarios"


def names() -> list[str]:
    d = scenarios_dir()
    return sorted(
        p.stem for p in d.glob("*.yaml") if not p.name.startswith("_")
    )


def path(name: str) -> Path:
    d = scenarios_dir()
    p = d / f"{name}.yaml"
    if not p.exists():
        raise FileNotFoundError(f"No scenario {name!r} in {d} (have: {names()})")
    return p


def scenario(name: str) -> Scenario:
    return Scenario.from_yaml(path(name))


def load(name: str):
    """Load a named scenario as a ready-to-run :class:`Engagement`."""
    from .engagement import Engagement

    return Engagement.from_yaml(path(name))
