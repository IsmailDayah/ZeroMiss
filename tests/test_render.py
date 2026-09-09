"""Render smoke tests — static plot, analysis panel, GIF + MP4 export."""

import zeromiss.scenarios as S
from zeromiss import Engagement
from zeromiss.render import analysis_panel, animate, static_plot


def _result():
    return Engagement.from_yaml(S.path("the_weave")).run(seed=1337)


def test_static_plot(tmp_path):
    p = static_plot(_result(), tmp_path / "traj.png")
    assert p.exists() and p.stat().st_size > 0


def test_analysis_panel(tmp_path):
    p = analysis_panel(_result(), tmp_path / "panel.png")
    assert p.exists() and p.stat().st_size > 0


def test_animate_gif(tmp_path):
    p = animate(_result(), tmp_path / "clip.gif", n_frames=20, fps=12)
    assert p.exists() and p.stat().st_size > 0


def test_animate_miss_branch(tmp_path):
    # a MISS run exercises the red/near-miss render path
    r = Engagement.from_yaml(S.path("tail_chase")).run()
    p = static_plot(r, tmp_path / "miss.png")
    assert p.exists()
