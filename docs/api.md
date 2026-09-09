# API & CLI

## Library

```python
from zeromiss import Engagement, guidance, scenarios
from zeromiss.scenario import Scenario

# from a bundled preset...
eng = Engagement.from_yaml(scenarios.path("the_weave"))
result = eng.run(seed=42)
print(result.verdict, result.miss_distance, result.peak_g)   # HIT 1.52 30.x

# ...or build a scenario programmatically
sc = Scenario.from_dict({
    "name": "custom",
    "missile": {"guidance": {"law": "apn", "N": 4}},
    "target":  {"position": [9000, 600], "maneuver": {"type": "weave", "amplitude_g": 8}},
})
r = Engagement(sc).run(seed=7)

# artifacts
r.to_gif("weave.gif")
r.telemetry.to_csv("weave.csv")
r.telemetry.to_parquet("weave.parquet")
```

### Key types

| Symbol | Module | What it is |
|---|---|---|
| `relative_state(missile, target) -> Geometry` | `frames` | pure LOS geometry (R, λ, λ̇, V_c, t_go, ZEM⊥) |
| `GuidanceLaw = (Geometry, GuidanceParams) -> float` | `guidance.base` | the one law contract |
| `get_law(name)` / `available()` | `guidance` | registry lookup (`pursuit/ppn/tpn/apn/ogl`) |
| `Seeker.measure(g, dt, rng) -> SeekerOut` | `seeker` | measured LOS rate (lag/noise/FOV) |
| `Airframe.respond(a_cmd, dt) -> float` | `airframe` | achieved accel (lag + g-limit) |
| `Engagement.run(seed) -> Result` | `engagement` | the orchestrator |
| `run_campaign(scenario, runs, seed) -> Campaign` | `montecarlo` | vectorised P_k / CEP campaign |
| `validation.run_all() -> list[Case]` | `validation` | the V&V suite |

### Determinism rule

*All* randomness comes from the single `numpy.random.Generator(seed)` threaded through
`run()`. No module calls a global RNG. This is what makes "same seed → identical run, in
both engines" true rather than aspirational.

## CLI (Typer)

```bash
zeromiss list                        # the bundled preset gallery

zeromiss run <scenario> [options]
  --seed N            override the scenario seed
  --gif / --mp4       render an animation
  --plot / --panel    static trajectory PNG / post-engagement analysis panel
  --csv               export telemetry to CSV
  --out DIR           artifact directory (default: reports/)

zeromiss compare <scenario> --law tpn --law apn   # repeatable --law
zeromiss montecarlo <scenario> --runs 50000 --out reports/
zeromiss validate                    # the whole validation suite -> a pass/fail table
zeromiss export-fixtures --out web/fixtures
```

`<scenario>` is either a path to a YAML file or a bundled preset name
(`the_weave`, `tail_chase`, `textbook_kill`, `step_maneuver`, `bang_bang`,
`break_lock`, `jink`, `duel`).
