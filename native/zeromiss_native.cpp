// zeromiss_native — a C++ re-implementation of the inner guidance + RK4 loop.
// Mirrors engine/zeromiss for the no-lag
// TPN/CV case so a pybind11 cross-check can assert C++ ≡ Python to machine tolerance.
//
// This is the "flight-software-adjacent" artifact: the hot loop in the language flight
// software is actually written in, verified against the Python source of truth.

#include <pybind11/pybind11.h>
#include <cmath>

namespace py = pybind11;

// MSVC does not define M_PI without _USE_MATH_DEFINES; use a portable constant.
static constexpr double PI = 3.14159265358979323846;

// One classical RK4 step on the 8-state engagement vector with constant lateral accels.
static void eom(const double s[8], double a_m, double a_t, double d[8]) {
    double VM = s[2], gM = s[3], VT = s[6], gT = s[7];
    d[0] = VM * std::cos(gM);
    d[1] = VM * std::sin(gM);
    d[2] = 0.0;
    d[3] = (VM > 1e-9) ? a_m / VM : 0.0;
    d[4] = VT * std::cos(gT);
    d[5] = VT * std::sin(gT);
    d[6] = 0.0;
    d[7] = (VT > 1e-9) ? a_t / VT : 0.0;
}

static void rk4_step(double s[8], double a_m, double a_t, double dt) {
    double k1[8], k2[8], k3[8], k4[8], tmp[8];
    eom(s, a_m, a_t, k1);
    for (int i = 0; i < 8; i++) tmp[i] = s[i] + 0.5 * dt * k1[i];
    eom(tmp, a_m, a_t, k2);
    for (int i = 0; i < 8; i++) tmp[i] = s[i] + 0.5 * dt * k2[i];
    eom(tmp, a_m, a_t, k3);
    for (int i = 0; i < 8; i++) tmp[i] = s[i] + dt * k3[i];
    eom(tmp, a_m, a_t, k4);
    for (int i = 0; i < 8; i++)
        s[i] += (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
}

// Parabolic vertex of three equally-spaced range samples (closest-approach refine).
static double parabolic_min(double R0, double R1, double R2) {
    double denom = R0 - 2.0 * R1 + R2;
    if (std::fabs(denom) < 1e-12) return R1;
    double x = 0.5 * (R0 - R2) / denom;
    if (x < -1.0) x = -1.0;
    if (x > 1.0) x = 1.0;
    double a = 0.5 * denom, b = 0.5 * (R2 - R0);
    double Rmin = R1 + b * x + a * x * x;
    return Rmin < 0.0 ? 0.0 : Rmin;
}

// Run a no-lag, ideal-seeker TPN intercept of a constant-velocity target; return miss [m].
// Mirrors engine/zeromiss/engagement.run with airframe.ideal, seeker.ideal, law="tpn".
static double run_tpn_cv(double xM, double yM, double VM, double gM_deg,
                         double xT, double yT, double VT, double gT_deg,
                         double N, double dt, double t_max) {
    const double D2R = PI / 180.0;
    double s[8] = {xM, yM, VM, gM_deg * D2R, xT, yT, VT, gT_deg * D2R};
    double minR = 1e300, Rm2 = 1e300, Rm1 = 1e300;
    bool found = false;
    int n = (int)std::llround(t_max / dt);
    double t = 0.0;
    for (int step = 0; step <= n; step++) {
        double dx = s[4] - s[0], dy = s[5] - s[1];
        double R = std::hypot(dx, dy);
        double dvx = VT * std::cos(s[7]) - VM * std::cos(s[3]);
        double dvy = VT * std::sin(s[7]) - VM * std::sin(s[3]);
        double lam_dot = (R > 1e-9) ? (dx * dvy - dy * dvx) / (R * R) : 0.0;
        double Rdot = (R > 1e-9) ? (dx * dvx + dy * dvy) / R : 0.0;
        double Vc = -Rdot;
        double a_cmd = N * Vc * lam_dot; // TPN, ideal airframe => achieved = commanded
        if (R < minR) minR = R;
        if (step >= 2 && !found && Rm1 <= Rm2 && R > Rm1) {
            minR = parabolic_min(Rm2, Rm1, R);
            found = true;
            break;
        }
        Rm2 = Rm1;
        Rm1 = R;
        rk4_step(s, a_cmd, 0.0, dt);
        t += dt;
    }
    (void)t;
    return minR;
}

PYBIND11_MODULE(zeromiss_native, m) {
    m.doc() = "C++ hot-loop re-implementation of the ZeroMiss guidance+RK4 core (V&V cross-check).";
    m.def("run_tpn_cv", &run_tpn_cv,
          py::arg("xM"), py::arg("yM"), py::arg("VM"), py::arg("gM_deg"),
          py::arg("xT"), py::arg("yT"), py::arg("VT"), py::arg("gT_deg"),
          py::arg("N") = 4.0, py::arg("dt") = 0.001, py::arg("t_max") = 15.0,
          "Run a no-lag TPN intercept of a CV target; return miss distance [m].");
}
