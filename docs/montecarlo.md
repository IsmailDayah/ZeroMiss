# Monte Carlo & probability of kill

A single engagement is an anecdote; a thousand is engineering.

![Monte Carlo panel](media/mc/montecarlo_panel.png)

## The campaign

Randomize initial range, heading error, target-maneuver timing/magnitude, and seeker
noise — all from declared distributions in the scenario YAML's `montecarlo` block:

```yaml
montecarlo:
  runs: 50000
  randomize:
    R0:                { dist: uniform, lo: 6000, hi: 10000 }
    HE_deg:            { dist: normal,  mu: 0, sigma: 10 }
    weave.start_s:     { dist: uniform, lo: 0.5, hi: 2.5 }
    seeker.noise_mrad: { dist: uniform, lo: 0.5, hi: 3.0 }
```

```bash
zeromiss montecarlo scenarios/the_weave.yaml --runs 50000 --out reports/
```

## Speed: vectorised over the batch

The inner loop is **NumPy-vectorised over the batch dimension** — every sample advances
simultaneously — so 10k–100k engagements run in seconds with no backend. The vectorised
step mirrors the scalar engine's equations exactly; a unit test cross-checks that the two
agree to machine precision on ideal runs (independent re-implementation = verification,
again).

## The metrics

- **P_k** (probability of kill) = fraction with `miss ≤ R_k`.
- **CEP** (Circular Error Probable) = the median miss distance.
- The full **miss-distance histogram** and the **peak-g distribution**.

## The trade-off studies

- **P_k vs N** — finds the optimal navigation constant for a given threat.
- **The evasion frontier (P_k vs target g)** — how hard must the target maneuver to
  survive?
- **Peak-g distribution** — how often the airframe saturates.
- **Miss vs seeker noise / autopilot lag** — sensitivity surfaces (sweep those keys).

```python
from zeromiss import scenarios
from zeromiss.montecarlo import run_campaign, sweep_pk

sc = scenarios.scenario("the_weave")
camp = run_campaign(sc, runs=50000, seed=0)
print(camp.summary())                       # P_k, CEP, mean miss, peak-g

pk_vs_N = sweep_pk(sc, "N", [2, 3, 4, 5, 6], runs=5000)
```
