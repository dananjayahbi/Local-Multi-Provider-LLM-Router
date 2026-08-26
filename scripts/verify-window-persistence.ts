// ─── Rate-Limit Window Persistence Regression Test ────
// Verifies the post-restart hydration core: reconstructed durable usage can be
// seeded into the in-memory rate-limit windows so the router remembers recent
// RPM/TPM/RPD/TPD usage (instead of forgetting it and spurious-throttling the
// provider). Tests the pure, DB-free `seedRateLimitWindows` + snapshot read.
//
// Run: npx tsx scripts/verify-window-persistence.ts

import {
  seedRateLimitWindows,
  getKeyRateSnapshot,
  getKeyUsageSnapshot,
} from "../src/engine/rate-limit/api-key-rate-limiter";
import { hydrationLookbackMs, DEFAULT_HYDRATION_LOOKBACK_MS } from "../src/engine/data-access/rate-limit-history";

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

void (async () => {
  console.log("verify-window-persistence\n");

  const keyId = `test-hydration-${Date.now()}`;
  const now = Date.now();
  const MINUTE = 60_000;

  // Two requests in the last minute, one ~2h ago (still in daily window).
  seedRateLimitWindows(keyId, [
    { timestamp: now - 10_000, tokens: 500 },
    { timestamp: now - 30_000, tokens: 700 },
    { timestamp: now - 2 * 3600_000, tokens: 1200 },
  ]);

  // RPM snapshot: 2 in the 60s window (the 2h-old one prunes out).
  const snap = getKeyRateSnapshot(keyId);
  assert(snap !== null, "snapshot exists after seeding");
  assert(snap?.rpmCurrent === 2, `rpmCurrent is 2 (got ${snap?.rpmCurrent})`);
  assert(snap?.tpmCurrent === 1200, `tpmCurrent is 500+700=1200 (got ${snap?.tpmCurrent})`);

  // Daily windows: all 3 requests count.
  assert(snap?.rpdCurrent === 3, `rpdCurrent is 3 (got ${snap?.rpdCurrent})`);
  assert(snap?.tpdCurrent === 500 + 700 + 1200, `tpdCurrent is 2400 (got ${snap?.tpdCurrent})`);

  // Usage snapshot reflects the same reconstructed history.
  const usage = getKeyUsageSnapshot(keyId);
  assert(usage !== null, "usage snapshot exists after seeding");
  assert(usage?.rpm.length === 2, `usage.rpm has 2 entries (got ${usage?.rpm.length})`);
  assert(usage?.rpd.length === 3, `usage.rpd has 3 entries (got ${usage?.rpd.length})`);
  // totalTokensServed is the 60s TPM window sum (2h-old request is out of it).
  assert(usage?.totalTokensServed === 1200, `totalTokensServed is 1200 (got ${usage?.totalTokensServed})`);

  // Seeding empty / malformed entries is a safe no-op.
  seedRateLimitWindows(keyId, []);
  seedRateLimitWindows(keyId, [{ timestamp: 0, tokens: 99 }, { timestamp: now - 999 * 24 * 3600_000, tokens: 99 }]);
  const snapAfter = getKeyRateSnapshot(keyId);
  assert(snapAfter?.rpmCurrent === 2, `no-op seeding keeps rpmCurrent at 2 (got ${snapAfter?.rpmCurrent})`);

  // Hydration lookback default = 24h.
  assert(hydrationLookbackMs() === DEFAULT_HYDRATION_LOOKBACK_MS, "default lookback is 24h");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
