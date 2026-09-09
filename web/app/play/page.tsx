"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ControlDock } from "@/components/ControlDock";
import { Theatre } from "@/components/Theatre";
import { PRESETS, PRESET_ORDER } from "@/lib/sim/presets";
import { cloneScenario, type ScenarioSpec } from "@/lib/sim/scenario";

function PlayInner() {
  const params = useSearchParams();
  const adv = params.get("adv") === "1";
  const presetParam = params.get("preset");
  const initialId = presetParam && PRESETS[presetParam] ? presetParam : "the_weave";

  const [presetId, setPresetId] = useState(initialId);
  const [spec, setSpec] = useState<ScenarioSpec>(() => cloneScenario(PRESETS[initialId]));
  const [runKey, setRunKey] = useState(0);

  const selectPreset = (id: string) => {
    setPresetId(id);
    setSpec(cloneScenario(PRESETS[id]));
    setRunKey((k) => k + 1);
  };

  const onChange = (s: ScenarioSpec) => {
    setSpec(s);
    setRunKey((k) => k + 1);
  };

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">{adv ? "Sandbox" : "Watch"}</h1>
        {PRESET_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => selectPreset(id)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              presetId === id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"
            }`}
          >
            {PRESETS[id].name}
          </button>
        ))}
      </div>
      <p className="mb-4 max-w-prose text-sm text-muted">{spec.description}</p>

      <div className={`grid gap-4 ${adv ? "lg:grid-cols-[1fr_320px]" : ""}`}>
        <Theatre key={runKey} spec={spec} seed={spec.seed} />
        {adv && <ControlDock spec={spec} onChange={onChange} />}
      </div>
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="py-10 text-muted">Loading…</div>}>
      <PlayInner />
    </Suspense>
  );
}
