"""The ZeroMiss command-line interface — the engineer's entry point.

    zeromiss run scenarios/tail_chase.yaml --seed 7 --gif
    zeromiss compare --law tpn --law apn scenarios/the_weave.yaml
    zeromiss montecarlo scenarios/the_weave.yaml --runs 50000 --out reports/
    zeromiss validate
    zeromiss export-fixtures
    zeromiss list
"""

from __future__ import annotations

import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from . import scenarios as scn
from .engagement import Engagement
from .scenario import Scenario

# The validation table prints tau, lambda and Greek subscripts. A Windows console
# defaults to cp1252, which cannot encode them, so `zeromiss validate` died with
# UnicodeEncodeError on exactly the command the README tells people to run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # already wrapped, or not a TextIO
        pass

app = typer.Typer(
    add_completion=False,
    help="ZeroMiss — a validated missile-guidance interception simulator.",
    no_args_is_help=True,
)
console = Console()


def _resolve(scenario: str) -> Scenario:
    """Accept either a path to a YAML file or the bare name of a bundled scenario."""
    p = Path(scenario)
    if p.exists():
        return Scenario.from_yaml(p)
    try:
        return scn.scenario(scenario)
    except Exception as exc:  # noqa: BLE001
        raise typer.BadParameter(f"No scenario file or preset named {scenario!r}") from exc


@app.command()
def run(
    scenario: str = typer.Argument(..., help="Path to a YAML file or a bundled preset name."),
    seed: int | None = typer.Option(None, help="Override the scenario seed."),
    gif: bool = typer.Option(False, help="Render an animated GIF of the engagement."),
    mp4: bool = typer.Option(False, help="Render an MP4 of the engagement."),
    plot: bool = typer.Option(False, help="Save a static trajectory PNG."),
    panel: bool = typer.Option(False, help="Save the post-engagement analysis panel."),
    csv: bool = typer.Option(False, help="Export telemetry to CSV."),
    out: Path = typer.Option(Path("reports"), help="Output directory for artifacts."),
):
    """Run a single engagement and print the verdict."""
    sc = _resolve(scenario)
    result = Engagement(sc).run(seed=seed)
    _print_result_table(result)

    stem = Path(scenario).stem
    out.mkdir(parents=True, exist_ok=True)
    if plot:
        from .render import static_plot

        console.print(f"[cyan]plot[/]  {static_plot(result, out / f'{stem}.png')}")
    if panel:
        from .render import analysis_panel

        console.print(f"[cyan]panel[/] {analysis_panel(result, out / f'{stem}_panel.png')}")
    if gif:
        from .render import animate

        console.print(f"[cyan]gif[/]   {animate(result, out / f'{stem}.gif')}")
    if mp4:
        from .render import animate

        console.print(f"[cyan]mp4[/]   {animate(result, out / f'{stem}.mp4')}")
    if csv:
        console.print(f"[cyan]csv[/]   {result.to_csv(out / f'{stem}.csv')}")

    raise typer.Exit(0 if result.hit else 0)  # a MISS is still a successful run


@app.command()
def compare(
    scenario: str = typer.Argument(..., help="Path or preset name."),
    law: list[str] = typer.Option(["tpn", "apn"], "--law", help="Repeat to compare laws."),
    seed: int | None = typer.Option(None),
    plot: bool = typer.Option(False, help="Save a side-by-side trajectory PNG."),
    out: Path = typer.Option(Path("reports")),
):
    """Run one scenario under several guidance laws, side by side."""
    base = _resolve(scenario)
    table = Table(title=f"Compare — {base.name}", header_style="bold cyan")
    for col in ("law", "verdict", "miss [m]", "peak g", "t_flight [s]"):
        table.add_column(col)
    results = []
    for lw in law:
        sc = base.model_copy(deep=True)
        sc.missile.guidance.law = lw
        r = Engagement(sc).run(seed=seed)
        results.append((lw, r))
        style = "green" if r.hit else "red"
        table.add_row(lw.upper(), f"[{style}]{r.verdict}[/]",
                      f"{r.miss_distance:.2f}", f"{r.peak_g:.1f}", f"{r.t_flight:.3f}")
    console.print(table)

    if plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        from .render import AMBER, BG, CYAN, WHITE, _style

        out.mkdir(parents=True, exist_ok=True)
        fig, axs = plt.subplots(1, len(results), figsize=(6 * len(results), 5), squeeze=False)
        fig.patch.set_facecolor(BG)
        for ax, (lw, r) in zip(axs[0], results, strict=False):
            _style(ax)
            t = r.telemetry
            ax.plot(t.column("x_m"), t.column("y_m"), color=CYAN, lw=2)
            ax.plot(t.column("x_t"), t.column("y_t"), color=AMBER, lw=2)
            ax.set_aspect("equal", adjustable="datalim")
            ax.set_title(f"{lw.upper()}  miss={r.miss_distance:.2f} m", color=WHITE)
        path = out / f"{Path(scenario).stem}_compare.png"
        fig.tight_layout()
        fig.savefig(path, dpi=130, facecolor=BG)
        plt.close(fig)
        console.print(f"[cyan]plot[/]  {path}")


@app.command()
def montecarlo(
    scenario: str = typer.Argument(..., help="Path or preset name (needs a montecarlo block, or use --runs)."),
    runs: int | None = typer.Option(None, help="Number of randomized runs."),
    seed: int = typer.Option(0),
    out: Path = typer.Option(Path("reports"), help="Output directory for figures."),
):
    """Run a randomized campaign → P_k, CEP, histogram, trade-off figures."""
    sc = _resolve(scenario)
    from .montecarlo import figures

    n = runs or (sc.montecarlo.runs if sc.montecarlo else 8000)
    console.print(f"[cyan]Running Monte-Carlo:[/] {n} runs of '{sc.name}' …")
    headline, panel = figures(sc, out / Path(scenario).stem, runs=n, seed=seed)

    table = Table(title=f"Monte Carlo — {sc.name}", header_style="bold cyan")
    for col in ("metric", "value"):
        table.add_column(col)
    table.add_row("runs", str(headline.runs))
    table.add_row("P_k (probability of kill)", f"{headline.Pk:.4f}")
    table.add_row("CEP (median miss)", f"{headline.cep:.2f} m")
    table.add_row("mean miss", f"{headline.mean_miss:.2f} m")
    console.print(table)
    console.print(f"[cyan]figures[/] {panel}")


@app.command()
def validate():
    """Run the full validation suite and print a pass/fail table."""
    from .validation import report

    rep = report()
    table = Table(title="ZeroMiss Validation Suite", header_style="bold cyan")
    for col in ("status", "category", "case", "detail"):
        table.add_column(col)
    for c in rep.cases:
        status = "[green]PASS[/]" if c.passed else "[red]FAIL[/]"
        table.add_row(status, c.category, c.name, c.detail)
    console.print(table)
    if rep.all_passed:
        console.print("[bold green]All validation cases passed.[/]")
        raise typer.Exit(0)
    console.print("[bold red]Validation FAILED.[/]")
    raise typer.Exit(1)


@app.command("export-fixtures")
def export_fixtures_cmd(
    out: Path = typer.Option(Path("fixtures"), help="Output directory for the twin fixtures."),
):
    """Regenerate the JSON fixtures the TypeScript twin cross-validates against."""
    from .fixtures import export_fixtures

    paths = export_fixtures(out)
    console.print(f"[green]Wrote {len(paths)} fixtures to {out}[/]")
    for p in paths:
        console.print(f"  {p}")


@app.command("list")
def list_scenarios():
    """List the bundled scenario presets."""
    table = Table(title="Bundled scenarios", header_style="bold cyan")
    table.add_column("name")
    table.add_column("description")
    for name in scn.names():
        sc = scn.scenario(name)
        table.add_row(name, sc.description or "")
    console.print(table)


def _print_result_table(result) -> None:
    table = Table(title=f"Engagement — {result.scenario_name}", header_style="bold cyan")
    table.add_column("field")
    table.add_column("value")
    style = "green" if result.hit else "red"
    table.add_row("verdict", f"[{style}]{result.verdict}[/]")
    table.add_row("miss distance", f"{result.miss_distance:.3f} m")
    table.add_row("lethal radius", f"{result.lethal_radius:.1f} m")
    table.add_row("peak g (achieved)", f"{result.peak_g:.1f}")
    table.add_row("flight time", f"{result.t_flight:.3f} s")
    table.add_row("closing velocity", f"{result.closing_velocity:.0f} m/s")
    table.add_row("guidance", f"{result.law.upper()}  N={result.N:g}")
    table.add_row("seed", str(result.seed))
    if result.lock_lost:
        table.add_row("seeker", "[red]LOCK LOST during flight[/]")
    console.print(table)


if __name__ == "__main__":  # pragma: no cover
    app()
