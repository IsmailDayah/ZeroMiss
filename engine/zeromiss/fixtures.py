"""Export Python reference runs as JSON fixtures for the TypeScript twin.

Each fixture is a deterministic, **ideal-seeker, noise-free** engagement (no RNG
dependence) so the TS engine can reproduce it without matching Python's random number
generator. The cross-validation harness (``web/lib/crossval``) loads these, runs the
same scenario through the TS engine, and asserts per-step agreement < 0.1 %.

A fixture stores the scenario, a downsampled state history, and the final verdict.
"""

from __future__ import annotations

import json
from pathlib import Path

from .engagement import Engagement
from .scenario import Scenario

# A battery covering every guidance law and the deterministic target models.
# All use an ideal, noise-free seeker so the twin can reproduce them exactly.
FIXTURE_SCENARIOS: dict[str, dict] = {
    "cv_tpn_headon": {
        "name": "CV head-on (TPN)",
        "missile": {"guidance": {"law": "tpn", "N": 4}, "airframe": {"ideal": True},
                    "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [8000, 600], "heading": 195,
                   "maneuver": {"type": "constant_velocity"}},
    },
    "cv_ppn": {
        "name": "CV crossing (PPN)",
        "missile": {"heading": 10, "guidance": {"law": "ppn", "N": 4},
                    "airframe": {"a_max_g": 40, "autopilot_tau": 0.15}, "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [8000, 1500], "heading": 200,
                   "maneuver": {"type": "constant_velocity"}},
    },
    "pursuit_tail": {
        "name": "Tail chase (pursuit)",
        "missile": {"heading": 20, "guidance": {"law": "pursuit", "N": 5},
                    "airframe": {"a_max_g": 40, "autopilot_tau": 0.15}, "seeker": {"ideal": True}},
        "target": {"speed": 350, "position": [6000, 2500], "heading": 200,
                   "maneuver": {"type": "constant_velocity"}},
        "termination": {"lethal_radius_m": 5, "t_max_s": 20},
    },
    "step_tpn": {
        "name": "Step maneuver (TPN)",
        "missile": {"guidance": {"law": "tpn", "N": 4},
                    "airframe": {"a_max_g": 40, "autopilot_tau": 0.2}, "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [8000, 0], "heading": 180, "a_max_g": 12,
                   "maneuver": {"type": "step", "amplitude_g": 9, "start_s": 4.0}},
    },
    "weave_apn": {
        "name": "Weave (APN)",
        "missile": {"guidance": {"law": "apn", "N": 4},
                    "airframe": {"a_max_g": 40, "autopilot_tau": 0.2}, "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [8000, 500], "heading": 180, "a_max_g": 9,
                   "maneuver": {"type": "weave", "amplitude_g": 9, "period_s": 2.0, "start_s": 1.0}},
    },
    "weave_ogl": {
        "name": "Weave (ZEM/OGL)",
        "missile": {"guidance": {"law": "ogl", "N": 4},
                    "airframe": {"a_max_g": 40, "autopilot_tau": 0.2}, "seeker": {"ideal": True}},
        "target": {"speed": 300, "position": [8000, 500], "heading": 180, "a_max_g": 9,
                   "maneuver": {"type": "weave", "amplitude_g": 9, "period_s": 2.0, "start_s": 1.0}},
    },
    "bangbang_apn": {
        "name": "Bang-bang (APN)",
        "missile": {"guidance": {"law": "apn", "N": 5},
                    "airframe": {"a_max_g": 45, "autopilot_tau": 0.15}, "seeker": {"ideal": True}},
        "target": {"speed": 350, "position": [9000, 0], "heading": 180, "a_max_g": 12,
                   "maneuver": {"type": "bang_bang", "amplitude_g": 12, "period_s": 1.5, "start_s": 1.0}},
        "termination": {"lethal_radius_m": 6, "t_max_s": 16},
    },
}


def _state_row(s) -> list[float]:
    return [round(v, 6) for v in s]


def build_fixture(name: str, spec: dict, n_samples: int = 200) -> dict:
    """Run one fixture scenario and return the serialisable record."""
    scenario = Scenario.from_dict({"name": spec.get("name", name), "seed": 0, **{
        k: v for k, v in spec.items() if k != "name"
    }})
    result = Engagement(scenario).run(seed=0)
    t = result.telemetry
    n = len(t.rows)
    step = max(1, n // n_samples)
    idx = list(range(0, n, step))
    if idx[-1] != n - 1:
        idx.append(n - 1)

    states = []
    for i in idx:
        r = t.rows[i]
        states.append([
            round(r.t, 6), round(r.x_m, 4), round(r.y_m, 4), round(r.gamma_m, 8),
            round(r.x_t, 4), round(r.y_t, 4), round(r.gamma_t, 8),
            round(r.a_ach, 4), round(r.R, 4), round(r.lambda_dot, 10),
        ])

    return {
        "name": scenario.name,
        "scenario": scenario.to_dict(),
        "dt": scenario.dynamics.dt,
        "columns": ["t", "x_m", "y_m", "gamma_m", "x_t", "y_t", "gamma_t", "a_ach", "R", "lambda_dot"],
        "states": states,
        "result": {
            "verdict": result.verdict,
            "miss_distance": round(result.miss_distance, 6),
            "t_flight": round(result.t_flight, 6),
            "peak_g": round(result.peak_g, 6),
        },
    }


def export_fixtures(out_dir: str | Path = "fixtures", n_samples: int = 200) -> list[Path]:
    """Regenerate every fixture into ``out_dir`` and an index. Returns written paths."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    index = []
    for name, spec in FIXTURE_SCENARIOS.items():
        rec = build_fixture(name, spec, n_samples=n_samples)
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(rec, indent=0), encoding="utf-8")
        written.append(path)
        index.append({
            "id": name, "name": rec["name"], "file": f"{name}.json",
            "verdict": rec["result"]["verdict"], "miss": rec["result"]["miss_distance"],
        })
    (out_dir / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    written.append(out_dir / "index.json")
    return written


if __name__ == "__main__":  # pragma: no cover
    for p in export_fixtures():
        print("wrote", p)
