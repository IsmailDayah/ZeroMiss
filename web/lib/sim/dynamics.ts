/**
 * Equations of motion — port of `engine/zeromiss/dynamics.py`.
 *
 * State 8-tuple: [xM, yM, VM, gammaM, xT, yT, VT, gammaT]. Lateral accel only turns the
 * velocity of a constant-speed point mass; a_m and a_t are held constant across the RK4
 * step (zero-order hold), matching the Python engine.
 */

import type { State } from "./integrator";

export const G0 = 9.80665;

export interface DynamicsConfig {
  inducedDrag: boolean;
  dragCoeff: number;
  gravity: boolean;
  gravityValue: number;
}

export const defaultDynamics: DynamicsConfig = {
  inducedDrag: false,
  dragCoeff: 0.0,
  gravity: false,
  gravityValue: G0,
};

export function eom(state: State, aM: number, aT: number, cfg: DynamicsConfig = defaultDynamics): State {
  const [xM, yM, VM, gM, xT, yT, VT, gT] = state;

  let dxM = VM * Math.cos(gM);
  let dyM = VM * Math.sin(gM);
  let dVM = 0.0;
  let dgM = VM > 1e-9 ? aM / VM : 0.0;

  let dxT = VT * Math.cos(gT);
  let dyT = VT * Math.sin(gT);
  let dVT = 0.0;
  let dgT = VT > 1e-9 ? aT / VT : 0.0;

  if (cfg.inducedDrag && cfg.dragCoeff > 0.0) {
    dVM -= VM > 1e-9 ? cfg.dragCoeff * (aM * aM) / VM : 0.0;
    dVT -= VT > 1e-9 ? cfg.dragCoeff * (aT * aT) / VT : 0.0;
  }
  if (cfg.gravity) {
    const g = cfg.gravityValue;
    dgM -= VM > 1e-9 ? (g * Math.cos(gM)) / VM : 0.0;
    dgT -= VT > 1e-9 ? (g * Math.cos(gT)) / VT : 0.0;
    dVM -= g * Math.sin(gM);
    dVT -= g * Math.sin(gT);
  }

  return [dxM, dyM, dVM, dgM, dxT, dyT, dVT, dgT];
}
