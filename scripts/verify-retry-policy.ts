// ─── Verify: Retry Backoff + Exhausted-Pool Policy ──────
// Pure-logic regression test for the task 02/04 helpers. No DB / network needed.
//
// Run: npx tsx scripts/verify-retry-policy.ts

import {
  RETRY_BACKOFF_MS,
  backoffAfterFailure,
  isRetriable,
  MAX_RETRIES,
  MAX_ATTEMPTS,
} from "../src/engine/routing/retry-backoff";
import {
  shouldEmitExhaustedCompletion,
  lowestRemainingPenaltyMs,
  DEFAULT_EXHAUSTED_MIN_PENALTY_MS,
} from "../src/engine/routing/exhausted-pool-policy";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

void (async () => {
  console.log("verify-retry-policy\n");

  // ── Retry backoff schedule ──────────────────────────
  console.log("Retry backoff:");
  assert(JSON.stringify(RETRY_BACKOFF_MS) === JSON.stringify([3000, 6000, 10000, 15000, 30000]), "backoff schedule is 3/6/10/15/30s");
  assert(MAX_RETRIES === 5, "5 silent retries");
  assert(MAX_ATTEMPTS === 6, "6 total attempts (initial + 5 retries)");

  assert(backoffAfterFailure(1) === 3000, "after 1st fail waits 3s");
  assert(backoffAfterFailure(2) === 6000, "after 2nd fail waits 6s");
  assert(backoffAfterFailure(3) === 10000, "after 3rd fail waits 10s");
  assert(backoffAfterFailure(4) === 15000, "after 4th fail waits 15s");
  assert(backoffAfterFailure(5) === 30000, "after 5th fail waits 30s");
  assert(backoffAfterFailure(6) === 0, "after 6th fail (budget out) returns 0");

  // ── Retriability ─────────────────────────────────────
  console.log("\nRetriability:");
  assert(isRetriable("SERVER_ERROR"), "SERVER_ERROR is retriable");
  assert(isRetriable("NETWORK_ERROR"), "NETWORK_ERROR is retriable");
  assert(isRetriable("UNKNOWN"), "UNKNOWN is retriable");
  assert(!isRetriable("RATE_LIMITED"), "RATE_LIMITED is NOT retriable here");
  assert(!isRetriable("QUOTA_EXCEEDED"), "QUOTA_EXCEEDED is NOT retriable here");
  assert(!isRetriable("AUTH_ERROR"), "AUTH_ERROR is NOT retriable here");
  assert(!isRetriable("INVALID_REQUEST"), "INVALID_REQUEST is NOT retriable here");

  // ── Exhausted-pool policy ───────────────────────────
  console.log("\nExhausted-pool policy:");
  const now = Date.now();

  // Short penalty (< 30 min) → wait (don't emit)
  assert(
    shouldEmitExhaustedCompletion([
      { status: "PENALIZED", penaltyExpiresAt: new Date(now + 5 * 60_000) },
    ]) === false,
    "5-min penalty → keep waiting (no exhausted completion)"
  );

  // Long penalty (> 30 min) → emit
  assert(
    shouldEmitExhaustedCompletion([
      { status: "PENALIZED", penaltyExpiresAt: new Date(now + 2 * 3600_000) },
    ]) === true,
    "2-hour penalty → emit exhausted completion"
  );

  // Mixed: one short, one long → shortest wins → wait
  assert(
    shouldEmitExhaustedCompletion([
      { status: "PENALIZED", penaltyExpiresAt: new Date(now + 2 * 3600_000) },
      { status: "PENALIZED", penaltyExpiresAt: new Date(now + 3 * 60_000) },
    ]) === false,
    "mixed short+long penalty → wait (shortest governs)"
  );

  // No future penalty (terminal) → emit
  assert(
    shouldEmitExhaustedCompletion([
      { status: "SUSPENDED", penaltyExpiresAt: null },
      { status: "DISABLED", penaltyExpiresAt: null },
    ]) === true,
    "terminal state (no recoverable key) → emit"
  );

  // lowestRemainingPenaltyMs
  const short = lowestRemainingPenaltyMs([
    { status: "PENALIZED", penaltyExpiresAt: new Date(now + 10 * 60_000) },
    { status: "COOLDOWN", penaltyExpiresAt: new Date(now + 20 * 60_000) },
  ]);
  assert(
    short !== null && short > 9 * 60_000 && short <= 10 * 60_000,
    "lowestRemainingPenaltyMs returns shortest (~10min)"
  );
  assert(
    lowestRemainingPenaltyMs([
      { status: "PENALIZED", penaltyExpiresAt: new Date(now - 1000) },
    ]) === null,
    "already-expired penalty returns null (now recoverable)"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
