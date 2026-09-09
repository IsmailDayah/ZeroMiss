"use client";

import Link from "next/link";

import { Theatre } from "@/components/Theatre";
import { PRESETS } from "@/lib/sim/presets";

const MODES = [
  { href: "/arena", title: "Arena", blurb: "Fly a jet or drone in 3-D and evade a real ProNav interceptor — the game IS the validated math.", tag: "★ play it" },
  { href: "/play", title: "Watch", blurb: "Pick a preset, sit back, share the clip.", tag: "presets" },
  { href: "/play?adv=1", title: "Sandbox", blurb: "Tune N, the law, seeker noise, lag, g-limits — live.", tag: "parameters" },
  { href: "/tracker", title: "Tracker", blurb: "Radar EKF + IMM estimating a noisy track.", tag: "estimation" },
  { href: "/compare", title: "Compare", blurb: "Two laws, same scenario, side by side.", tag: "side by side" },
  { href: "/storm", title: "Storm", blurb: "A salvo: many interceptors vs many evaders.", tag: "salvo" },
  { href: "/montecarlo", title: "Live Monte-Carlo", blurb: "Run 10,000 engagements — P_k forms live.", tag: "stats" },
  { href: "/duel", title: "Duel", blurb: "You fly the jet and try to evade a ProNav interceptor.", tag: "★ play it" },
  { href: "/fpv", title: "FPV", blurb: "A first-person drone camera, hunted by the same validated guidance.", tag: "prototype" },
  { href: "/threed", title: "3-D View", blurb: "True 3-D proportional navigation against an out-of-plane target.", tag: "3-D" },
  { href: "/learn", title: "Learn", blurb: "From frisbees to missiles — the idea, animated.", tag: "explainer" },
];

const MODELLED = [
  ["Guidance theory", "Pure/True/Augmented PN + ZEM-optimal, one click apart"],
  ["Sensors & actuators", "Seeker lag/noise/FOV/loss-of-lock; autopilot lag; g-limits"],
  ["Validation", "Reproduces canonical Zarchan results; assertions in CI"],
  ["Statistical analysis", "Monte-Carlo P_k, CEP, evasion frontiers"],
  ["Model verification", "Python core ↔ TS twin, cross-validated to < 0.1% in CI"],
  ["Countermeasures", "Decoy and flare seduction; optional drag and gravity"],
];

export default function Home() {
  return (
    <div className="flex flex-col gap-10 py-4">
      <section className="grid items-center gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <span className="chip w-fit">Zero-Effort-Miss · proportional navigation</span>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            Keep the bearing constant,
            <br />
            and you <span className="text-cyan">collide</span>.
          </h1>
          <p className="max-w-prose text-muted">
            A falcon catching a pigeon, an outfielder running down a fly ball, and a homing
            missile meeting a jet all solve the same problem with the same trick. ZeroMiss
            makes that hidden law visible, playable, and — because every run is reproducible
            from a seed and validated against the textbook — undeniable.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/arena" className="btn btn-primary">▶ Play the Arena</Link>
            <Link href="/play" className="btn">Watch an intercept →</Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
            <span className="chip">Python core · validated</span>
            <span className="chip">TS twin · cross-checked in CI</span>
            <span className="chip">ITAR-clean · public math</span>
          </div>
        </div>
        <div>
          <Theatre spec={PRESETS.the_weave} showCharts={false} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">The modes</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((m) => (
            <Link key={m.title} href={m.href} className="card group p-4 transition hover:border-cyan-dim">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-ink">{m.title}</span>
                <span className="chip">{m.tag}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{m.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">What is modelled</h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {MODELLED.map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-grid py-2">
              <span className="w-44 shrink-0 text-sm font-medium text-cyan">{k}</span>
              <span className="text-sm text-muted">{v}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
