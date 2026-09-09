"""Generate the validation + hero figures used in the README and docs.

Run from the repo root:  python notebooks/make_figures.py
Re-rendered in CI by .github/workflows/gif-refresh.yml so the media never drifts.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from zeromiss import Engagement, scenarios
from zeromiss import validation as V
from zeromiss.montecarlo import figures as mc_figures
from zeromiss.render import AMBER, BG, CYAN, WHITE, _style, animate, static_plot
from zeromiss.scenario import Scenario

OUT = Path("docs/media")
OUT.mkdir(parents=True, exist_ok=True)


def zarchan_figure() -> None:
    fig, ax = plt.subplots(figsize=(7, 4.5))
    fig.patch.set_facecolor(BG)
    _style(ax)
    colors = {3.0: CYAN, 4.0: AMBER, 5.0: WHITE}
    for N, c in colors.items():
        pts = V.zarchan_step_curve(N)
        ax.plot([p.t_over_tau for p in pts], [p.norm_miss for p in pts], "o-", color=c, label=f"sim  N={N:g}")
        lin = V.zarchan_linear_curve(N)
        ax.plot([p.t_over_tau for p in lin], [p.norm_miss for p in lin], "--", color=c, lw=1.2, alpha=0.6,
                label=f"linear N={N:g}")
    ax.set_xlabel("normalized flight time  t_F / τ")
    ax.set_ylabel("normalized miss  miss / (n_T·τ²)")
    ax.set_title("Zarchan step-maneuver miss curve: nonlinear sim vs linear closed-form")
    leg = ax.legend(framealpha=0.15)
    for t in leg.get_texts():
        t.set_color(WHITE)
    fig.tight_layout()
    fig.savefig(OUT / "zarchan_curve.png", dpi=140, facecolor=BG)
    plt.close(fig)
    print("wrote", OUT / "zarchan_curve.png")


def hero_gifs() -> None:
    for name in ("the_weave", "tail_chase", "textbook_kill"):
        sc = Scenario.from_yaml(scenarios.path(name))
        r = Engagement(sc).run()
        animate(r, OUT / f"{name}.gif", n_frames=90, fps=24)
        static_plot(r, OUT / f"{name}.png")
        print("wrote", OUT / f"{name}.gif", r.summary())


def montecarlo_panel() -> None:
    sc = Scenario.from_yaml(scenarios.path("the_weave"))
    headline, panel = mc_figures(sc, OUT / "mc", runs=6000, seed=0)
    print("wrote", panel, headline.summary())


if __name__ == "__main__":
    zarchan_figure()
    hero_gifs()
    montecarlo_panel()
    print("done.")
