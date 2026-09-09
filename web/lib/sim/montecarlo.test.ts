import { describe, expect, it } from "vitest";

import { cep, pk, runCampaign } from "./montecarlo";
import { PRESETS } from "./presets";

describe("browser Monte-Carlo", () => {
  it("textbook_kill: high P_k against an easy CV target", () => {
    const acc = runCampaign(PRESETS.textbook_kill, 600, 1, { R0: [7000, 9000], HE_deg: 8 });
    expect(acc.n).toBe(600);
    expect(pk(acc)).toBeGreaterThan(0.8);
  });

  it("the_weave: returns sane P_k and CEP", () => {
    const acc = runCampaign(PRESETS.the_weave, 500, 2);
    expect(acc.n).toBe(500);
    expect(pk(acc)).toBeGreaterThanOrEqual(0);
    expect(pk(acc)).toBeLessThanOrEqual(1);
    expect(cep(acc)).toBeGreaterThanOrEqual(0);
  });

  it("harder evasion lowers P_k vs the easy case", () => {
    const easy = runCampaign(PRESETS.textbook_kill, 400, 3, { R0: [7000, 9000], HE_deg: 8 });
    const hard = runCampaign(PRESETS.bang_bang, 400, 3);
    expect(pk(hard)).toBeLessThanOrEqual(pk(easy) + 1e-9);
  });
});
