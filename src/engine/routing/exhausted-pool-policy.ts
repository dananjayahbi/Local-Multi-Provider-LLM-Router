// ─── Exhausted-Pool Cost Policy ────────────────────────
// Task 02: the pre-defined "pool exhausted" message should ONLY be delivered
// when every key in the pool is exhausted AND the lowest pending penalty is
// longer than EXHAUSTED_MIN_PENALTY_MS (default 30 min = 1800s). Otherwise the
// request stays in the queue (via the pool-recovery wait) until a key's penalty
// expires and it is released back to ACTIVE. An autonomous agent simply waits —
// it does not care about wall-clock time.
//
// When the lowest penalty is SHORT, we hold the request and let the pool-recovery
// loop flip the key back to ACTIVE, then retry. When all penalties are LONG, we
// conclude the pool is genuinely down for the foreseeable future and emit the
// "pool exhausted" completion so the agent STOPS (it would otherwise hang).

/**
 * Minimum remaining penalty (ms) before a fully-exhausted pool emits the
 * "pool exhausted" completion instead of continuing to wait. Default 30 min.
 * Overridable via EXHAUSTED_MIN_PENALTY_MS (seconds).
 */
export const DEFAULT_EXHAUSTED_MIN_PENALTY_MS = 30 * 60 * 1000; // 30 minutes

/** Resolve the configured minimum penalty threshold (ms). */
export function exhaustedMinPenaltyMs(): number {
  const raw = process.env.EXHAUSTED_MIN_PENALTY_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_EXHAUSTED_MIN_PENALTY_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXHAUSTED_MIN_PENALTY_MS;
  return parsed * 1000;
}

export interface PoolKeyPenaltyInfo {
  status: string;
  penaltyExpiresAt: Date | null;
}

/**
 * Find the SHORTEST remaining penalty (ms) among the pool's keys. Returns null
 * when no key has a future penalty (nothing bounded to wait on), which means the
 * pool is either recoverable-immediately or truly terminal (no timed recovery).
 */
export function lowestRemainingPenaltyMs(keys: PoolKeyPenaltyInfo[]): number | null {
  const now = Date.now();
  let lowest: number | null = null;
  for (const k of keys) {
    if (k.status !== "PENALIZED" && k.status !== "COOLDOWN") continue;
    if (k.penaltyExpiresAt == null) continue;
    const remaining = k.penaltyExpiresAt.getTime() - now;
    if (remaining <= 0) continue; // already expired → recoverable immediately
    if (lowest == null || remaining < lowest) lowest = remaining;
  }
  return lowest;
}

/**
 * Whether a fully-exhausted pool should emit the "pool exhausted" completion
 * (true) or keep waiting for recovery (false). Returns false when there is a
 * reasonably-short pending penalty to wait on. Returns true when all pending
 * penalties are longer than the threshold, OR when nothing is time-bound
 * (terminal state — no point waiting).
 */
export function shouldEmitExhaustedCompletion(keys: PoolKeyPenaltyInfo[]): boolean {
  const lowest = lowestRemainingPenaltyMs(keys);
  // No future penalty to wait on → terminal (suspended/disabled/no timed key).
  // Nothing will recover on its own, so telling the agent to stop is correct.
  if (lowest == null) return true;
  return lowest > exhaustedMinPenaltyMs();
}
