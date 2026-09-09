"""Declarative scenario schema — Pydantic v2 models + YAML I/O.

One engagement is one validated YAML file. The *same* schema drives the CLI, the
library, the browser presets, and the Monte-Carlo campaign — one source of truth for a
scenario, everywhere. Each model also knows how to produce the engine's plain config
dataclasses, keeping the runtime decoupled from the wire format.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .airframe import AirframeConfig
from .dynamics import DynamicsConfig
from .frames import Kinematic, deg2rad
from .guidance.base import GuidanceParams
from .seeker import SeekerConfig
from .tracker import TrackerConfig


class GuidanceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    law: str = "tpn"
    N: float = 4.0
    use_target_accel: bool = True

    def to_params(self) -> GuidanceParams:
        return GuidanceParams(N=self.N, use_target_accel=self.use_target_accel)


class AirframeSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ideal: bool = False
    a_max_g: float = 40.0
    autopilot_tau: float = 0.2
    order: int = 1
    zeta: float = 0.7

    def to_config(self) -> AirframeConfig:
        return AirframeConfig(
            ideal=self.ideal,
            a_max_g=self.a_max_g,
            autopilot_tau=self.autopilot_tau,
            order=self.order,
            zeta=self.zeta,
        )


class SeekerSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ideal: bool = True
    tau: float = 0.1
    noise_mrad: float = 1.0
    glint: bool = False
    glint_ref_m: float = 1000.0
    glint_gain_mrad: float = 2.0
    fov_deg: float = 30.0
    update_hz: float = 100.0
    loss_of_lock_timeout_s: float = 0.5

    def to_config(self) -> SeekerConfig:
        return SeekerConfig(
            ideal=self.ideal,
            tau=self.tau,
            noise_mrad=self.noise_mrad,
            glint=self.glint,
            glint_ref_m=self.glint_ref_m,
            glint_gain_mrad=self.glint_gain_mrad,
            fov_deg=self.fov_deg,
            update_hz=self.update_hz,
            loss_of_lock_timeout_s=self.loss_of_lock_timeout_s,
        )


class TrackerSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    model: str = "imm"  # "ekf" | "imm"
    sigma_r_m: float = 20.0
    sigma_beta_mrad: float = 5.0
    radar_hz: float = 50.0
    q: float = 50.0
    q_quiet: float = 5.0
    q_maneuver: float = 5000.0

    def to_config(self) -> TrackerConfig:
        return TrackerConfig(
            enabled=self.enabled,
            model=self.model,
            sigma_r_m=self.sigma_r_m,
            sigma_beta_mrad=self.sigma_beta_mrad,
            radar_hz=self.radar_hz,
            q=self.q,
            q_quiet=self.q_quiet,
            q_maneuver=self.q_maneuver,
        )


class MissileSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speed: float = 1000.0
    position: tuple[float, float] = (0.0, 0.0)
    heading: float = 0.0  # degrees
    guidance: GuidanceSpec = Field(default_factory=GuidanceSpec)
    airframe: AirframeSpec = Field(default_factory=AirframeSpec)
    seeker: SeekerSpec = Field(default_factory=SeekerSpec)
    tracker: TrackerSpec = Field(default_factory=TrackerSpec)

    def kinematic(self) -> Kinematic:
        return Kinematic(self.position[0], self.position[1], self.speed, deg2rad(self.heading))


class ManeuverSpec(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str = "constant_velocity"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type}
        d.update(self.__pydantic_extra__ or {})
        return d


class CountermeasureSpec(BaseModel):
    """A decoy/flare the target deploys to seduce the seeker."""

    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    type: str = "decoy"
    deploy_s: float = 5.0      # when the target releases the decoy
    duration_s: float = 1.5    # how long the seeker tracks the decoy before re-acquiring
    decel_per_s: float = 1.0   # decoy velocity decay rate (flares slow rapidly)


class TargetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speed: float = 300.0
    position: tuple[float, float] = (8000.0, 0.0)
    heading: float = 180.0  # degrees
    a_max_g: float = 9.0
    maneuver: ManeuverSpec = Field(default_factory=ManeuverSpec)
    countermeasure: CountermeasureSpec = Field(default_factory=CountermeasureSpec)

    def kinematic(self) -> Kinematic:
        return Kinematic(self.position[0], self.position[1], self.speed, deg2rad(self.heading))


class TerminationSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lethal_radius_m: float = 5.0
    t_max_s: float = 15.0


class DynamicsSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dt: float = 0.001
    induced_drag: bool = False
    drag_coeff: float = 0.0
    gravity: bool = False
    gravity_value: float = 9.80665

    def to_config(self) -> DynamicsConfig:
        return DynamicsConfig(
            induced_drag=self.induced_drag,
            drag_coeff=self.drag_coeff,
            gravity=self.gravity,
            gravity_value=self.gravity_value,
        )


class DistSpec(BaseModel):
    """A randomisation distribution for one parameter."""

    model_config = ConfigDict(extra="forbid")
    dist: str = "uniform"
    lo: float | None = None
    hi: float | None = None
    mu: float | None = None
    sigma: float | None = None
    values: list[Any] | None = None

    def sample(self, rng) -> Any:
        d = self.dist.lower()
        if d == "uniform":
            return float(rng.uniform(self.lo, self.hi))
        if d == "normal":
            return float(rng.normal(self.mu, self.sigma))
        if d == "loguniform":
            lo, hi = math.log(self.lo), math.log(self.hi)
            return float(math.exp(rng.uniform(lo, hi)))
        if d == "choice":
            idx = int(rng.integers(0, len(self.values)))
            return self.values[idx]
        raise ValueError(f"Unknown distribution {self.dist!r}")


class MonteCarloSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    runs: int = 10000
    randomize: dict[str, DistSpec] = Field(default_factory=dict)


class Scenario(BaseModel):
    """A complete, validated engagement definition."""

    model_config = ConfigDict(extra="forbid")
    name: str = "Untitled Engagement"
    description: str = ""
    seed: int | None = None
    missile: MissileSpec = Field(default_factory=MissileSpec)
    target: TargetSpec = Field(default_factory=TargetSpec)
    termination: TerminationSpec = Field(default_factory=TerminationSpec)
    dynamics: DynamicsSpec = Field(default_factory=DynamicsSpec)
    montecarlo: MonteCarloSpec | None = None

    # ---- I/O ----
    @classmethod
    def from_yaml(cls, path: str | Path) -> Scenario:
        path = Path(path)
        data = _load_with_defaults(path)
        return cls.model_validate(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Scenario:
        return cls.model_validate(data)

    def to_yaml(self, path: str | Path) -> None:
        Path(path).write_text(
            yaml.safe_dump(self.model_dump(mode="json"), sort_keys=False),
            encoding="utf-8",
        )

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


def _deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _load_with_defaults(path: Path) -> dict[str, Any]:
    """Load a scenario YAML, deep-merging ``_defaults.yaml`` from the same dir if present."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    defaults_path = path.parent / "_defaults.yaml"
    if defaults_path.exists() and path.name != "_defaults.yaml":
        defaults = yaml.safe_load(defaults_path.read_text(encoding="utf-8")) or {}
        return _deep_merge(defaults, raw)
    return raw
