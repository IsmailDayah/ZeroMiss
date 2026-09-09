/**
 * Fixed-step RK4 integrator — port of `engine/zeromiss/integrator.py`.
 *
 * Operates on a flat number[] state so the arithmetic order matches Python exactly
 * (both run IEEE-754 doubles), which is what makes the cross-validation pass.
 */

export type State = number[];
export type Deriv = (state: State, t: number) => State;

function axpy(state: State, k: State, a: number): State {
  const out = new Array<number>(state.length);
  for (let i = 0; i < state.length; i++) out[i] = state[i] + a * k[i];
  return out;
}

export function rk4Step(state: State, deriv: Deriv, dt: number, t = 0.0): State {
  const k1 = deriv(state, t);
  const k2 = deriv(axpy(state, k1, 0.5 * dt), t + 0.5 * dt);
  const k3 = deriv(axpy(state, k2, 0.5 * dt), t + 0.5 * dt);
  const k4 = deriv(axpy(state, k3, dt), t + dt);

  const out = new Array<number>(state.length);
  const sixth = dt / 6.0;
  for (let i = 0; i < state.length; i++) {
    out[i] = state[i] + sixth * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
  }
  return out;
}
