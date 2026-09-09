# MATLAB / Simulink cross-check

The Simulink leg of ZeroMiss's five-language V&V. A real block-diagram
model of the planar True-Proportional-Navigation engagement — a vector **Integrator**
fed by a guidance **derivative block**, solved with the fixed-step RK4 solver `ode4` at
1 kHz — whose miss distances are diffed against the Python source of truth.

## Files

| File | What it is |
|---|---|
| `zeromiss_deriv.m` | the state derivative (geometry → TPN → kinematics), Simulink-callable |
| `build_zeromiss_simulink.m` | programmatically builds + runs the model, prints `name,miss` CSV, saves the `.slx` |

Running `build_zeromiss_simulink` generates `zeromiss_engagement.slx` (open it in Simulink
to inspect the block diagram). The `.slx` is a **build artifact** — the `.m` script is the
tracked source of truth, since Simulink's binary `.slx` isn't byte-deterministic.

## Run it

```matlab
>> cd <repo>/matlab
>> build_zeromiss_simulink
headon_offset,0.416821
crossing,0.439010
tail_high_N,0.043041
saved zeromiss_engagement.slx
```

Those match the Python engine (`0.416842 / 0.439017 / 0.042322`) to sub-millimetre — the
tiny differences are Simulink's `ode4` vs the engine's hand-rolled RK4. The automated
check (`pytest tests/test_simulink_crosscheck.py`) runs this whenever MATLAB is on PATH
and asserts agreement to < 5 cm.

> Verified on **MATLAB R2024a + Simulink**. Requires a licensed MATLAB install; the check
> skips cleanly where MATLAB is unavailable (e.g. CI).
