// ─── Retry Backoff (silent server-error retry) ─────────
// Task 04: when the upstream provider returns a *transient, non-limit* error
// (5xx server error, network failure, or an unrecognized/unknown error), we do
// NOT penalize the key immediately. Instead we silently retry the SAME key with
// an increasing backoff so an autonomous agent never sees a spurious failure.
// Only after the retry budget is exhausted do we apply a LEVEL-1 penalty.
//
// The wait sequence after each failed attempt (before the next retry):
//
//   initial fail → wait 3s  → retry 1
//   retry 1 fail → wait 6s  → retry 2
//   retry 2 fail → wait 10s → retry 3
//   retry 3 fail → wait 15s → retry 4
//   retry 4 fail → wait 30s → retry 5
//   retry 5 fail → apply LEVEL-1 penalty (no more silent retries)
//
// RATE_LIMITED / QUOTA_EXCEEDED / AUTH_ERROR / INVALID_REQUEST are NOT retried
// here — they are handled by the penalty / rejection paths elsewhere.

/**
 * Wait (ms) inserted BEFORE each subsequent retry, indexed by how many failures
 * we've already seen. `BACKOFF_AFTER_FAILURE[i]` is the wait after failure `i`
 * (0-based). There are 5 waits → 6 total attempts (initial + 5 retries).
 */
export const RETRY_BACKOFF_MS: readonly number[] = [3_000, 6_000, 10_000, 15_000, 30_000];

/** Number of silent retries after the initial attempt (5). */
export const MAX_RETRIES = RETRY_BACKOFF_MS.length;

/** Max number of upstream attempts before applying the penalty (initial + retries). */
export const MAX_ATTEMPTS = MAX_RETRIES + 1;

/**
 * Whether a classified error is worth silent-retrying (transient, non-limit).
 * Rate limits and quota are NOT retried here — they have their own penalty
 * semantics. Invalid requests and auth errors are terminal.
 */
export function isRetriable(classification: string): boolean {
  return (
    classification === "SERVER_ERROR" ||
    classification === "NETWORK_ERROR" ||
    classification === "UNKNOWN"
  );
}

/**
 * The backoff wait (ms) to apply after `failedAttempts` have already failed.
 * Returns 0 once the retry budget is exhausted (caller should penalize).
 * @param failedAttempts Number of failed attempts so far (1 = initial failure).
 */
export function backoffAfterFailure(failedAttempts: number): number {
  // Index into RETRY_BACKOFF_MS: after 1 failure → wait[0], after 2 → wait[1], etc.
  const idx = failedAttempts - 1;
  if (idx < 0 || idx >= RETRY_BACKOFF_MS.length) return 0;
  return RETRY_BACKOFF_MS[idx];
}
