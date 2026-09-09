"""Structured per-step telemetry → JSON / CSV / parquet / DataFrame.

The same per-step record powers the live HUD, the post-engagement analysis charts, the
matplotlib render, and the cross-validation fixtures. pandas/pyarrow are optional: CSV
and JSON use only the standard library, so the core has no hard data-stack dependency.
"""

from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class Sample:
    """One physics-step record. All SI; angles in radians."""

    t: float
    # missile state
    x_m: float
    y_m: float
    v_m: float
    gamma_m: float
    # target state
    x_t: float
    y_t: float
    v_t: float
    gamma_t: float
    # relative geometry
    R: float
    lam: float
    lambda_dot: float
    lambda_dot_meas: float
    V_c: float
    t_go: float
    zem_perp: float
    # commands / response
    a_cmd: float       # guidance command (pre-airframe) [m/s^2]
    a_ach: float       # achieved missile accel [m/s^2]
    a_t: float         # target accel [m/s^2]
    g_cmd: float       # a_cmd in g
    g_ach: float       # a_ach in g
    # discrete states
    saturated: bool
    locked: bool
    in_fov: bool
    phase: str


_FLOAT_FIELDS = ("t", "x_m", "y_m", "v_m", "gamma_m", "x_t", "y_t", "v_t", "gamma_t",
                 "R", "lam", "lambda_dot", "lambda_dot_meas", "V_c", "t_go",
                 "zem_perp", "a_cmd", "a_ach", "a_t", "g_cmd", "g_ach")


class Telemetry:
    """An append-only collection of :class:`Sample` rows with export helpers."""

    def __init__(self) -> None:
        self.rows: list[Sample] = []

    def add(self, sample: Sample) -> None:
        self.rows.append(sample)

    def __len__(self) -> int:
        return len(self.rows)

    @property
    def columns(self) -> list[str]:
        return [f.name for f in fields(Sample)]

    def column(self, name: str) -> list[Any]:
        return [getattr(r, name) for r in self.rows]

    def to_records(self) -> list[dict[str, Any]]:
        return [asdict(r) for r in self.rows]

    # ---- exporters ----
    def to_csv(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.columns)
            writer.writeheader()
            for r in self.rows:
                writer.writerow(asdict(r))
        return path

    def to_json(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_records()), encoding="utf-8")
        return path

    def to_dataframe(self):
        try:
            import pandas as pd
        except ImportError as exc:  # pragma: no cover
            raise ImportError("pandas is required for to_dataframe(); pip install zeromiss[data]") from exc
        return pd.DataFrame(self.to_records())

    def to_parquet(self, path: str | Path) -> Path:
        df = self.to_dataframe()
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(path)
        return path

    def downsample(self, every: int) -> Telemetry:
        """Return a thinned copy keeping every ``every``-th row (plus the last)."""
        out = Telemetry()
        if not self.rows:
            return out
        out.rows = self.rows[::every]
        if out.rows[-1] is not self.rows[-1]:
            out.rows.append(self.rows[-1])
        return out
