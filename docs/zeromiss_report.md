# ZeroMiss — Engineering Report

*A short design-review deliverable: model → validation → Monte-Carlo results → next
steps. Written as the kind of report you'd circulate before a design review, not an
academic paper.*

---

## 1. Problem & scope

Build a credible, demonstrable interception simulator for the **terminal homing** phase
of a planar (3-DOF) engagement, covering the guidance-law family used across the field
(pure pursuit, PPN, TPN, APN, ZEM-optimal), with realistic sensor and actuator
imperfections, validated against published results, and packaged so a non-specialist can
*see* it and a specialist can *trust* it.

**Out of scope, by design (see `ETHICS.md`):** propulsion, mass/thrust, warhead/fuze,
real seeker hardware, and any real platform or threat parameters. The interceptor is an
idealized constant-speed point mass that can only turn; lethality is a single abstract
radius. Everything is public-domain textbook mathematics.

## 2. Model

| Element | Model | Key parameters |
|---|---|---|
| Kinematics | constant-speed planar point mass; lateral accel turns the velocity | $V_M, V_T, \gamma$ |
| Integrator | fixed-step classical RK4 @ 1 kHz | $dt = 10^{-3}$ s |
| Guidance | $a = N V_c \dot\lambda$ (TPN) and the rest of the family | $N \in [2,6]$ |
| Seeker | first-order LOS-rate lag + angular noise (+glint) + FOV/loss-of-lock + ZOH @ 100 Hz | $\tau_s, \sigma_\theta, \theta_\text{FOV}$ |
| Airframe | g-limit clamp + first-order (opt. second-order) autopilot lag | $a_\text{max}, \tau_a$ |
| Targets | constant-velocity, step, weave, bang-bang, jink, scripted, live | $n_T, T, t_\text{start}$ |
| Termination | parabolic-interpolated closest approach; lethal radius $R_k$ | $R_k, t_\text{max}$ |

The full equations are in [the physics notes](physics.md). The design's load-bearing
decision is the **fixed-step RK4 with a zero-order hold** on the commanded/target
accelerations: it makes runs bit-reproducible from a seed and lets an independent
TypeScript re-implementation match the Python core to tolerance.

## 3. Verification & validation

Six checks run as green assertions (`zeromiss validate`) and as notebook figures:

1. **Zero miss, CV target, $N \ge 3$** — worst miss 0.36 m over an $N \times$ offset grid.
2. **Heading-error washout** — worst miss 0.48 m over $HE \in [-45°,45°]$; latax decays.
3. **Zarchan step-maneuver curve** — correct N-ordering of the normalized-miss peaks
   (0.27 / 0.13 / 0.08 for $N=3/4/5$), worst-case peak, monotone decay in the linear
   regime. *This is the headline.*
4. **APN cancels a step TPN cannot** — at the Zarchan worst case ($t_F/\tau \approx 2$,
   large lag) TPN leaves 8.1 m; APN leaves 0.2 m (ratio 0.024).
5. **RK4 order of accuracy** — quarter-$dt$ error ratio ≈ 255 (theory: 256).
6. **Step-convergence audit** — halving $dt$ moves the miss by 0.03 m.

Plus the **cross-engine** check: the TypeScript twin reproduces every Python reference
run to **< 0.1 %**, enforced in CI. Independent re-implementation agreeing to tolerance
is the strongest verification statement the project makes.

## 4. Monte-Carlo results

Campaigns randomize initial range, heading error, maneuver timing/magnitude, and seeker
noise. The vectorised engine runs 10k–100k engagements in seconds and agrees with the
scalar engine to machine precision on ideal runs.

Representative findings (`scenarios/the_weave.yaml`, ideal-seeker baseline):

- **P_k vs N** is monotone increasing and saturates — the knee identifies the
  cost-effective navigation constant for the threat; beyond it, P_k gains flatten while
  commanded g keeps climbing.
- **Evasion frontier (P_k vs target g):** P_k falls as the target maneuvers harder; the
  frontier quantifies how much g the evader needs to meaningfully degrade the intercept.
- **Peak-g distribution** shows how often the airframe saturates — the link between the
  g-limit and the miss tail.

See [`docs/media/mc/montecarlo_panel.png`](media/mc/montecarlo_panel.png).

## 5. Software quality

- **95 % line coverage** on the engine; unit, property-based (Hypothesis), validation,
  and numerical tests.
- **18 end-to-end tests** (Playwright, desktop + mobile) cover launch→verdict, Duel,
  Compare, Storm, replay-from-seed, and the reduced-motion path.
- **CI** lints and tests both engines, exports fixtures, runs the cross-validation,
  builds the static web app, and runs E2E. Media is re-rendered from the engine so it
  cannot drift from the code.

## 6. What I'd do next

- **6-DOF attitude dynamics:** the interceptor is a point mass today, with airframe
  rotation and control-surface authority abstracted into a single autopilot lag. Lifting
  it to 6-DOF would expose angle-of-attack limits and body-rate coupling.
- **Richer seeker error models:** the seeker currently degrades the LOS rate with lag,
  angular noise, glint and a gimbal limit. Clutter and multipath — the errors that
  dominate low-altitude engagements — are not represented.
- **Simulink in CI:** the block-diagram leg is verified locally on R2024a and skips
  cleanly elsewhere, because running it automatically needs a licensed MATLAB runner.

## 7. Conclusion

ZeroMiss couples textbook-exact guidance laws to explicit sensor and actuator models,
validates them against published results across five independent implementations, and
reports performance statistically rather than anecdotally.
