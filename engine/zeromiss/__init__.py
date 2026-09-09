"""ZeroMiss — a validated missile-guidance interception simulator.

The authoritative physics + guidance engine. The in-browser TypeScript engine in
``web/lib/sim`` is a faithful replica, continuously cross-checked against the
reference runs this package exports (see ``zeromiss export-fixtures``).

Public surface:

    from zeromiss import Engagement, guidance, scenarios
    eng = Engagement.from_yaml("scenarios/the_weave.yaml")
    result = eng.run(seed=42)
    print(result.verdict, result.miss_distance, result.peak_g)
"""

from __future__ import annotations

from . import guidance, scenarios
from .engagement import Engagement, Result
from .frames import Geometry, Kinematic, relative_state
from .scenario import Scenario

__all__ = [
    "Engagement",
    "Result",
    "Geometry",
    "Kinematic",
    "relative_state",
    "Scenario",
    "guidance",
    "scenarios",
]

__version__ = "0.1.0"
