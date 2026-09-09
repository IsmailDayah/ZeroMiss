"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { Theatre } from "@/components/Theatre";
import { PRESETS } from "@/lib/sim/presets";
import { cloneScenario } from "@/lib/sim/scenario";

const KNOWN_LAWS = new Set(["pursuit", "ppn", "tpn", "apn", "ogl", "zem"]);

function Inner({ seed }: { seed: number }) {
  const params = useSearchParams();
  const presetParam = params.get("preset") ?? "the_weave";
  // preset may be a preset id OR a scenario display name (share links use the name)
  const base =
    PRESETS[presetParam] ??
    Object.values(PRESETS).find((p) => p.name === presetParam) ??
    PRESETS.the_weave;
  const spec = cloneScenario(base);
  spec.seed = seed;
  const law = params.get("law");
  const N = params.get("N");
  if (law && KNOWN_LAWS.has(law.toLowerCase())) spec.missile.guidance.law = law.toLowerCase();
  const nNum = N ? parseFloat(N) : NaN;
  if (Number.isFinite(nNum) && nNum >= 1 && nNum <= 10) spec.missile.guidance.N = nNum;

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Replay</h1>
        <span className="chip">seed {seed}</span>
        <span className="chip">{spec.name}</span>
        <span className="chip">{spec.missile.guidance.law.toUpperCase()} · N={spec.missile.guidance.N}</span>
      </div>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Reconstructed deterministically from the seed — the exact same run, byte-for-byte in the
        validated twin. Nothing here is cherry-picked.
      </p>
      <Theatre key={`${seed}-${spec.missile.guidance.law}-${spec.missile.guidance.N}`} spec={spec} seed={seed} />
    </div>
  );
}

export function ReplayClient({ seed }: { seed: number }) {
  return (
    <Suspense fallback={<div className="py-10 text-muted">Loading…</div>}>
      <Inner seed={seed} />
    </Suspense>
  );
}
