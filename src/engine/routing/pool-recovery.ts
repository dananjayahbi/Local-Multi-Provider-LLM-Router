// ─── Pool Recovery Wait ────────────────────────────────
// When a pool has NO routable (ACTIVE) key but its keys are in a *recoverable*
// state (PENALIZED/COOLDOWN with a future or just-expired penaltyExpiresAt),
// the caller may choose to WAIT for one to become healthy again instead of
// immediately surfacing a hard failure. This lets an autonomous client (e.g.
// Copilot) hold its request and get the answer once a key recovers — it never
// sees an error; it just waits.
//
// Tunable via RECOVERY_WAIT_MAX_SECONDS (default 600 = 10 min). Set to 0 to
// disable the wait and fall straight back to the exhausted-pool response.

import { prisma } from "@/lib/prisma";
import {
  checkAndRecoverExpiredPenalties,
  checkAndRecoverExpiredCooldowns,
} from "@/engine/health-engine";

/** Default max time to hold a request waiting for a key to recover. */
export const DEFAULT_RECOVERY_WAIT_MS = 240_000; // 4 minutes (under the 5-min route maxDuration)
/** How often the recovery loop re-checks the DB. */
export const RECOVERY_POLL_MS = 2_000;
/** Hard ceiling so a misconfigured env can't cause a multi-hour hang. Kept under
 *  the gateway route's maxDuration (300s) so the wait completes before the
 *  function is cut off. */
const MAX_RECOVERY_WAIT_MS = 240_000; // 4 minutes

/** Resolve the configured max wait (ms). 0 disables waiting entirely. */
export function recoveryWaitMaxMs(): number {
  const raw = process.env.RECOVERY_WAIT_MAX_SECONDS;
  if (raw == null || raw.trim() === "") return DEFAULT_RECOVERY_WAIT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0; // 0 = disabled
  return Math.min(parsed * 1000, MAX_RECOVERY_WAIT_MS);
}

export interface PoolRecoveryKey {
  status: string;
  penaltyExpiresAt: Date | null;
}

export interface PoolRecoveryInfo {
  /** Whether at least one key is currently routable (ACTIVE). */
  hasActive: boolean;
  /** Whether at least one key will recover on its own (time-based state). */
  recoverable: boolean;
  /** Epoch ms when the soonest recoverable key will be healthy, or null. */
  earliestRecoveryAt: number | null;
}

/**
 * Inspect a pool's flattened keys to decide whether a wait-for-recovery is
 * worth it. A key is "recoverable" when it sits in a time-based state
 * (PENALIZED/COOLDOWN) that the health engine flips back to ACTIVE once its
 * penaltyExpiresAt passes. Terminal states (SUSPENDED/DISABLED) are NOT.
 */
export function getPoolRecoveryInfo(keys: PoolRecoveryKey[]): PoolRecoveryInfo {
  const now = Date.now();
  let hasActive = false;
  let recoverable = false;
  let earliestRecoveryAt: number | null = null;

  for (const k of keys) {
    if (k.status === "ACTIVE") {
      hasActive = true;
      continue;
    }
    if (k.status !== "PENALIZED" && k.status !== "COOLDOWN") continue;
    if (k.penaltyExpiresAt == null) continue;

    const exp = k.penaltyExpiresAt.getTime();
    const effective = exp <= now ? now : exp;
    recoverable = true;
    if (earliestRecoveryAt == null || effective < earliestRecoveryAt) {
      earliestRecoveryAt = effective;
    }
  }

  return { hasActive, recoverable, earliestRecoveryAt };
}

/**
 * Re-read the current status of every key attached to a pool. Used after a
 * successful `waitForPoolRecovery` to refresh the in-memory candidate list so
 * the orchestrator can route to a key that just became ACTIVE again.
 */
export async function readPoolKeyStatuses(
  poolId: string
): Promise<Map<string, string>> {
  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    select: {
      poolApiKeys: { select: { apiKey: { select: { id: true, status: true } } } },
    },
  });
  const statuses = new Map<string, string>();
  for (const j of pool?.poolApiKeys ?? []) {
    statuses.set(j.apiKey.id, j.apiKey.status);
  }
  return statuses;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait (bounded) until any key in the pool becomes ACTIVE again. Runs the
 * expiry-recovery checks on each poll so a just-expired penalty is restored in
 * place. Returns true when a healthy key is available, false on timeout or
 * when the wait is disabled.
 *
 * @param deadline Optional absolute epoch-ms cap. When provided it overrides
 *   the configured max wait — used to keep a single recovery budget across
 *   retries so a repeatedly re-penalized key can't cause an unbounded wait.
 */
export async function waitForPoolRecovery(
  poolId: string,
  deadline?: number
): Promise<boolean> {
  const configuredMax = recoveryWaitMaxMs();
  if (configuredMax <= 0) return false;

  const end = deadline ?? Date.now() + configuredMax;
  if (Date.now() >= end) return false;

  while (Date.now() < end) {
    await delay(RECOVERY_POLL_MS);

    // Restore any penalties/cooldowns that just expired.
    await checkAndRecoverExpiredPenalties();
    await checkAndRecoverExpiredCooldowns();

    // Re-read the pool's keys to see if any is routable now.
    const pool = await prisma.pool.findUnique({
      where: { id: poolId },
      select: {
        poolApiKeys: {
          select: { apiKey: { select: { status: true } } },
        },
      },
    });
    const anyActive = pool?.poolApiKeys.some((j) => j.apiKey.status === "ACTIVE") ?? false;
    if (anyActive) return true;
  }

  return false;
}
