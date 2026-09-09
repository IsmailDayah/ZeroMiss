# Validation (V&V)

ZeroMiss does not ask to be trusted; it reproduces results that are already known and
published, and fails loudly when it stops matching them.
Every check ships three ways: a green assertion (`tests/` + `zeromiss validate`), a
figure (`notebooks/`), and the plain-English paragraph below.

Run it:

```bash
zeromiss validate
```

```
PASS [closed-form] Zero miss (CV target, N>=3)
PASS [closed-form] Heading-error washout
PASS [headline  ] Zarchan step-maneuver curve
PASS [closed-form] APN cancels a step TPN cannot
PASS [numerical ] RK4 order of accuracy
PASS [numerical ] Step-convergence audit
```

## (a) Zero miss on a non-maneuvering target

For ideal PN ($N \ge 3$, no lag/noise) against a constant-velocity target, the terminal
miss → 0: the LOS rate $\dot\lambda$ is driven to zero, and constant bearing ⇒
collision. *Asserted:* `miss < 0.5 m` across a grid of $N \in \{3,4,5\}$ and crossrange
offsets.

## (b) Heading-error washout

An initial heading error (aiming off at launch) contributes **zero** terminal miss for
$N > 2$; the required latax decays toward intercept. *Asserted:* sweep
$HE \in [-45°, 45°]$, `miss < 0.5 m`, and commanded g trends down over the back half.

## (c) The Zarchan step-maneuver curve (the headline)

![Zarchan curve](media/zarchan_curve.png)

With a single first-order autopilot lag $\tau$, a target step maneuver $n_T$ produces a
terminal miss whose normalized form $\text{miss}/(n_T\,\tau^2)$, plotted against
normalized flight time $t_F/\tau$, is a known family parameterized by $N$:

- the curve **rises to a worst-case peak**, then settles;
- **higher $N$ lowers the peak** (more maneuver-tolerant);
- the settled miss scales with $\tau^2$ — *halve the lag, quarter the miss.*

The maneuver is kept small so the engagement stays in the linear regime the published
adjoint analysis assumes. *Asserted:* the N-ordering of the peaks, a non-trivial peak
location, and monotone decay of the $N=3$ tail.

## (d) APN cancels a step TPN cannot

At the worst case of curve (c) — large lag, $t_F/\tau \approx 2$ — the first-order
autopilot leaves TPN several metres short. APN adds the $\tfrac12 N\,a_{T\perp}$
feed-forward and drives the miss back to ~0. *Asserted:* `miss_APN < 0.1 × miss_TPN`
(measured: TPN ≈ 8.1 m, APN ≈ 0.2 m, ratio ≈ 0.024).

## (e) RK4 order of accuracy

A pure turning missile traces a known circular arc. Quartering $dt$ should cut the
closest-approach error ~256× (global error $\sim O(dt^4)$). *Asserted:* the Richardson
ratio exceeds 100 (measured ≈ 255).

## (f) Step-convergence audit

Halving $dt$ on a smooth intercept barely moves the miss (< 0.1 m) — the integration has
converged.

## (g) The two engines agree

The [TypeScript twin](twin.md) reproduces every Python reference run to **< 0.1 %** in
CI. Independent re-implementations agreeing *is* verification.
