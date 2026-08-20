// ─── Playground presets ────────────────────────────────
// Reusable default mock pools + scripted workloads so the
// Playground UI can load a realistic experiment in one click.

import { ScenarioStep, SimKey } from "./types";
import { MockKeySpec, makeKey } from "./scenario";

/** A realistic 3-key mock pool with different profiles. */
export function defaultMockPool(): SimKey[] {
  const specs: MockKeySpec[] = [
    {
      id: "k1",
      label: "Deepseek-V4 (large)",
      provider: "deepseek",
      contextWindow: 128000,
      tps: 140,
      timeToFirstTokenMs: 250,
      rpmLimit: 60,
      tpmLimit: 500_000,
      tpdLimit: 2_000_000,
      cacheDiscountFactor: 0.1,
    },
    {
      id: "k2",
      label: "MiMo (mid)",
      provider: "xiaomi",
      contextWindow: 64000,
      tps: 220,
      timeToFirstTokenMs: 150,
      rpmLimit: 30,
      tpmLimit: 200_000,
      rpdLimit: 50,
      tpdLimit: 800_000,
      cacheDiscountFactor: 0.05,
    },
    {
      id: "k3",
      label: "Free-Tier (small)",
      provider: "freetier",
      contextWindow: 16000,
      tps: 300,
      timeToFirstTokenMs: 100,
      rpmLimit: 10,
      tpmLimit: 60_000,
      rpdLimit: 20,
      tpdLimit: 120_000,
      cacheDiscountFactor: 0.2,
    },
  ];
  return specs.map(makeKey);
}

/** A long chat: prompt grows each turn (cache-stickiness stress test). */
export function growingChatScript(turns = 6, start = 20000, step = 5000): ScenarioStep[] {
  const out: ScenarioStep[] = [];
  for (let i = 1; i <= turns; i++) {
    out.push({
      id: i,
      request: {
        promptTokens: start + (i - 1) * step,
        completionBudget: 1024,
      },
      injectError: null,
    });
  }
  return out;
}

/** A script that mechanically forces every limit type, one at a time. */
export function errorInjectionScript(): ScenarioStep[] {
  return [
    { id: 1, request: { promptTokens: 5000, completionBudget: 1024 }, injectError: null },
    { id: 2, request: { promptTokens: 8000, completionBudget: 1024 }, injectError: "RPM" },
    { id: 3, request: { promptTokens: 9000, completionBudget: 1024 }, injectError: "TPM" },
    { id: 4, request: { promptTokens: 15000, completionBudget: 1024 }, injectError: "RPD" },
    { id: 5, request: { promptTokens: 16000, completionBudget: 1024 }, injectError: "TPD" },
    { id: 6, request: { promptTokens: 100000, completionBudget: 1024 }, injectError: "CONTEXT" },
  ];
}
