// ─── Scenario Engine ───────────────────────────────────
// Task 09: run a scripted workload against a mock pool, mechanically
// inject errors, and record the full decision trace so the Playground
// UI can show exactly how the caching-aware selector + penalties +
// Copilot injection behave.

import {
  KeyUsage,
  LimitName,
  RequestSpec,
  ScenarioStep,
  SelectResult,
  SimKey,
  TraceEvent,
} from "./types";
import { emptyUsage } from "./budget";
import { applyPenalty } from "./penalty";
import { selectKey, SelectorWeights } from "./selector";
import { simulateRequest } from "./mock-provider";
import { buildInjection, InjectionInput, TemplateName } from "./injection";

// ─── Helpers for rotation injection ────────────────────

/** Extract the hard-limit reason a key was pre-excluded by the selector. */
function rotationLimitFromEvents(result: SelectResult, prevKeyId: string): LimitName | null {
  const ev = result.events.find((e) => e.keyId === prevKeyId);
  if (!ev || ev.kind === "rank" || ev.kind === "sticky") return null;
  if (ev.kind === "fit") return "CONTEXT";
  // filter events may carry `reason` like "TPD would trip immediately"
  const reason = (ev as { reason?: string }).reason ?? "";
  if (reason.startsWith("RPD")) return "RPD";
  if (reason.startsWith("TPD")) return "TPD";
  return null;
}

function prevKeyLabel(states: Map<string, ScenarioKeyState>, keyId: string): string {
  return states.get(keyId)?.key.label ?? keyId;
}

export interface ScenarioOptions {
  weights?: Partial<SelectorWeights>;
  allowPenalized?: boolean;
  stickyBudgetTokens?: number;
  injectionTemplate?: TemplateName;
  emitInjection?: boolean; // emit a Copilot injection event on rotation
}

export interface ScenarioKeyState {
  key: SimKey;
  usage: KeyUsage;
}

export interface ScenarioResult {
  keys: SimKey[]; // final state of each key (after penalties)
  usage: Record<string, KeyUsage>;
  trace: TraceEvent[];
  rotationCount: number;
  cachedTokensSaved: number;
  totalPromptTokens: number;
}

/**
 * Run a scripted scenario. `ctxKeyId` starts as `stickyStartKeyId` to
 * model an already-in-progress conversation on that key.
 */
export function runScenario(
  initialKeys: SimKey[],
  steps: ScenarioStep[],
  options: ScenarioOptions = {},
  stickyStartKeyId: string | null = null
): ScenarioResult {
  const states = new Map<string, ScenarioKeyState>(
    initialKeys.map((k) => [k.id, { key: { ...k }, usage: emptyUsage() }])
  );

  const trace: TraceEvent[] = [];
  let rotationCount = 0;
  let cachedTokensSaved = 0;
  let totalPromptTokens = 0;

  let currentKeyId: string | null = stickyStartKeyId;
  let lastPromptTokens = 0;

  for (const step of steps) {
    const now = Date.now() + step.id * 1000;
    totalPromptTokens += step.request.promptTokens;

    // ── Failover loop: select a key, simulate; on a limit, penalize the
    //    key (with scaled cooldown), emit an injection event, and retry
    //    with the remaining candidates until success or exhaustion. ──
    let servedKeyId: string | null = null;
    const excludedThisStep = new Set<string>();
    // injectError simulates "the first routed key trips this limit"; it must
    // apply ONLY to the first attempt so failover retries behave normally.
    let stepError: LimitName | null = step.injectError;

    while (true) {
      const ctx = { currentKeyId, lastPromptTokens };
      const result = selectKey(
        Array.from(states.values()).map(({ key, usage }) => ({ key, usage })),
        step.request,
        ctx,
        {
          weights: options.weights,
          now,
          allowPenalized: options.allowPenalized,
          stickyBudgetTokens: options.stickyBudgetTokens,
          excludedKeyIds: Array.from(excludedThisStep),
        }
      );

      if (!result.chosenKeyId) {
        trace.push({
          step: step.id,
          kind: "note",
          message: "No eligible key — request rejected.",
          detail: result.reason,
        });
        break;
      }

      const st = states.get(result.chosenKeyId)!;
      const wasSticky = currentKeyId != null && result.chosenKeyId === currentKeyId;

      // Simulate the request against the chosen key.
      const outcome = simulateRequest(
        st.key,
        st.usage,
        step.request,
        now,
        stepError,
        wasSticky ? lastPromptTokens : 0
      );
      stepError = null; // only the first attempt can be force-failed

      if (outcome.ok) {
        cachedTokensSaved += outcome.cachedTokens;
        trace.push({
          step: step.id,
          kind: "route",
          message: `${wasSticky ? "Stayed on" : "Routed to"} ${st.key.label}`,
          detail: `${outcome.tokensUsed} in / ${outcome.cachedTokens} cached. ${result.reason}`,
        });
        if (!wasSticky && currentKeyId != null) {
          rotationCount++;
          trace.push({
            step: step.id,
            kind: "note",
            message: `Rotation: ${currentKeyId} → ${st.key.id} (loses ${result.rotationLostCacheTokens} cached tokens)`,
          });
          // Rotation makes the chat context uncached on the new key — ask the
          // user whether to switch directly or compact first (Copilot injection).
          if (options.emitInjection) {
            const reasonLimit = rotationLimitFromEvents(result, currentKeyId);
            const injection = buildInjection(options.injectionTemplate ?? "compact_first", {
              keyLabel: prevKeyLabel(states, currentKeyId),
              limitName: reasonLimit ?? "TPD",
              nextKeyLabel: st.key.label,
              promptTokens: step.request.promptTokens,
              lastPromptTokens,
            } satisfies InjectionInput);
            trace.push({
              step: step.id,
              kind: "injection",
              message: `Copilot askQuestion injection requested (rotation)`,
              detail: injection,
            });
          }
        }
        servedKeyId = st.key.id;
        break;
      }

      // Hit a limit → scaled penalty (context overflow skips instead).
      trace.push({
        step: step.id,
        kind: "penalty",
        message: `${st.key.label} hit ${outcome.limit}`,
        detail: outcome.detail,
      });

      if (outcome.limit !== "CONTEXT") {
        const { key: penalized } = applyPenalty(st.key, outcome.limit, now);
        st.key = penalized;
        trace.push({
          step: step.id,
          kind: "penalty",
          message: `Penalized ${penalized.label} (${outcome.limit})`,
          detail: `penaltyLevel=${penalized.penaltyLevel}, expires in ${(penalized.penaltyExpiresAt! - now) / 1000}s`,
        });
      }

      // Copilot injection: rotating due to a limit asks the user whether to
      // switch directly or compact the chat first.
      if (options.emitInjection && outcome.limit !== "CONTEXT") {
        const next = result.candidates.find((c) => c.key.id !== st.key.id);
        const injection = buildInjection(options.injectionTemplate ?? "compact_first", {
          keyLabel: st.key.label,
          limitName: outcome.limit,
          nextKeyLabel: next?.key.label ?? null,
          promptTokens: step.request.promptTokens,
          lastPromptTokens,
        } satisfies InjectionInput);
        trace.push({
          step: step.id,
          kind: "injection",
          message: `Copilot askQuestion injection requested (${outcome.limit})`,
          detail: injection,
        });
      }

      // Exclude the just-failed key from further attempts this step.
      excludedThisStep.add(st.key.id);
    }

    // Track conversation cursor for cache stickiness.
    currentKeyId = servedKeyId;
    if (servedKeyId) lastPromptTokens = step.request.promptTokens;
  }

  return {
    keys: Array.from(states.values()).map(({ key }) => key),
    usage: Object.fromEntries(
      Array.from(states.entries()).map(([id, { usage }]) => [id, usage])
    ),
    trace,
    rotationCount,
    cachedTokensSaved,
    totalPromptTokens,
  };
}

// ── Helpers to build mock pools & scripts ──────────────

export interface MockKeySpec {
  id: string;
  label: string;
  provider: string;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  rpdLimit?: number | null;
  tpdLimit?: number | null;
  tps?: number | null;
  timeToFirstTokenMs?: number;
  contextWindow: number;
  cacheDiscountFactor?: number;
  cacheCapable?: boolean;
}

export function makeKey(spec: MockKeySpec): SimKey {
  return {
    id: spec.id,
    label: spec.label,
    provider: spec.provider,
    rpmLimit: spec.rpmLimit ?? null,
    tpmLimit: spec.tpmLimit ?? null,
    rpdLimit: spec.rpdLimit ?? null,
    tpdLimit: spec.tpdLimit ?? null,
    tps: spec.tps ?? 100,
    timeToFirstTokenMs: spec.timeToFirstTokenMs ?? 200,
    contextWindow: spec.contextWindow,
    cacheCapable: spec.cacheCapable ?? true,
    cacheDiscountFactor: spec.cacheDiscountFactor ?? 0.1,
    status: "ACTIVE",
    penaltyLevel: 0,
    penaltyExpiresAt: null,
  };
}

export function req(promptTokens: number, completionBudget = 1024, injectError: LimitName | null = null): ScenarioStep {
  return { id: 0, request: { promptTokens, completionBudget }, injectError };
}
