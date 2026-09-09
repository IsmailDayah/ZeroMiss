# References & Learning Resources (all public)

Every guidance law and validation case in this project comes from the open literature
below (see [Ethics & export posture](ethics.md)).

## Primary sources

- **Zarchan, P.** *Tactical and Strategic Missile Guidance* (AIAA Progress in
  Astronautics & Aeronautics). The primary source; the step-maneuver miss curves
  and the adjoint method come from here.
- **Palumbo, N. F., Blauwkamp, R. A., & Lloyd, J. M.** *"Basic Principles of Homing
  Guidance"* and *"Modern Homing Missile Guidance Theory and Techniques."* **Johns
  Hopkins APL Technical Digest, Vol. 29, No. 1 (2010)** — free public PDFs; the single
  best free starting point for PN, TPN, APN, and ZEM/optimal guidance.
- **Siouris, G. M.** *Missile Guidance and Control Systems* (Springer).
- **Shneydor, N. A.** *Missile Guidance and Pursuit: Kinematics, Dynamics and Control.*
- **Yanushevsky, R.** *Modern Missile Guidance.*
- **Ben-Asher, J. Z., & Yaesh, I.** *Advances in Missile Guidance Theory* (AIAA).

## Validation-case → source map

Each automated check in [`engine/zeromiss/validation.py`](https://github.com/IsmailDayah/ZeroMiss/blob/main/engine/zeromiss/validation.py)
maps to a standard, public result, so the work can be checked against the textbook.

| Validation case | What it asserts | Source |
|---|---|---|
| `case_zero_miss` | Ideal PN nulls the LOS rate ⇒ miss → 0 for `N ≥ 3` against a constant-velocity target. | Zarchan Ch. 2–4; APL Digest §"Basic Principles". |
| `case_heading_error_washout` | An initial heading error contributes zero terminal miss for `N > 2`; required latax decays. | Zarchan, heading-error adjoint. |
| `case_zarchan_curve` | The dimensionless step-maneuver miss `miss/(n_T·τ²)` vs `t_F/τ`: rises to a worst-case peak, higher `N` lowers it, settled miss ∝ `τ²`. | Zarchan, step-maneuver adjoint curves. |
| `case_apn_beats_tpn` | APN's `½N·a_T⊥` feed-forward cancels the lag-induced step miss TPN leaves. | Zarchan, APN derivation; APL Digest §"Modern Homing". |
| `case_rk4_order` | RK4 global error ~ `O(dt⁴)` (quarter `dt` ⇒ ~256× less error). | Any numerical-methods text (Richardson extrapolation). |
| `case_step_convergence` | Halving `dt` barely moves the miss — the integration has converged. | Standard step-size audit. |

## On notation

- `λ` line-of-sight angle, `λ̇` its rate; `V_c` closing velocity; `t_go` time-to-go;
  `N` navigation constant; `n_T` target maneuver acceleration; `τ` autopilot time
  constant. These follow Zarchan's conventions.
- The Zarchan abscissa here uses a **single first-order lag** `τ`; the worst-case peak
  location depends on the exact lag model, so the *shape* and *N-ordering* are the
  invariants this project pins.
