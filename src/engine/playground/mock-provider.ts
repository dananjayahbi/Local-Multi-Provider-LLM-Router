// ─── Mock Provider Simulator ───────────────────────────
// Task 09: emulate a real upstream API key against a request.
// It records usage into rolling windows and, given an injected
// error limit, mechanically reports the corresponding failure so
// the scenario engine can watch the selector react.

import {
  KeyUsage,
  LimitName,
  MockOutcome,
  RequestSpec,
  SimKey,
} from "./types";
import { getLimitStates, recordUsage, wouldTripHardLimit } from "./budget";

/** Compute cached tokens for a request on a key, given the last prompt size. */
export function cachedTokensFor(key: SimKey, spec: RequestSpec, lastPromptTokens: number): number {
  if (!key.cacheCapable) return 0;
  if (lastPromptTokens <= 0) return 0;
  return Math.min(lastPromptTokens, spec.promptTokens);
}

/**
 * Check whether a request would trip any limit on this key at `now`,
 * given the current usage. Optionally force a specific `injectError`.
 */
export function checkLimits(
  key: SimKey,
  usage: KeyUsage,
  spec: RequestSpec,
  now: number,
  injectError: LimitName | null
): LimitName | null {
  if (injectError) return injectError;

  // Reuse the hard-limit (CONTEXT/RPD/TPD) check first.
  const hard = wouldTripHardLimit(key, usage, spec, now);
  if (hard) return hard;

  // Token-based limits (TPM/TPD) count prompt tokens; RPM/RPD count requests.
  const states = getLimitStates(key, usage, now);
  for (const s of states) {
    if (s.ceiling === Infinity) continue;
    if (s.used >= s.ceiling) return s.limit; // already at cap → new request trips it
    if (s.limit === "TPM" && s.used + spec.promptTokens > s.ceiling) return "TPM";
    if (s.limit === "RPM" && s.used + 1 > s.ceiling) return "RPM";
  }
  return null;
}

/**
 * Simulate a request against a key. If it fails, no usage is recorded
 * (the request is rejected). If it succeeds, usage is recorded and the
 * cached-token discount is accounted.
 */
export function simulateRequest(
  key: SimKey,
  usage: KeyUsage,
  spec: RequestSpec,
  now: number,
  injectError: LimitName | null = null,
  lastPromptTokens = 0
): MockOutcome {
  const limit = checkLimits(key, usage, spec, now, injectError);
  if (limit) {
    return { ok: false, limit, detail: `hit ${limit}` };
  }

  const cached = cachedTokensFor(key, spec, lastPromptTokens);
  recordUsage(usage, spec, now, cached);
  return { ok: true, tokensUsed: spec.promptTokens, cachedTokens: cached };
}
