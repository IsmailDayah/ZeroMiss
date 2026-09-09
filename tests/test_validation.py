"""The validation suite, asserted as tests."""

import pytest

from zeromiss import validation as V


@pytest.mark.parametrize("case_fn", V.ALL_CASES, ids=[fn.__name__ for fn in V.ALL_CASES])
def test_validation_case(case_fn):
    case = case_fn()
    assert case.passed, f"{case.name}: {case.detail}"


def test_all_passed_report():
    rep = V.report()
    assert rep.all_passed, [c.name for c in rep.cases if not c.passed]


def test_zarchan_curve_n_ordering():
    peaks = {N: max(p.norm_miss for p in V.zarchan_step_curve(N)) for N in (3.0, 4.0, 5.0)}
    assert peaks[3.0] > peaks[4.0] > peaks[5.0]


def test_zarchan_linear_closed_form():
    # the independent linear homing-loop reference: N=3 peaks in the textbook 2-4 band
    c3 = V.zarchan_linear_curve(3.0)
    peak = max(c3, key=lambda p: p.norm_miss)
    assert 1.5 <= peak.t_over_tau <= 4.0
    lin_peaks = {N: max(p.norm_miss for p in V.zarchan_linear_curve(N)) for N in (3.0, 4.0, 5.0)}
    assert lin_peaks[3.0] > lin_peaks[4.0] > lin_peaks[5.0]
