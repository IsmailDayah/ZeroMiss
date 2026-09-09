"use client";

import Link from "next/link";

import { Theatre } from "@/components/Theatre";
import { PRESETS } from "@/lib/sim/presets";

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-prose py-10">{children}</section>;
}

export default function LearnPage() {
  return (
    <div className="py-4">
      <Section>
        <h1 className="text-3xl font-bold">From frisbees to missiles</h1>
        <p className="mt-3 text-muted">
          Imagine running to catch a frisbee. The naive move is to sprint at where it{" "}
          <em>is</em> — but it keeps moving, so you curve in behind it and arrive late. Every
          good outfielder learns a better trick without being told.
        </p>
      </Section>

      <Section>
        <h2 className="text-2xl font-semibold text-amber">The naive way: pure pursuit</h2>
        <p className="mt-3 text-muted">
          Point straight at the target and chase. Watch the line of sight (the faint lines)
          <strong> fan out</strong> as the angle keeps changing — that drift is wasted effort,
          and it shows up as a long curved tail chase.
        </p>
        <div className="mt-4">
          <Theatre spec={PRESETS.tail_chase} showCharts={false} />
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-semibold text-cyan">The trick: constant bearing</h2>
        <p className="mt-3 text-muted">
          Now steer so the target stays at the <strong>same angle</strong> in your view — not
          drifting left, not right. The line-of-sight ghosts <strong>stack on one bearing</strong>{" "}
          while the range collapses. Constant bearing, decreasing range: you are on a collision
          course. You will meet.
        </p>
        <div className="mt-4">
          <Theatre spec={PRESETS.textbook_kill} showCharts={false} />
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-semibold">That is Proportional Navigation</h2>
        <p className="mt-3 text-muted">
          The rule is almost insultingly simple: <strong>turn at a rate proportional to how fast
          the target drifts across your view</strong>. Drift fast → turn hard. No drift → fly
          straight, you have it. The &ldquo;aggressiveness&rdquo; dial is the navigation
          constant <span className="tnum text-cyan">N</span> (usually 3–5). The same law guides a
          falcon, a dog snapping a frisbee, and virtually every homing missile since the 1950s.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/play?adv=1" className="btn btn-primary">Tune it yourself →</Link>
          <Link href="/duel" className="btn">Try to escape it →</Link>
          <Link href="/compare" className="btn">N=3 vs N=5 →</Link>
        </div>
      </Section>
    </div>
  );
}
