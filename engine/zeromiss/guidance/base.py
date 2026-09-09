"""The single guidance-law contract.

Every law is the *same* tiny pure function::

    GuidanceLaw = Callable[[Geometry, GuidanceParams], float]   # -> a_cmd [m/s^2, perp]

Because every law shares this signature, adding a law, unit-testing it on
hand-computed geometry, and A/B-ing two laws in Compare mode are all trivial. The
positive sign convention: a returned ``a_cmd > 0`` turns the missile velocity CCW.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from ..frames import Geometry

GuidanceLaw = Callable[["Geometry", "GuidanceParams"], float]


@dataclass(frozen=True, slots=True)
class GuidanceParams:
    """Tuning for a guidance law.

    Attributes
    ----------
    N : float
        Navigation constant / gain (typically 3-5; the "aggressiveness" dial).
    use_target_accel : bool
        Whether augmented laws may use the (estimated) target lateral accel term.
    """

    N: float = 4.0
    use_target_accel: bool = True


# Populated by the @register decorator in the individual law modules.
REGISTRY: dict[str, GuidanceLaw] = {}


def register(name: str) -> Callable[[GuidanceLaw], GuidanceLaw]:
    """Decorator that registers a law under a short name (e.g. ``"tpn"``)."""

    def deco(fn: GuidanceLaw) -> GuidanceLaw:
        REGISTRY[name] = fn
        fn.law_name = name  # type: ignore[attr-defined]
        return fn

    return deco


def get_law(name: str) -> GuidanceLaw:
    """Look up a registered law by name; raise a helpful error if unknown."""
    key = name.lower().strip()
    if key not in REGISTRY:
        raise KeyError(
            f"Unknown guidance law {name!r}. Available: {sorted(REGISTRY)}"
        )
    return REGISTRY[key]


def available() -> list[str]:
    return sorted(REGISTRY)
