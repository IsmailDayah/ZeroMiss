function miss = run_tpn_cv(xM, yM, VM, gMd, xT, yT, VT, gTd, N, dt, tmax)
  % TPN intercept of a constant-velocity target (no lag, ideal seeker), MATLAB/Octave.
  % Mirrors engine/zeromiss/engagement.run for the cross-language V&V.
  D2R = pi / 180.0;
  s = [xM, yM, VM, gMd * D2R, xT, yT, VT, gTd * D2R];
  minR = 1e300; Rm2 = 1e300; Rm1 = 1e300; found = false;
  n = round(tmax / dt);
  for step = 0:n
    dx = s(5) - s(1); dy = s(6) - s(2);
    R = hypot(dx, dy);
    dvx = VT * cos(s(8)) - VM * cos(s(4));
    dvy = VT * sin(s(8)) - VM * sin(s(4));
    if R > 1e-9
      lam_dot = (dx * dvy - dy * dvx) / (R * R);
      Rdot = (dx * dvx + dy * dvy) / R;
    else
      lam_dot = 0.0; Rdot = 0.0;
    end
    a_cmd = N * (-Rdot) * lam_dot;
    if R < minR; minR = R; end
    if step >= 2 && ~found && Rm1 <= Rm2 && R > Rm1
      minR = zm_pmin(Rm2, Rm1, R);
      found = true;
      break;
    end
    Rm2 = Rm1; Rm1 = R;
    s = zm_rk4(s, a_cmd, 0.0, dt);
  end
  miss = minR;
end

function d = zm_eom(s, a_m, a_t)
  VM = s(3); gM = s(4); VT = s(7); gT = s(8);
  d = zeros(1, 8);
  d(1) = VM * cos(gM); d(2) = VM * sin(gM); d(3) = 0.0;
  d(4) = a_m / max(VM, 1e-9);
  d(5) = VT * cos(gT); d(6) = VT * sin(gT); d(7) = 0.0;
  d(8) = a_t / max(VT, 1e-9);
end

function s2 = zm_rk4(s, a_m, a_t, dt)
  k1 = zm_eom(s, a_m, a_t);
  k2 = zm_eom(s + 0.5 * dt * k1, a_m, a_t);
  k3 = zm_eom(s + 0.5 * dt * k2, a_m, a_t);
  k4 = zm_eom(s + dt * k3, a_m, a_t);
  s2 = s + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4);
end

function Rmin = zm_pmin(R0, R1, R2)
  denom = R0 - 2.0 * R1 + R2;
  if abs(denom) < 1e-12
    Rmin = R1; return;
  end
  x = 0.5 * (R0 - R2) / denom;
  x = max(-1.0, min(1.0, x));
  a = 0.5 * denom; b = 0.5 * (R2 - R0);
  Rmin = max(R1 + b * x + a * x * x, 0.0);
end
