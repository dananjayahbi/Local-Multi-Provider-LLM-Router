// ─── Pool Recovery Wait Regression Test ──────────────
// Verifies the pure decision logic in src/engine/routing/pool-recovery.ts:
//  - getPoolRecoveryInfo correctly classifies ACTIVE / recoverable / terminal
//  - recoveryWaitMaxMs resolves env config with sane caps
//
// Run: npx tsx scripts/verify-pool-recovery.ts

import {
  getPoolRecoveryInfo,
  recoveryWaitMaxMs,
  DEFAULT_RECOVERY_WAIT_MS,
  PoolRecoveryKey,
} from "../src/engine/routing/pool-recovery";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

void (async () => {
  console.log("verify-pool-recovery\n");

  // ── getPoolRecoveryInfo ──────────────────────────────
  const active: PoolRecoveryKey = { status: "ACTIVE", penaltyExpiresAt: null };
  const penalizedFuture: PoolRecoveryKey = { status: "PENALIZED", penaltyExpiresAt: future() };
  const penalizedPast: PoolRecoveryKey = { status: "PENALIZED", penaltyExpiresAt: past() };
  const suspended: PoolRecoveryKey = { status: "SUSPENDED", penaltyExpiresAt: null };
  const disabled: PoolRecoveryKey = { status: "DISABLED", penaltyExpiresAt: null };
  const cooldownFuture: PoolRecoveryKey = { status: "COOLDOWN", penaltyExpiresAt: future() };
  const empty: PoolRecoveryKey[] = [];

  // All penalized, future expiry → recoverable, no active
  const r1 = getPoolRecoveryInfo([penalizedFuture, penalizedFuture]);
  assert(r1.hasActive === false, "all-penalized → no active");
  assert(r1.recoverable === true, "all-penalized → recoverable");
  assert(r1.earliestRecoveryAt !== null, "all-penalized → earliest recovery known");

  // A mixed pool with one active key → hasActive
  const r2 = getPoolRecoveryInfo([active, penalizedFuture]);
  assert(r2.hasActive === true, "mixed → has active");
  assert(r2.recoverable === true, "mixed → still recoverable (other key)");

  // All terminal (suspended/disabled) → NOT recoverable
  const r3 = getPoolRecoveryInfo([suspended, disabled]);
  assert(r3.hasActive === false, "all-suspended/disabled → no active");
  assert(r3.recoverable === false, "all-suspended/disabled → not recoverable");

  // Empty pool → no active, not recoverable
  const r4 = getPoolRecoveryInfo(empty);
  assert(r4.hasActive === false, "empty → no active");
  assert(r4.recoverable === false, "empty → not recoverable");

  // Expired-but-not-yet-recovered penalty → recoverable (health engine restores it)
  const r5 = getPoolRecoveryInfo([penalizedPast]);
  assert(r5.recoverable === true, "expired penalty → recoverable");
  assert(r5.earliestRecoveryAt !== null, "expired penalty → earliest is now");

  // Cooldown future → recoverable
  const r6 = getPoolRecoveryInfo([cooldownFuture]);
  assert(r6.recoverable === true, "cooldown → recoverable");

  // Earliest is the minimum of the recoverable keys
  const r7 = getPoolRecoveryInfo([penalizedFuture, cooldownFuture]);
  const expFuture = penalizedFuture.penaltyExpiresAt!.getTime();
  const expCooldown = cooldownFuture.penaltyExpiresAt!.getTime();
  const expected = Math.min(expFuture, expCooldown);
  assert(r7.earliestRecoveryAt === expected, "earliest recovery = min of future expiries");

  // ── recoveryWaitMaxMs ────────────────────────────────
  const originalEnv = process.env.RECOVERY_WAIT_MAX_SECONDS;

  delete process.env.RECOVERY_WAIT_MAX_SECONDS;
  assert(recoveryWaitMaxMs() === DEFAULT_RECOVERY_WAIT_MS, "unset → default wait");

  process.env.RECOVERY_WAIT_MAX_SECONDS = "120";
  assert(recoveryWaitMaxMs() === 120_000, "env '120' → 120s");

  process.env.RECOVERY_WAIT_MAX_SECONDS = "0";
  assert(recoveryWaitMaxMs() === 0, "env '0' → disabled (0)");

  process.env.RECOVERY_WAIT_MAX_SECONDS = "999999";
  assert(recoveryWaitMaxMs() === 290_000, "huge env → capped at 290s (just under 5-min maxDuration)");

  process.env.RECOVERY_WAIT_MAX_SECONDS = "not-a-number";
  assert(recoveryWaitMaxMs() === 0, "invalid env → disabled (0)");

  // restore
  if (originalEnv === undefined) delete process.env.RECOVERY_WAIT_MAX_SECONDS;
  else process.env.RECOVERY_WAIT_MAX_SECONDS = originalEnv;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
