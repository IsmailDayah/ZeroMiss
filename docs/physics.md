# The physics engine — equations of motion

A planar (2-D, 3-DOF) point-mass engagement is the heart. State is small, exact, fast.

## State

Missile $(x_M, y_M, V_M, \gamma_M)$ and target $(x_T, y_T, V_T, \gamma_T)$, where
$\gamma$ is the flight-path angle (heading, CCW from $+x$) and $V$ is speed.

The engine stores this as a flat 8-tuple
$(x_M, y_M, V_M, \gamma_M, x_T, y_T, V_T, \gamma_T)$ so the arithmetic order is identical
in Python and JavaScript (both IEEE-754 doubles) — the basis of the cross-validation.

## Relative geometry (computed every step)

$$
\begin{aligned}
\Delta x &= x_T - x_M, \quad \Delta y = y_T - y_M \\
R &= \sqrt{\Delta x^2 + \Delta y^2} &&\text{range to go} \\
\lambda &= \operatorname{atan2}(\Delta y, \Delta x) &&\text{line-of-sight angle} \\
\dot\lambda &= \frac{\Delta x\,\Delta\dot y - \Delta y\,\Delta\dot x}{R^2} &&\text{LOS rate — the star of the show} \\
V_c &= -\dot R = -\frac{\Delta x\,\Delta\dot x + \Delta y\,\Delta\dot y}{R} &&\text{closing velocity} \\
t_{go} &\approx R / V_c &&\text{time-to-go}
\end{aligned}
$$

This is [`frames.relative_state`](api.md) — pure and stateless. The singularity at
$R \to 0$ is guarded (`_safe_div`) so the terminal step never blows up.

## Equations of motion

A guidance/target lateral acceleration $a$ (perpendicular to velocity, positive CCW)
only *turns* the velocity vector of a constant-speed point mass:

$$
\dot\gamma_M = \frac{a}{V_M}, \qquad \dot x_M = V_M \cos\gamma_M, \qquad \dot y_M = V_M \sin\gamma_M
$$

(The target is identical with its own commanded/scripted $a_T$.) Optional realism, off
by default: induced-drag speed loss in high-g turns ($\dot V = -k\,a^2/V$) and gravity.

## Zero-Effort-Miss

The miss if both bodies coast from now, resolved perpendicular to the LOS:

$$
\mathrm{ZEM}_\perp = R\,\dot\lambda\, t_{go} + \tfrac12\, a_{T\perp}\, t_{go}^2
$$

ZeroMiss visualizes this as a live arrow — guidance exists to drive it to zero, hence
the name.

## Integrator

Fixed-step **classical RK4** at 1 kHz internal (decoupled from the render rate). Fixed
(not adaptive) so runs are bit-reproducible and the TS twin can match exactly. A
step-convergence audit (halve $dt$, assert the miss changes < tolerance) proves the
integration has converged; an order-of-accuracy check confirms global error $\sim O(dt^4)$.

The guidance command and target/airframe accelerations are held constant across each RK4
step (zero-order hold), which is what makes the two engines bit-comparable.
