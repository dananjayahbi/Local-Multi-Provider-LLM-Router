// ─── Penalty Mapping & Application ─────────────────────
// Task 04: penalty duration is chosen FROM the limit that was
// hit, not a uniform backoff. Hitting the daily token cap must
// penalize for ~a day; hitting RPM only needs ~a minute.

import { KeyStatus, LimitName, PenaltyInfo, SimKey } from "./types";

/** Seconds to penalize a key after hitting a given limit. */
export const LIMIT_PENALTY_SECONDS: Record<LimitName, number> = {
  RPM: 60, // window clears in ≤60s
  TPM: 120,
  RPD: 24 * 3600, // "10 minutes on a TPD hit is useless"
  TPD: 24 * 3600,
  CONTEXT: 0, // context overflow is per-request; no global penalty
};

/**
 * Apply a penalty to a copy of the key and return the updated key
 * plus a PenaltyInfo describing what happened.
 */
export function applyPenalty(key: SimKey, limit: LimitName, now: number): { key: SimKey; info: PenaltyInfo } {
  const penaltySeconds = LIMIT_PENALTY_SECONDS[limit];
  const nextLevel = key.penaltyLevel + 1;
  const expiresAt = now + penaltySeconds * 1000;

  const updated: SimKey = {
    ...key,
    status: (limit === "CONTEXT" ? key.status : "PENALIZED") as KeyStatus,
    penaltyLevel: limit === "CONTEXT" ? key.penaltyLevel : nextLevel,
    penaltyExpiresAt: limit === "CONTEXT" ? null : expiresAt,
  };

  return {
    key: updated,
    info: {
      keyId: key.id,
      limit,
      penaltySeconds,
      penaltyLevel: updated.penaltyLevel,
      expiresAt,
    },
  };
}

/** Recover a key whose penalty window has elapsed back to ACTIVE. */
export function recoverIfExpired(key: SimKey, now: number): SimKey {
  if (
    key.status === "PENALIZED" &&
    key.penaltyExpiresAt != null &&
    key.penaltyExpiresAt <= now
  ) {
    return {
      ...key,
      status: "ACTIVE",
      penaltyLevel: 0,
      penaltyExpiresAt: null,
    };
  }
  return key;
}
