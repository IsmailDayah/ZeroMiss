# Five-language verification

ZeroMiss's strongest claim is not any single number — it's that **five independent
re-implementations of the guidance core agree**. Independent re-implementation agreeing
to tolerance is how safety-critical flight software is verified, and here it spans five
languages/tools:

| Language / tool | Role | Cross-check |
|---|---|---|
| **Python** | source of truth (engine, validation, Monte-Carlo) | — |
| **TypeScript** | the browser twin (60 fps, in-tab) | reproduces Python fixtures to **< 0.1 %** (`web/lib/crossval`) |
| **MATLAB / Octave** | independent scientific re-derivation (script) | matches Python miss to **< 1e-2 m** (`tools/matlab/`) |
| **C++ (pybind11)** | the flight-software-adjacent hot loop | matches Python miss to **< 1e-3 m** (`native/`) |
| **MATLAB / Simulink** | a real block-diagram model (Integrator + RK4 `ode4`) | matches Python miss to **< 5e-2 m** (`matlab/`) |

The first four are enforced in CI (the `cross-language` job installs Octave + a C++
compiler and runs both checks on every push). Simulink requires a licensed MATLAB
install, so its check (`tests/test_simulink_crosscheck.py`) runs wherever MATLAB is on
PATH and skips cleanly otherwise — it has been **verified locally on MATLAB R2024a**.

## Verified agreement (the three canonical cases)

| case | Python | TypeScript | Octave | C++ | Simulink |
|---|---|---|---|---|---|
| `headon_offset` | 0.416842 | 0.416842 | 0.416842 | 0.416842 | 0.416821 |
| `crossing` | 0.439017 | 0.439017 | 0.439017 | 0.439017 | 0.439010 |
| `tail_high_N` | 0.042322 | 0.042322 | 0.042322 | 0.042322 | 0.043041 |

(Miss distance in metres. Simulink uses its own fixed-step RK4 solver `ode4`, hence the
sub-millimetre differences; the scalar re-implementations are byte-identical.)

## Reproduce it yourself

```bash
# Python ↔ C++  (needs a C++ compiler + pybind11)
python native/setup_native.py build_ext --inplace
pytest tests/test_native_crosscheck.py -q

# Python ↔ MATLAB/Octave  (needs octave-cli or matlab on PATH)
pytest tests/test_matlab_crosscheck.py -q

# Python ↔ MATLAB/Simulink  (needs a licensed MATLAB install on PATH)
pytest tests/test_simulink_crosscheck.py -q
# or interactively:  >> cd matlab; build_zeromiss_simulink
```

The three canonical cases are defined identically in `tools/matlab/run_tpn_cv.m`,
`native/zeromiss_native.cpp`, `matlab/zeromiss_deriv.m`, and the Python engine; every
harness asserts the miss distances agree.

## Why five implementations

A single implementation can only be checked against itself. Re-deriving the same physics
in **five** independent toolchains — Python, TypeScript, Octave, C++, and a Simulink block
diagram — turns agreement into evidence: a mistake in any one of them shows up as a
disagreement in CI rather than as a plausible-looking wrong answer.
