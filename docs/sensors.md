# Seeker & airframe

A perfect seeker and a perfect airframe make guidance look too easy and hide the real
engineering. These two models turn the idealized laws into something that *can* miss —
which is what makes the hits feel earned and the Monte-Carlo P_k meaningful.

## The seeker ([`seeker.py`](api.md))

The seeker turns *true* relative geometry into the *measured* LOS rate the guidance law
actually receives, degraded by:

- **Seeker lag** — a first-order lag (time constant $\tau_s$) on the LOS rate; real
  seekers cannot report instantaneously.
- **Noise** — range-independent angular jitter $\sigma_\theta$ plus optional **glint**
  that worsens as $R \to 0$ (the classic terminal-homing headache that *causes* miss).
- **Field of view** — a $\pm\theta_\text{FOV}$ gimbal limit; exceed it and you get
  **loss-of-lock**: the reticle goes red, the missile coasts, and a maneuvering target
  can break lock and escape.
- **Update rate** — the seeker runs at e.g. 100 Hz under the 1 kHz physics, with a
  zero-order hold, exposing the sample-rate effects real systems fight.

Every effect is a slider in Sandbox, so you can watch a clean intercept *degrade* as you
add real-world imperfection, one term at a time.

```python
class Seeker:
    def measure(self, g: Geometry, dt: float, rng) -> SeekerOut: ...
```

All randomness flows from the single seeded `rng`. The cross-validation fixtures use an
**ideal, noise-free** seeker so determinism across engines never depends on the random
stream (Python's NumPy generator and the browser's mulberry32 are intentionally not
byte-identical).

## The airframe & autopilot ([`airframe.py`](api.md))

Guidance *commands* acceleration; the airframe *delivers* it imperfectly.

- **g-limit** — a hard clamp $|a| \le a_\text{max}$ (e.g. 40 g). A target pulling near
  the interceptor's limit at the right moment forces a miss — the basis of evasion.
- **Autopilot lag** — a first- (or optional second-) order response between commanded
  and achieved accel. This single lag is the dominant real-world miss source for a
  maneuvering target, and the reason $N$ and $\tau_a$ must be co-tuned.
- **Saturation** — when commanded beyond the limit, the response saturates and the HUD
  flags the "commanding more than I can pull" state in amber.

```python
class Airframe:
    def respond(self, a_cmd: float, dt: float) -> float: ...   # -> achieved accel
```

## Why the verdict reports *achieved* g

Near closest approach $t_{go} \to 0$ and the raw PN command $\propto V_c\,\dot\lambda$
can spike (the terminal $1/R^2$ singularity). The airframe clamps it to $a_\text{max}$,
so the **achieved** g is the physically meaningful, bounded number the Verdict Card and
HUD report; the (possibly huge) commanded peak is kept separately for analysis.
