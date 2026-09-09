"""Guidance laws package — one pure function per law.

Importing this package registers every law in :data:`base.REGISTRY` so that
``get_law("tpn")`` works from anywhere.
"""

from __future__ import annotations

from . import laws  # noqa: F401  (import for side-effect: registers the laws)
from .base import REGISTRY, GuidanceLaw, GuidanceParams, available, get_law, register
from .laws import (
    augmented_pronav,
    optimal_zem,
    pure_pronav,
    pure_pursuit,
    true_pronav,
)

__all__ = [
    "GuidanceLaw",
    "GuidanceParams",
    "REGISTRY",
    "register",
    "get_law",
    "available",
    "pure_pursuit",
    "pure_pronav",
    "true_pronav",
    "augmented_pronav",
    "optimal_zem",
]
