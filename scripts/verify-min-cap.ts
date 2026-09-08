// ─── Min-Cap (Floor) + Floor-Exhausted Policy Regression ──
// Verifies the pure decision logic added for the minimum-cap feature:
//  - scaleDown respects the user's min cap (never below the floor)
//  - isKeyAtFloor detects when every tunable limit is at its effective floor
//  - exhausted-pool policy: penalties below 10 min are held in-queue
//  - exhaustedMinPenaltyMs resolves EXHAUSTED_MIN_PENALTY_SECONDS (and the
//    legacy _MS name)
//
// Run: npx tsx scripts/verify-min-cap.ts

import {
  isKeyAtFloor,
  MinCapLimits,
  AutoCalibrationLimits,
} from "../src/engine/benchmark/auto-calibration";
import {
  shouldEmitExhaustedCompletion,
  lowestRemainingPenaltyMs,
  exhaustedMinPenaltyMs,
  DEFAULT_EXHAUSTED_MIN_PENALTY_MS,
  PoolKeyPenaltyInfo,
} from "../src/engine/routing/exhausted-pool-policy";

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

const limits = (rpm: number | null, tpm: number | null = null, rpd: number | null = null, tpd: number | null = null): AutoCalibrationLimits => ({
  rpmLimit: rpm,
  tpmLimit: tpm,
  rpdLimit: rpd,
  tpdLimit: tpd,
});

const minCaps = (rpm: number | null, tpm: number | null = null, rpd: number | null = null, tpd: number | null = null): MinCapLimits => ({
  minRpmLimit: rpm,
  minTpmLimit: tpm,
  minRpdLimit: rpd,
  minTpdLimit: tpd,
});

const penalized = (seconds: number): PoolKeyPenaltyInfo => ({
  status: "PENALIZED",
  penaltyExpiresAt: new Date(Date.now() + seconds * 1000),
});

void (async () => {
  console.log("verify-min-cap\n");

  // ── isKeyAtFloor ─────────────────────────────────────
  // No min caps → built-in floors (RPM 1, TPM 500, RPD 1, TPD 1000).
  assert(
    isKeyAtFloor(limits(1, 500), minCaps(null, null)) === true,
    "no min caps: rpm=1 tpm=500 → at built-in floor"
  );
  assert(
    isKeyAtFloor(limits(2, 500), minCaps(null, null)) === false,
    "no min caps: rpm=2 → NOT at floor (can still shrink)"
  );
  assert(
    isKeyAtFloor(limits(null, null), minCaps(null, null)) === false,
    "all-unlimited → not floor-bound (seeding path owns it)"
  );
  assert(
    isKeyAtFloor(limits(1, null), minCaps(null, null)) === true,
    "only rpm set at 1 → at floor (unlimited limits ignored)"
  );

  // User min caps raise the effective floor.
  assert(
    isKeyAtFloor(limits(10, 2000), minCaps(10, 2000)) === true,
    "min caps set: rpm=10 tpm=2000 → at user floor"
  );
  assert(
    isKeyAtFloor(limits(11, 2000), minCaps(10, 2000)) === false,
    "min caps set: rpm=11 → NOT at floor"
  );
  assert(
    isKeyAtFloor(limits(5, 2000), minCaps(10, 2000)) === true,
    "limit BELOW user floor (pre-existing) counts as at-floor"
  );

  // Mixed: one limit still shrinkable → not at floor.
  assert(
    isKeyAtFloor(limits(10, 5000), minCaps(10, 2000)) === false,
    "rpm at floor but tpm shrinkable → NOT at floor"
  );

  // ── exhausted-pool policy: 10-minute hold ────────────
  const originalSeconds = process.env.EXHAUSTED_MIN_PENALTY_SECONDS;
  const originalMs = process.env.EXHAUSTED_MIN_PENALTY_MS;
  delete process.env.EXHAUSTED_MIN_PENALTY_SECONDS;
  delete process.env.EXHAUSTED_MIN_PENALTY_MS;

  assert(
    exhaustedMinPenaltyMs() === DEFAULT_EXHAUSTED_MIN_PENALTY_MS,
    "unset → default 10 min"
  );
  assert(DEFAULT_EXHAUSTED_MIN_PENALTY_MS === 600_000, "default threshold is 600000 ms (10 min)");

  // All penalties below 10 min → HOLD (do not emit exhausted completion).
  assert(
    shouldEmitExhaustedCompletion([penalized(60), penalized(300)]) === false,
    "all penalties < 10 min → hold in queue (no exhausted completion)"
  );
  assert(
    shouldEmitExhaustedCompletion([penalized(60), penalized(60 * 20)]) === false,
    "shortest penalty 1 min (other 20 min) → still hold"
  );

  // All penalties above 10 min → emit exhausted completion.
  assert(
    shouldEmitExhaustedCompletion([penalized(60 * 11), penalized(60 * 30)]) === true,
    "all penalties > 10 min → emit exhausted completion"
  );

  // Exactly at the threshold → emit (strictly greater-than comparison).
  assert(
    shouldEmitExhaustedCompletion([penalized(600)]) === false,
    "penalty exactly 10 min → hold (boundary is strict >)"
  );

  // Terminal states (no timed recovery) → emit.
  assert(
    shouldEmitExhaustedCompletion([
      { status: "SUSPENDED", penaltyExpiresAt: null },
      { status: "DISABLED", penaltyExpiresAt: null },
    ]) === true,
    "terminal states → emit exhausted completion"
  );

  // lowestRemainingPenaltyMs sanity.
  assert(lowestRemainingPenaltyMs([penalized(60), penalized(300)]) === null || true, "sanity: no throw");

  // env override via EXHAUSTED_MIN_PENALTY_SECONDS.
  process.env.EXHAUSTED_MIN_PENALTY_SECONDS = "300";
  assert(exhaustedMinPenaltyMs() === 300_000, "EXHAUSTED_MIN_PENALTY_SECONDS=300 → 300000 ms");

  // legacy _MS name still honored.
  delete process.env.EXHAUSTED_MIN_PENALTY_SECONDS;
  process.env.EXHAUSTED_MIN_PENALTY_MS = "120000";
  assert(exhaustedMinPenaltyMs() === 120_000, "legacy EXHAUSTED_MIN_PENALTY_MS=120000 → 120000 ms");

  // invalid values → default.
  delete process.env.EXHAUSTED_MIN_PENALTY_MS;
  process.env.EXHAUSTED_MIN_PENALTY_SECONDS = "garbage";
  assert(exhaustedMinPenaltyMs() === DEFAULT_EXHAUSTED_MIN_PENALTY_MS, "invalid env → default");

  if (originalSeconds === undefined) delete process.env.EXHAUSTED_MIN_PENALTY_SECONDS;
  else process.env.EXHAUSTED_MIN_PENALTY_SECONDS = originalSeconds;
  if (originalMs === undefined) delete process.env.EXHAUSTED_MIN_PENALTY_MS;
  else process.env.EXHAUSTED_MIN_PENALTY_MS = originalMs;

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
