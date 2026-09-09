# The TypeScript twin & cross-validation

The twin is not a separate toy — it is the Python engine, re-expressed in TypeScript,
and proven to agree. Two independent implementations, continuously verified to agree, is
how safety-critical flight software is validated.

## The port

[`web/lib/sim/`](https://github.com/IsmailDayah/ZeroMiss/tree/main/web/lib/sim)
mirrors [`engine/zeromiss/`](api.md) module-for-module:

| Python | TypeScript |
|---|---|
| `frames.py` | `frames.ts` |
| `integrator.py` | `integrator.ts` |
| `dynamics.py` | `dynamics.ts` |
| `guidance/laws.py` | `guidance.ts` |
| `seeker.py` | `seeker.ts` |
| `airframe.py` | `airframe.ts` |
| `targets.py` | `targets.ts` |
| `engagement.py` | `engagement.ts` |

Same equations, same fixed-step RK4, same guidance functions, same zero-order hold on the
held accelerations — so the arithmetic order matches and the two agree bit-for-bit on
ideal runs.

## The fixtures

The Python engine exports reference runs (full state histories for a battery of
scenarios + seeds):

```bash
zeromiss export-fixtures --out web/fixtures
```

Each `fixtures/*.json` carries the dumped scenario, the sampled state rows, and the
result (verdict, miss, peak g).

## The harness (Vitest, in CI)

```bash
cd web && npm run crossval
```

[`web/lib/crossval/crossval.test.ts`](https://github.com/IsmailDayah/ZeroMiss/tree/main/web/lib/crossval)
runs each fixture's scenario through the TypeScript engine and asserts:

- **per-step agreement < 0.1 %** of the initial range, and
- an **identical hit/miss verdict and miss distance.**

If the twin ever drifts from truth, **CI goes red**. That single red light is the
guarantee behind every number the browser shows.

## Why the RNG is deliberately *not* shared

The browser uses a small mulberry32 generator; Python uses NumPy's. They are not
byte-identical by design — so the fixtures use an **ideal, noise-free seeker**, and
determinism across engines never depends on the random stream. Noise appears only in the
interactive and Monte-Carlo browser modes, where exact cross-engine reproduction is not
required.
