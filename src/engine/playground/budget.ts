// ─── Budget & Rolling-Window Accounting ────────────────
// Tracks rpm/tpm/rpd/tpd windows for a key and computes
// per-limit utilization. Mirrors the production rate limiter
// semantics but is pure (takes `now` explicitly).

import {
  KeyUsage,
  LimitName,
  LimitState,
  RequestSpec,
  SimKey,
} from "./types";

export const RPM_WINDOW_MS = 60_000;
export const TPM_WINDOW_MS = 60_000;
export const RPD_WINDOW_MS = 24 * 3600_000;
export const TPD_WINDOW_MS = 24 * 3600_000;

/** Fresh, empty usage record for a key. */
export function emptyUsage(): KeyUsage {
  return {
    rpm: [],
    tpm: [],
    rpd: [],
    tpd: [],
    lastUsedAt: null,
    totalTokensServed: 0,
    cachedTokensSaved: 0,
  };
}

function prune(now: number, windowMs: number, entries: number[] | { ts: number }[]): void {
  while (entries.length > 0 && now - (entries[0] as { ts: number }).ts >= windowMs) {
    entries.shift();
  }
}

/**
 * Prune expired entries from all windows. Mutates `usage` in place.
 */
export function pruneUsage(usage: KeyUsage, now: number): void {
  prune(now, RPM_WINDOW_MS, usage.rpm as unknown as { ts: number }[]);
  prune(now, TPM_WINDOW_MS, usage.tpm);
  prune(now, RPD_WINDOW_MS, usage.rpd);
  prune(now, TPD_WINDOW_MS, usage.tpd);
}

function sum<T>(entries: T[], get: (e: T) => number): number {
  return entries.reduce((s, e) => s + get(e), 0);
}

/**
 * Current per-limit state for a key. Unlimited limits report
 * ceiling=Infinity, remaining=Infinity, utilization=0.
 */
export function getLimitStates(key: SimKey, usage: KeyUsage, now: number): LimitState[] {
  pruneUsage(usage, now);

  const rpm = usage.rpm.length;
  const tpm = sum(usage.tpm, (e) => e.tokens);
  const rpd = usage.rpd.length;
  const tpd = sum(usage.tpd, (e) => e.tokens);

  const def = (used: number, ceiling: number | null, limit: LimitName): LimitState => {
    if (ceiling == null || ceiling <= 0) {
      return { limit, used, ceiling: Infinity, remaining: Infinity, utilization: 0 };
    }
    const utilization = used / ceiling;
    return {
      limit,
      used,
      ceiling,
      remaining: Math.max(0, ceiling - used),
      utilization,
    };
  };

  return [
    def(rpm, key.rpmLimit, "RPM"),
    def(tpm, key.tpmLimit, "TPM"),
    def(rpd, key.rpdLimit, "RPD"),
    def(tpd, key.tpdLimit, "TPD"),
  ];
}

/**
 * Overall utilization = the tightest (max) limit utilization.
 * Used for "exhaustability" ranking.
 */
export function getOverallUtilization(key: SimKey, usage: KeyUsage, now: number): number {
  const states = getLimitStates(key, usage, now);
  return Math.max(0, ...states.map((s) => s.utilization));
}

/** Context-window utilization for this specific request. */
export function getContextUtilization(key: SimKey, spec: RequestSpec): number {
  if (key.contextWindow <= 0) return 0;
  return (spec.promptTokens + spec.completionBudget) / key.contextWindow;
}

/** Whether the request fits in the key's context window. */
export function fitsContext(key: SimKey, spec: RequestSpec): boolean {
  if (key.contextWindow <= 0) return true; // no limit declared
  return spec.promptTokens + spec.completionBudget <= key.contextWindow;
}

/**
 * Detect limits that would trip for this request and that CANNOT be
 * reasonably waited out: CONTEXT overflow and the daily windows (RPD/TPD).
 * RPM/TPM are excluded because production can queue (short windows) —
 * the caller decides whether to wait. Returns the first hard limit hit,
 * or null.
 */
export function wouldTripHardLimit(
  key: SimKey,
  usage: KeyUsage,
  spec: RequestSpec,
  now: number
): LimitName | null {
  if (!fitsContext(key, spec)) return "CONTEXT";
  pruneUsage(usage, now);

  const states = getLimitStates(key, usage, now);
  for (const s of states) {
    if (s.ceiling === Infinity) continue;
    if (s.limit === "RPD" && s.used + 1 > s.ceiling) return "RPD";
    if (s.limit === "TPD" && s.used + spec.promptTokens > s.ceiling) return "TPD";
  }
  return null;
}

/**
 * Record a successful request on a key. `cachedTokens` are the prompt
 * tokens that were served from cache (discounted). Mutates usage in place.
 */
export function recordUsage(
  usage: KeyUsage,
  spec: RequestSpec,
  now: number,
  cachedTokens: number
): void {
  pruneUsage(usage, now);
  usage.rpm.push(now);
  usage.tpm.push({ ts: now, tokens: spec.promptTokens });
  usage.rpd.push({ ts: now });
  usage.tpd.push({ ts: now, tokens: spec.promptTokens });
  usage.totalTokensServed += spec.promptTokens;
  usage.cachedTokensSaved += cachedTokens;
  usage.lastUsedAt = now;
}
