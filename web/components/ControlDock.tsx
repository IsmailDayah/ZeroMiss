"use client";

import type { ScenarioSpec } from "@/lib/sim/scenario";
import { cloneScenario } from "@/lib/sim/scenario";

const LAWS = [
  { id: "pursuit", label: "Pure Pursuit" },
  { id: "ppn", label: "Pure ProNav" },
  { id: "tpn", label: "True ProNav" },
  { id: "apn", label: "Augmented PN" },
  { id: "ogl", label: "ZEM / Optimal" },
];

const MANEUVERS = [
  { id: "constant_velocity", label: "Straight" },
  { id: "step", label: "Step Break" },
  { id: "weave", label: "Weave" },
  { id: "bang_bang", label: "Bang-Bang" },
];

function Slider({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tnum text-ink">
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        aria-label={label}
      />
    </label>
  );
}

export function ControlDock({
  spec,
  onChange,
}: {
  spec: ScenarioSpec;
  onChange: (s: ScenarioSpec) => void;
}) {
  const update = (mut: (s: ScenarioSpec) => void) => {
    const s = cloneScenario(spec);
    mut(s);
    onChange(s);
  };
  const g = spec.missile.guidance;
  const af = spec.missile.airframe;
  const sk = spec.missile.seeker;
  const man = spec.target.maneuver;

  return (
    <div className="card flex flex-col gap-4 p-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Guidance</h3>
        <div className="flex flex-wrap gap-1">
          {LAWS.map((l) => (
            <button
              key={l.id}
              onClick={() => update((s) => (s.missile.guidance.law = l.id))}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                g.law === l.id ? "border-cyan bg-cyan/10 text-cyan" : "border-grid text-muted hover:text-ink"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Slider label="Navigation constant N" value={g.N} min={2} max={6} step={0.5}
            onChange={(v) => update((s) => (s.missile.guidance.N = v))} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Airframe</h3>
        <Slider label="g-limit" value={af.aMaxG ?? 40} min={10} max={60} step={1} unit="g"
          onChange={(v) => update((s) => (s.missile.airframe.aMaxG = v))} />
        <div className="mt-2">
          <Slider label="Autopilot lag τ" value={af.autopilotTau ?? 0.2} min={0.05} max={1.0} step={0.05} unit="s"
            onChange={(v) => update((s) => (s.missile.airframe.autopilotTau = v))} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Seeker</h3>
        <label className="mb-2 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={!sk.ideal}
            onChange={(e) => update((s) => (s.missile.seeker.ideal = !e.target.checked))}
          />
          Realistic seeker (lag, noise, FOV)
        </label>
        {!sk.ideal && (
          <div className="flex flex-col gap-2">
            <Slider label="Angular noise" value={sk.noiseMrad ?? 1} min={0} max={10} step={0.5} unit="mrad"
              onChange={(v) => update((s) => (s.missile.seeker.noiseMrad = v))} />
            <Slider label="Seeker lag τ" value={sk.tau ?? 0.1} min={0} max={0.5} step={0.02} unit="s"
              onChange={(v) => update((s) => (s.missile.seeker.tau = v))} />
            <Slider label="Field of view" value={sk.fovDeg ?? 30} min={10} max={60} step={1} unit="°"
              onChange={(v) => update((s) => (s.missile.seeker.fovDeg = v))} />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={sk.glint ?? false}
                onChange={(e) => update((s) => (s.missile.seeker.glint = e.target.checked))} />
              Glint (range-dependent noise)
            </label>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Target</h3>
        <div className="mb-2 flex flex-wrap gap-1">
          {MANEUVERS.map((m) => (
            <button
              key={m.id}
              onClick={() => update((s) => (s.target.maneuver = { ...s.target.maneuver, type: m.id }))}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                man.type === m.id ? "border-amber bg-amber/10 text-amber" : "border-grid text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {man.type !== "constant_velocity" && (
          <Slider label="Maneuver g" value={man.amplitude_g ?? 9} min={0} max={15} step={1} unit="g"
            onChange={(v) => update((s) => (s.target.maneuver = { ...s.target.maneuver, amplitude_g: v }))} />
        )}
        {(man.type === "weave" || man.type === "bang_bang") && (
          <div className="mt-2">
            <Slider label="Period" value={man.period_s ?? 2} min={0.5} max={4} step={0.1} unit="s"
              onChange={(v) => update((s) => (s.target.maneuver = { ...s.target.maneuver, period_s: v }))} />
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan">Lethality</h3>
        <Slider label="Lethal radius" value={spec.termination.lethal_radius_m} min={1} max={25} step={1} unit="m"
          onChange={(v) => update((s) => (s.termination.lethal_radius_m = v))} />
      </div>
    </div>
  );
}
