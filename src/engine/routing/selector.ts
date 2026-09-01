// ─── Production Caching-Aware Selector ─────────────────
// Adapts the (playground-tested) pure `selectKey` algorithm to the
// production `RouteCandidate` shape, feeding it live per-key usage
// from the rate limiter so the orchestrator can order candidates by
// cache-stickiness, exhaustability, context-fit and rotation-cost.

import {
  RequestSpec,
  selectKey,
  emptyUsage,
  SelectorWeights,
  SimKey,
  KeyStatus,
} from "@/engine/playground";
import { getKeyUsageSnapshot } from "@/engine/rate-limit/api-key-rate-limiter";

/** A key as resolved by the gateway route (superset of the old CandidateKey). */
export interface RouteCandidate {
  apiKeyId: string;
  apiKeyLabel: string;
  secret?: string | null;
  secretEncrypted?: string | null;
  status: string;
  penaltyLevel: number;
  penaltyExpiresAt: Date | null;
  lastUsedAt: Date | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  tps: number | null;
  timeToFirstTokenMs: number | null;
  contextWindow: number | null;
  cacheCapable: boolean;
  cacheDiscountFactor: number;
}

export interface RouteConfig {
  stickyBudgetTokens: number;
  allowPenalized: boolean;
  cacheAware: boolean;
  weights?: Partial<SelectorWeights>;
}

export interface OrderedCandidate {
  candidate: RouteCandidate;
  score: number;
  utilization: number;
  reason: string;
}

function toSimKey(c: RouteCandidate): SimKey {
  return {
    id: c.apiKeyId,
    label: c.apiKeyLabel,
    provider: "",
    rpmLimit: c.rpmLimit,
    tpmLimit: c.tpmLimit,
    rpdLimit: c.rpdLimit,
    tpdLimit: c.tpdLimit,
    tps: c.tps,
    timeToFirstTokenMs: c.timeToFirstTokenMs ?? 200,
    contextWindow: c.contextWindow ?? 0,
    cacheCapable: c.cacheCapable,
    cacheDiscountFactor: c.cacheDiscountFactor ?? 0.1,
    status: c.status as KeyStatus,
    penaltyLevel: c.penaltyLevel,
    penaltyExpiresAt: c.penaltyExpiresAt ? c.penaltyExpiresAt.getTime() : null,
  };
}

/**
 * Order candidate keys best-first using the caching-aware algorithm.
 * Returns the ordered list, the top choice, and whether stickiness applied.
 */
export function orderCandidates(
  candidates: RouteCandidate[],
  spec: RequestSpec,
  currentKeyId: string | null,
  lastPromptTokens: number,
  config: RouteConfig
): { ordered: OrderedCandidate[]; chosenKeyId: string | null; stickyUsed: boolean } {
  if (candidates.length === 0) {
    return { ordered: [], chosenKeyId: null, stickyUsed: false };
  }

  const simKeys = candidates.map((c) => ({
    key: toSimKey(c),
    usage: getKeyUsageSnapshot(c.apiKeyId) ?? emptyUsage(),
  }));

  const result = selectKey(simKeys, spec, { currentKeyId, lastPromptTokens }, {
    allowPenalized: config.allowPenalized,
    stickyBudgetTokens: config.stickyBudgetTokens,
    weights: config.cacheAware ? config.weights : { sticky: 0, rotationCost: 0 },
  });

  // Map back to the original candidate order (best-first).
  const byId = new Map(candidates.map((c) => [c.apiKeyId, c]));
  const ordered: OrderedCandidate[] = result.candidates
    .filter((r) => byId.has(r.key.id))
    .map((r) => ({
      candidate: byId.get(r.key.id)!,
      score: r.score,
      utilization: r.utilization,
      reason: r.reasons.join("; "),
    }));

  return {
    ordered,
    chosenKeyId: result.chosenKeyId,
    stickyUsed: result.stickyUsed,
  };
}
