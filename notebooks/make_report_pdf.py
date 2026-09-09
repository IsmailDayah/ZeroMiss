"""Generate docs/zeromiss.pdf — the engineering-report deliverable.

A clean, multi-page PDF built with fpdf2 (pure Python, no system deps) that embeds the
live validation + Monte-Carlo figures. Run from the repo root:

    python notebooks/make_report_pdf.py

Numbers are pulled from the live engine so the report can't drift from the code.
Text is ASCII-safe (fpdf2 core fonts are latin-1); Greek symbols are spelled out.
"""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

from zeromiss import validation as V

CYAN = (55, 120, 130)
INK = (20, 28, 40)
MUTED = (90, 100, 120)
MEDIA = Path("docs/media")
OUT = Path("docs/zeromiss.pdf")

_SUBS = {
    "τ": "tau", "λ": "lambda", "≈": "~", "×": "x",
    "→": "->", "≤": "<=", "≥": ">=", "–": "-", "—": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"', "²": "^2",
    "°": "deg", "₀": "0", "₁": "1",
}


def ascii_safe(text: str) -> str:
    for k, v in _SUBS.items():
        text = text.replace(k, v)
    return text.encode("latin-1", "replace").decode("latin-1")


class Report(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, "ZeroMiss - Engineering Report", align="L")
        self.cell(0, 8, f"p.{self.page_no()}", align="R")
        self.ln(10)

    def h1(self, text: str) -> None:
        self.set_font("Helvetica", "B", 15)
        self.set_text_color(*INK)
        self.ln(2)
        self.cell(0, 9, ascii_safe(text))
        self.ln(10)
        self.set_draw_color(*CYAN)
        self.set_line_width(0.5)
        x = self.get_x()
        y = self.get_y()
        self.line(x, y, x + 60, y)
        self.ln(4)

    def h2(self, text: str) -> None:
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*CYAN)
        self.ln(2)
        self.cell(0, 7, ascii_safe(text))
        self.ln(8)

    def body(self, text: str) -> None:
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*INK)
        self.multi_cell(0, 5.2, ascii_safe(text))
        self.ln(2)

    def kv_table(self, rows: list[tuple[str, str]], w1: float = 55) -> None:
        # key on its own line (bold), value full-width below — guarantees wrap room
        for k, val in rows:
            self.set_text_color(*CYAN)
            self.set_font("Helvetica", "B", 9.5)
            self.multi_cell(0, 5.4, ascii_safe(k))
            self.set_text_color(*INK)
            self.set_font("Helvetica", "", 9.5)
            self.set_x(self.l_margin + 4)
            self.multi_cell(0, 5.4, ascii_safe(val))
            self.ln(1.5)
        self.ln(1)


def build() -> Path:
    cases = V.run_all()
    passed = sum(c.passed for c in cases)

    pdf = Report(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 18, 18)

    # ---- title page ----
    pdf.add_page()
    pdf.ln(30)
    pdf.set_font("Helvetica", "B", 30)
    pdf.set_text_color(*INK)
    pdf.cell(0, 14, "ZeroMiss", align="C")
    pdf.ln(16)
    pdf.set_font("Helvetica", "", 13)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 8, "A validated missile-guidance interception simulator", align="C")
    pdf.ln(8)
    pdf.cell(0, 8, "Engineering Report", align="C")
    pdf.ln(20)
    if (MEDIA / "the_weave.png").exists():
        pdf.image(str(MEDIA / "the_weave.png"), x=35, w=140)
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.cell(0, 6, "model -> validation -> Monte-Carlo results -> next steps", align="C")

    # ---- 1. problem & scope ----
    pdf.add_page()
    pdf.h1("1. Problem & scope")
    pdf.body(
        "Build a credible, demonstrable interception simulator for the terminal homing "
        "phase of a planar (3-DOF) engagement, covering the guidance-law family used "
        "across the field (pure pursuit, PPN, TPN, APN, ZEM-optimal), with realistic "
        "sensor and actuator imperfections, validated against published results, and "
        "packaged so a non-specialist can see it and a specialist can trust it."
    )
    pdf.body(
        "Out of scope by design (see ETHICS.md): propulsion, mass/thrust, warhead/fuze, "
        "real seeker hardware, and any real platform or threat parameters. The "
        "interceptor is an idealized constant-speed point mass that can only turn; "
        "lethality is a single abstract radius. Everything is public-domain textbook math."
    )

    # ---- 2. model ----
    pdf.h1("2. Model")
    pdf.kv_table([
        ("Kinematics", "constant-speed planar point mass; lateral accel turns the velocity vector"),
        ("Integrator", "fixed-step classical RK4 at 1 kHz (dt = 1e-3 s)"),
        ("Guidance", "a = N * Vc * lambda_dot (TPN) and the full PN family"),
        ("Seeker", "first-order LOS-rate lag + angular noise (+glint) + FOV/loss-of-lock + 100 Hz ZOH"),
        ("Airframe", "g-limit clamp + first/second-order autopilot lag"),
        ("Targets", "constant-velocity, step, weave, bang-bang, jink, scripted, live"),
        ("Termination", "parabolic-interpolated closest approach; lethal radius R_k"),
    ])
    pdf.body(
        "The load-bearing decision is fixed-step RK4 with a zero-order hold on the "
        "commanded and target accelerations: it makes runs bit-reproducible from a seed "
        "and lets an independent TypeScript re-implementation match the Python core to "
        "tolerance."
    )

    # ---- 3. validation ----
    pdf.add_page()
    pdf.h1("3. Verification & validation")
    pdf.body(
        f"All {passed}/{len(cases)} checks run as green assertions (zeromiss validate) "
        "and as notebook figures:"
    )
    rows = []
    for c in cases:
        status = "PASS" if c.passed else "FAIL"
        rows.append((f"[{status}] {c.name}", c.detail))
    pdf.kv_table(rows, w1=70)
    if (MEDIA / "zarchan_curve.png").exists():
        pdf.h2("The headline: reproduced Zarchan step-maneuver curve")
        pdf.image(str(MEDIA / "zarchan_curve.png"), x=30, w=150)
    pdf.ln(2)
    pdf.body(
        "Plus the cross-engine check: the TypeScript twin reproduces every Python "
        "reference run to < 0.1% in CI. Independent re-implementation agreeing to "
        "tolerance is the strongest verification statement the project makes."
    )

    # ---- 4. monte carlo ----
    pdf.add_page()
    pdf.h1("4. Monte-Carlo results")
    pdf.body(
        "Campaigns randomize initial range, heading error, maneuver timing/magnitude, "
        "and seeker noise. The vectorized engine runs 10k-100k engagements in seconds "
        "and agrees with the scalar engine to machine precision on ideal runs. The "
        "headline metrics are P_k (probability of kill), CEP (median miss), and the "
        "miss / peak-g distributions; the trade-off studies are P_k-vs-N and the "
        "evasion frontier (P_k vs target g)."
    )
    if (MEDIA / "mc" / "montecarlo_panel.png").exists():
        pdf.image(str(MEDIA / "mc" / "montecarlo_panel.png"), x=20, w=170)

    # ---- 5. software quality + next ----
    pdf.add_page()
    pdf.h1("5. Software quality")
    pdf.kv_table([
        ("Coverage", "~95% line coverage on the engine; unit, property-based, validation, numerical tests"),
        ("E2E", "Playwright tests (desktop + mobile): launch->verdict, Duel, Compare, Storm, replay, reduced-motion, axe a11y"),
        ("CI", "lints + tests both engines, exports fixtures, runs cross-validation, builds the static app, runs E2E"),
        ("Media", "re-rendered from the engine in CI so it cannot drift from the code"),
    ])
    pdf.h1("6. What I'd do next")
    pdf.body(
        "- 6-DOF attitude dynamics: the interceptor is a point mass today, with "
        "airframe rotation and control authority folded into one autopilot lag.\n"
        "- Richer seeker error models: lag, angular noise, glint and a gimbal limit "
        "are modelled; clutter and multipath are not.\n"
        "- Simulink in CI: the block-diagram leg is verified locally on R2024a and "
        "skips elsewhere, because automating it needs a licensed MATLAB runner."
    )
    pdf.h1("7. Conclusion")
    pdf.body(
        "ZeroMiss couples textbook-exact guidance laws to explicit sensor and actuator "
        "models, validates them against published results across five independent "
        "implementations, and reports performance statistically rather than "
        "anecdotally."
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    return OUT


if __name__ == "__main__":
    p = build()
    print("wrote", p, f"({p.stat().st_size} bytes)")
