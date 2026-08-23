// ─── Penalty Recovery Loop ─────────────────────────────
// Background interval that re-checks for expired penalties and cooldowns
// every 30 seconds, independent of inbound requests. This closes the race
// where a key's countdown finishes while the admin UI is idle and the key
// remains stuck in PENALIZED/COOLDOWN.

import {
  checkAndRecoverExpiredPenalties,
  checkAndRecoverExpiredCooldowns,
} from "@/engine/health-engine";

const RECOVERY_INTERVAL_MS = 30_000;

let started = false;

/**
 * Idempotent — safe to call from instrumentation.register() exactly once per
 * server process. Guards against hot-reload double-starting the interval in dev.
 */
export function startPenaltyRecoveryLoop(): void {
  if (started) return;
  started = true;

  // Run once on boot so an already-expired penalty recovers immediately.
  runRecovery().catch((err) =>
    console.error("[penalty-recovery] initial sweep failed:", err)
  );

  const timer = setInterval(() => {
    runRecovery().catch((err) =>
      console.error("[penalty-recovery] sweep failed:", err)
    );
  }, RECOVERY_INTERVAL_MS);

  // Do not keep the process alive just for the interval when it would exit.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  console.log(`[penalty-recovery] loop started (every ${RECOVERY_INTERVAL_MS / 1000}s)`);
}

async function runRecovery(): Promise<void> {
  try {
    const recoveredPenalties = await checkAndRecoverExpiredPenalties();
    const recoveredCooldowns = await checkAndRecoverExpiredCooldowns();
    const total = recoveredPenalties + recoveredCooldowns;
    if (total > 0) {
      console.log(
        `[penalty-recovery] recovered ${recoveredPenalties} penalty(s), ` +
          `${recoveredCooldowns} cooldown(s)`
      );
    }
  } catch (err) {
    // Recovery is best-effort; never throw into the interval.
    console.error("[penalty-recovery] sweep error:", err);
  }
}
