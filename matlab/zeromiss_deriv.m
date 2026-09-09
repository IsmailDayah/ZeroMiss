function d = zeromiss_deriv(u)
% ZEROMISS_DERIV  State derivative for the planar TPN engagement (Simulink-callable).
%   u = [xM; yM; gammaM; xT; yT; gammaT]  (constant-speed point masses)
%   Reads params from the shared global ZM_P (set by build_zeromiss_simulink.m).
%   Mirrors engine/zeromiss/{frames,guidance,dynamics}.py exactly so the Simulink
%   result can be diffed against the Python source of truth.
  global ZM_P
  VM = ZM_P.VM; VT = ZM_P.VT; N = ZM_P.N;

  xM = u(1); yM = u(2); gM = u(3);
  xT = u(4); yT = u(5); gT = u(6);

  dx = xT - xM; dy = yT - yM;
  R = hypot(dx, dy);
  dvx = VT*cos(gT) - VM*cos(gM);
  dvy = VT*sin(gT) - VM*sin(gM);
  if R > 1e-9
    lam_dot = (dx*dvy - dy*dvx) / (R*R);
    Rdot    = (dx*dvx + dy*dvy) / R;
  else
    lam_dot = 0.0; Rdot = 0.0;
  end
  Vc = -Rdot;
  a_cmd = N * Vc * lam_dot;            % True Proportional Navigation (ideal airframe)

  d = [ VM*cos(gM);
        VM*sin(gM);
        a_cmd / VM;
        VT*cos(gT);
        VT*sin(gT);
        0.0 ];
end
