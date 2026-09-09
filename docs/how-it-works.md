# How it works — the architecture in five minutes

```
                    ┌─────────────────────────────────────────┐
   scenarios/*.yaml │      PYTHON CORE  (source of truth)      │ ─► telemetry.json
        ───────────►│  dynamics · guidance · seeker · airframe │ ─► figures/*.png
                    │  RK4 · engagement state machine          │ ─► clips/*.gif|mp4
                    │  Monte-Carlo · validation suite          │ ─► montecarlo/*.png
                    └───────────────┬──────────────────────────┘
                                    │  exports reference runs (fixtures/*.json)
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │   CROSS-VALIDATION HARNESS (Vitest, CI)  │  asserts < 0.1% agreement
                    └───────────────┬──────────────────────────┘
                                    │  green ⇒ the twin is trustworthy
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │   TYPESCRIPT TWIN  (validated replica)   │
                    │   Next.js · Canvas · 60 fps · in-tab     │ ─► Vercel (static, edge)
                    └─────────────────────────────────────────┘
```

## The data flow of one engagement

1. A **scenario** (YAML, validated by Pydantic) declares the missile, target, seeker,
   airframe, termination, and optional Monte-Carlo block.
2. `Engagement.run(seed)` seeds a single RNG and steps a fixed-timestep loop:
   `relative_state` → `Seeker.measure` → `guidance law` → `Airframe.respond` → `RK4`.
3. The **state machine** (MIDCOURSE → TERMINAL, or COAST on loss-of-lock) tracks the
   range; at the step where range starts increasing, the exact miss distance is found by
   **parabolic interpolation** around closest approach — never at a coarse step boundary.
4. A **`Result`** (verdict, miss, peak g, flight time, seed, full telemetry) feeds the
   Verdict Card, the analysis charts, the matplotlib render, and the fixtures.

## The web side

The TypeScript twin runs the *same* loop in the browser. A fixed 1 kHz logic step is
decoupled from the render loop (an accumulator drives N physics steps per animation
frame), so it stays smooth on a laptop or a phone and dilates into slow-motion for the
terminal beat. The Canvas `Stage` draws trails, the live line-of-sight, the
constant-bearing ghosts, the ZEM arrow, and the seeker reticle — all from real state.

## Repository layout

```
engine/zeromiss/   the Python core (source of truth)
scenarios/         *.yaml engagement definitions (the presets)
fixtures/          Python reference runs exported for the twin
web/lib/sim/       the TypeScript twin (module-for-module port)
web/lib/crossval/  the agreement harness (Vitest)
web/app/           Next.js routes: / /arena /fpv /play /duel /compare /storm
                   /montecarlo /tracker /threed /learn /replay
tests/             pytest — unit, property, validation, numerical
docs/              this site (MkDocs)
notebooks/         the validation story + figure generation
.github/workflows/ CI: test both engines, build, deploy, refresh media
```
