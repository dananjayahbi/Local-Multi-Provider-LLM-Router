// ─── Caching-Aware Key Selector ─────────────────────────
// Tasks 03 & 05. Pure ranking pipeline:
//   1. FILTER  – drop DISABLED / SUSPENDED keys.
//   2. FIT     – drop keys whose context window can't hold the request.
//   3. STICKY  – strong bonus for the current conversation key (cache).
//   4. SCORE   – exhaustability, context-fit, rotation-cost, speed.
//   5. RANK    – pick best; if it's already at a hard limit, the caller
//                applies a scaled penalty and re-runs.

import {
  ConversationCtx,
  KeyUsage,
  RankedCandidate,
  RequestSpec,
  SelectResult,
  SimKey,
} from "./types";
import {
  fitsContext,
  getContextUtilization,
  getLimitStates,
  getOverallUtilization,
  wouldTripHardLimit,
} from "./budget";

export interface SelectorWeights {
  sticky: number; // bonus for staying on the conversation's current key
  exhaust: number; // weight for "most likely exhaustable" first
  contextFit: number; // weight for smallest-fit context window
  speed: number; // weight for tps / ttft
  rotationCost: number; // weight penalizing loss of cached prefix on switch
}

export const DEFAULT_WEIGHTS: SelectorWeights = {
  sticky: 100,
  exhaust: 1.0,
  contextFit: 0.6,
  speed: 0.2,
  rotationCost: 0.8,
};

export interface SelectOptions {
  weights?: Partial<SelectorWeights>;
  now?: number;
  allowPenalized?: boolean; // fallback: use penalized keys if no ACTIVE fits
  stickyBudgetTokens?: number; // keep current key while prompt stays under window-budget
  excludedKeyIds?: string[]; // skip these keys entirely (per-step failover exclusion)
}

/**
 * Compute the cached-prefix tokens that would be lost if we switch
 * away from `currentKey` for this request (prefix overlap of the two
 * most recent prompts on that key).
 */
export function cachedPrefixLoss(
  ctx: ConversationCtx,
  request: RequestSpec
): number {
  if (ctx.currentKeyId == null || ctx.lastPromptTokens <= 0) return 0;
  return Math.min(ctx.lastPromptTokens, request.promptTokens);
}

/**
 * Score a single candidate.
 */
function scoreCandidate(
  key: SimKey,
  usage: KeyUsage,
  request: RequestSpec,
  ctx: ConversationCtx,
  weights: SelectorWeights,
  now: number,
  isSticky: boolean,
  rotationCostTokens: number,
  largestFittingWindow: number
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1) Sticky bonus (cache preservation) — dominates.
  if (isSticky) {
    const cached = cachedPrefixLoss(ctx, request);
    score += weights.sticky;
    reasons.push(`sticky (+${weights.sticky}), preserves ${cached} cached tokens`);
  }

  // 2) Exhaustability: prefer keys closest to a hard limit so we burn
  //    them down in order ("jump to the middle/top" only when forced).
  const utilization = getOverallUtilization(key, usage, now);
  const utilScore = utilization * weights.exhaust;
  score += utilScore;
  reasons.push(`utilization ${(utilization * 100).toFixed(1)}% (+${utilScore.toFixed(2)})`);

  // 3) Context fit: for SMALL requests prefer the SMALLEST window that
  //    fits (don't waste the big-context key). Score inversely to the
  //    window size relative to the largest fitting window.
  const largestWindow = Math.max(1, largestFittingWindow);
  const windowRatio = key.contextWindow > 0 ? key.contextWindow / largestWindow : 1;
  const fitScore = (1 - windowRatio) * weights.contextFit;
  score += fitScore;
  reasons.push(`context ${key.contextWindow}/${largestWindow} (+${fitScore.toFixed(2)})`);

  // 4) Rotation cost: switching loses the cached prefix (discount).
  if (!isSticky) {
    const lost = rotationCostTokens * key.cacheDiscountFactor;
    score -= lost * weights.rotationCost;
    if (lost > 0) reasons.push(`rotation loses ${lost.toFixed(0)} discounted tokens`);
  }

  // 5) Speed tiebreaker.
  const tps = key.tps && key.tps > 0 ? key.tps : 1;
  const speedScore = Math.min(1, tps / 500) * weights.speed;
  score += speedScore;
  reasons.push(`speed ${key.tps ?? "?"} tps (+${speedScore.toFixed(2)})`);

  return { score, reasons };
}

/**
 * Select the best key for `request` from `keys` (each paired with usage).
 * Returns a ranked, scored candidate list plus a decision summary.
 */
export function selectKey(
  keys: Array<{ key: SimKey; usage: KeyUsage }>,
  request: RequestSpec,
  ctx: ConversationCtx,
  options: SelectOptions = {}
): SelectResult {
  const now = options.now ?? Date.now();
  const weights: SelectorWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const events: SelectResult["events"] = [];
  const rotationCostTokens = cachedPrefixLoss(ctx, request);

  // Phase A: recover expired penalties at selection time (cheap, pure).
  keys = keys.map(({ key, usage }) => {
    if (key.status === "PENALIZED" && key.penaltyExpiresAt != null && key.penaltyExpiresAt <= now) {
      return { key: { ...key, status: "ACTIVE", penaltyLevel: 0, penaltyExpiresAt: null }, usage };
    }
    return { key, usage };
  });

  // Phase B: keep ACTIVE keys; set aside penalized ones for fallback.
  const excluded = new Set(options.excludedKeyIds ?? []);
  const penalizedKeys = keys.filter(({ key }) => key.status === "PENALIZED" && !excluded.has(key.id));
  const eligible = keys.filter(
    ({ key }) => key.status === "ACTIVE" && !excluded.has(key.id)
  );
  for (const k of keys) {
    if (
      k.key.status === "DISABLED" ||
      k.key.status === "SUSPENDED" ||
      excluded.has(k.key.id)
    ) {
      events.push({ kind: "filter", keyId: k.key.id, reason: `${k.key.status}${excluded.has(k.key.id) ? "/excluded" : ""}` });
    }
  }

  // Phase C: fit — drop keys that cannot hold the request OR that would
  // immediately trip a hard, un-waitable limit (CONTEXT overflow / RPD/TPD).
  let fitting = eligible.filter(({ key, usage }) => {
    const hard = wouldTripHardLimit(key, usage, request, now);
    if (hard) {
      events.push({
        kind: hard === "CONTEXT" ? "fit" : "filter",
        keyId: key.id,
        ...(hard === "CONTEXT"
          ? {
              needed: request.promptTokens + request.completionBudget,
              window: key.contextWindow,
            }
          : { reason: `${hard} would trip immediately` }),
      } as any);
      return false;
    }
    return true;
  });

  // Fallback: if nothing ACTIVE fits, allow penalized (non-excluded) keys.
  if (fitting.length === 0 && options.allowPenalized) {
    fitting = penalizedKeys.filter(
      ({ key, usage }) => !wouldTripHardLimit(key, usage, request, now)
    );
  }
  if (fitting.length === 0) {
    return {
      chosenKeyId: null,
      candidates: [],
      reason: "No key can fit the request or a daily/context limit would trip.",
      stickyUsed: false,
      rotationLostCacheTokens: rotationCostTokens,
      events,
    };
  }

  const stickyKeyId = ctx.currentKeyId;

  // Determine sticky eligibility: current key must still be present, fit,
  // and (if a sticky budget is set) the prompt must stay under the window
  // minus the budget so we don't risk an imminent overflow.
  const stickyCandidate = fitting.find(({ key }) => key.id === stickyKeyId);
  let isSticky = false;
  if (stickyCandidate) {
    const budget = options.stickyBudgetTokens ?? 0;
    const headroom =
      stickyCandidate.key.contextWindow > 0
        ? stickyCandidate.key.contextWindow - (request.promptTokens + request.completionBudget)
        : Infinity;
    isSticky = stickyCandidate.key.cacheCapable && headroom >= budget;
    if (isSticky) {
      events.push({
        kind: "sticky",
        keyId: stickyCandidate.key.id,
        cachedTokens: rotationCostTokens,
      });
    }
  }

  const largestFittingWindow = Math.max(
    0,
    ...fitting.map(({ key }) => key.contextWindow)
  );

  const ranked: RankedCandidate[] = fitting.map(({ key, usage }) => {
    const { score, reasons } = scoreCandidate(
      key,
      usage,
      request,
      ctx,
      weights,
      now,
      key.id === stickyKeyId && isSticky,
      rotationCostTokens,
      largestFittingWindow
    );
    return {
      key,
      score,
      utilization: getOverallUtilization(key, usage, now),
      fits: true,
      reasons,
    };
  });

  // Deterministic tiebreak: id.
  ranked.sort((a, b) => b.score - a.score || a.key.id.localeCompare(b.key.id));
  for (const c of ranked) {
    events.push({ kind: "rank", keyId: c.key.id, score: c.score, utilization: c.utilization });
  }

  const chosen = ranked[0];
  const reason = isSticky
    ? `Stayed on current key (${chosen.key.label}) to preserve prompt cache.`
    : `Chose ${chosen.key.label} (score ${chosen.score.toFixed(2)}).`;

  return {
    chosenKeyId: chosen.key.id,
    candidates: ranked,
    reason,
    stickyUsed: isSticky,
    rotationLostCacheTokens: rotationCostTokens,
    events,
  };
}

// ── Re-export helpers used by the scenario engine ──────
export { getLimitStates, getOverallUtilization, fitsContext };
