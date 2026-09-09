# The guidance laws

Every law is the *same* tiny pure function `a_cmd = law(geometry, params)`. Shipping
several side by side makes them directly comparable on identical geometry. Source: [`engine/zeromiss/guidance/laws.py`](api.md).

| Law | Command | Teaches |
|---|---|---|
| **Pure Pursuit** | $a = N\,V_M\,(\lambda - \gamma_M)$ | the *naive* method — curves in behind, arrives late (the tail chase). |
| **Pure ProNav (PPN)** | $a = N\,V_M\,\dot\lambda$ | the classic; turn ∝ LOS rate (⟂ to missile velocity). |
| **True ProNav (TPN)** | $a = N\,V_c\,\dot\lambda$ | the closing-velocity form (⟂ to LOS); cleaner geometry. |
| **Augmented ProNav (APN)** | $a = N\,V_c\,\dot\lambda + \tfrac12 N\,a_{T\perp}$ | adds the *target maneuver* term — crushes weaving/stepping targets. |
| **Optimal / ZEM (OGL)** | $a = N\,\mathrm{ZEM}_\perp / t_{go}^2$ | the modern view: null the Zero-Effort-Miss vector. |

The navigation constant $N \in [3, 5]$ typically.

## The identity worth knowing

With the maneuver term included, **OGL reduces algebraically to APN**:

$$
\frac{N\,\mathrm{ZEM}_\perp}{t_{go}^2}
= \frac{N\big(R\,\dot\lambda\,t_{go} + \tfrac12 a_{T\perp} t_{go}^2\big)}{t_{go}^2}
= N\,V_c\,\dot\lambda + \tfrac12 N\,a_{T\perp}
$$

since $R/t_{go} = V_c$. This is asserted as a unit test — a small but satisfying proof
that the two derivations agree.

## The no-free-lunch lesson

Raise $N$ and intercepts tighten and tolerate harder target maneuvers — *but* commanded
g and noise sensitivity climb. Compare mode and the Monte-Carlo **P_k vs N** study let
you find the knee of that trade-off yourself.

## The contract

```python
GuidanceLaw = Callable[[Geometry, GuidanceParams], float]   # returns a_cmd (m/s², ⟂)

@register("tpn")
def true_pronav(g: Geometry, p: GuidanceParams) -> float:
    return p.N * g.V_c * g.lambda_dot
```

Because every law shares this signature, adding a law, unit-testing it on hand-computed
geometry, and A/B-ing two laws in Compare mode are all trivial.
