"""Tracker-in-the-loop tests: EKF/IMM estimation + sensor fusion."""

import math

import numpy as np

import zeromiss.scenarios as S
from zeromiss import Engagement
from zeromiss.frames import Kinematic
from zeromiss.scenario import Scenario
from zeromiss.tracker import EKF, IMM, radar_measure


def _fly(accel_fn, dt=0.02, T=8.0):
    """Yield (target Kinematic) along a trajectory driven by accel_fn(t)."""
    x, y, vx, vy = 6000.0, 0.0, -300.0, 0.0
    t = 0.0
    while t < T:
        a = accel_fn(t)
        sp = math.hypot(vx, vy)
        hd = math.atan2(vy, vx) + (a / sp) * dt
        vx, vy = sp * math.cos(hd), sp * math.sin(hd)
        x += vx * dt
        y += vy * dt
        yield t, Kinematic(x, y, sp, hd)
        t += dt


def _rms(errs):
    return math.sqrt(sum(e * e for e in errs) / len(errs))


def test_ekf_beats_raw_measurements():
    rng = np.random.default_rng(0)
    sr, sb = 25.0, 6e-3
    radar = Kinematic(0, 0, 0, 0)
    ekf = EKF(q=50, sigma_r=sr, sigma_beta=sb)
    ekf.initialize(6000.0, 0.0, -300.0, 0.0)
    raw, est = [], []
    for _, tgt in _fly(lambda t: 9 * 9.81 * math.sin(math.pi * t)):
        z = radar_measure(radar, tgt, rng, sr, sb)
        rx, ry = z[0] * math.cos(z[1]), z[0] * math.sin(z[1])
        raw.append(math.hypot(rx - tgt.x, ry - tgt.y))
        ekf.predict(0.02)
        ekf.update(z, 0, 0)
        ex = ekf.estimate()
        est.append(math.hypot(ex[0] - tgt.x, ex[1] - tgt.y))
    assert _rms(est[50:]) < 0.4 * _rms(raw[50:])  # filter cuts error >2.5x


def test_imm_beats_fixed_ekf_on_maneuver():
    rng = np.random.default_rng(1)
    sr, sb = 25.0, 6e-3
    ekf = EKF(200, sr, sb)
    imm = IMM(q_quiet=2.0, q_maneuver=8000.0, sigma_r=sr, sigma_beta=sb)
    ekf.initialize(6000.0, 0.0, -300.0, 0.0)
    imm.initialize(6000.0, 0.0, -300.0, 0.0)
    ee, ie = [], []
    for _, tgt in _fly(lambda t: 0.0 if t < 4.0 else 12 * 9.81):
        z = radar_measure(Kinematic(0, 0, 0, 0), tgt, rng, sr, sb)
        ekf.predict(0.02)
        ekf.update(z, 0, 0)
        ex = ekf.estimate()
        ee.append(math.hypot(ex[0] - tgt.x, ex[1] - tgt.y))
        imm.step(0.02, z, 0, 0)
        ix = imm.estimate()
        ie.append(math.hypot(ix[0] - tgt.x, ix[1] - tgt.y))
    # during the maneuver phase, IMM tracks markedly better than the fixed EKF
    assert _rms(ie[210:]) < 0.6 * _rms(ee[210:])
    assert 0.0 <= imm.maneuver_probability <= 1.0


def test_radar_measure_deterministic():
    a = radar_measure(Kinematic(0, 0, 0, 0), Kinematic(8000, 500, 300, math.pi),
                      np.random.default_rng(7), 20.0, 5e-3)
    b = radar_measure(Kinematic(0, 0, 0, 0), Kinematic(8000, 500, 300, math.pi),
                      np.random.default_rng(7), 20.0, 5e-3)
    assert a == b


def test_tracker_engagement_runs_and_is_deterministic():
    sc = Scenario.from_yaml(S.path("tracker_demo"))
    r1 = Engagement(sc).run(seed=11)
    r2 = Engagement(sc).run(seed=11)
    assert r1.verdict in ("HIT", "MISS")
    assert r1.miss_distance == r2.miss_distance  # deterministic from the seed
    assert len(r1.telemetry) > 0


def test_tracker_beats_noisy_seeker_on_miss():
    """Under heavy seeker noise, the radar tracker yields a much smaller median miss."""
    base = Scenario.from_yaml(S.path("the_weave")).model_dump()

    def noisy_seeker():
        d = Scenario.from_dict(base).model_dump()
        d["missile"]["seeker"] = {"ideal": False, "tau": 0.05, "noise_mrad": 8.0,
                                  "glint": True, "fov_deg": 60, "update_hz": 100}
        return Scenario.from_dict(d)

    def with_tracker():
        d = Scenario.from_dict(base).model_dump()
        d["missile"]["seeker"] = {"ideal": True}
        d["missile"]["tracker"] = {"enabled": True, "model": "imm", "sigma_r_m": 30,
                                   "sigma_beta_mrad": 8, "radar_hz": 50}
        return Scenario.from_dict(d)

    def median_miss(scn, n, seed0):
        rng = np.random.default_rng(seed0)
        misses = [Engagement(scn).run(seed=int(rng.integers(0, 2**31))).miss_distance for _ in range(n)]
        return float(np.median(misses))

    m_noisy = median_miss(noisy_seeker(), 16, 1)
    m_track = median_miss(with_tracker(), 16, 1)
    assert m_track < 0.5 * m_noisy
