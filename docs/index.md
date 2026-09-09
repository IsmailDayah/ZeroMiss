# ZeroMiss — The Interception Lab

A **validated missile-guidance interception simulator**: a Python core that is the
source of truth, and a TypeScript twin, continuously cross-checked against it, that runs
a cinematic intercept theatre in your browser at 60 fps with no backend.

> **The one idea.** Keep the bearing to your target constant and you will collide with
> it. A falcon, an outfielder, a dog snapping a frisbee, and a homing missile all use
> the same trick: **proportional navigation** — turn at a rate proportional to how fast
> the target drifts across your view.

## Why two engines?

1. The browser needs 60 fps with no server → a native TypeScript engine.
2. The analysis, validation and Monte-Carlo work belong in Python → the authoritative core.
3. The **cross-validation** between them is itself a model-verification story:
   independent re-implementations agreeing to tolerance is exactly how flight-software
   V&V is done, so the second engine pays for itself as evidence.

## Where to start

- **Play:** the live app — Arena, FPV, Watch, Sandbox, Duel, Compare, Storm,
  Monte-Carlo, Tracker, 3-D, Learn.
- **[How it works](how-it-works.md):** the architecture in five minutes.
- **[The physics](physics.md)** and **[the guidance laws](guidance.md):** every equation.
- **[Validation](validation.md):** how the project proves it reproduces the textbook.
- **[API & CLI](api.md):** drive the engine from Python or a terminal.

## Design principles

- **The physics is real** — point-mass kinematics, real frames, an RK4 integrator,
  honest units. If it hits, it hit because the math hit.
- **Python decides what's true; the browser proves it can reproduce it live.**
- **Every engagement is reproducible from a seed** — a shared link replays the exact run.
- **Honest visualization** — the HUD shows the *actual* state; the drama is earned.
- **ITAR-clean by construction** — idealized public-domain math only (see
  [Ethics](ethics.md)).
