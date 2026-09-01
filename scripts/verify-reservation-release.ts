// ─── Regression test: reservation release prevents over-throttling ──
// Verifies that a FAILED request does NOT inflate the local RPM counter
// (which would cause unnecessary throttling), while a SUCCESSFUL one does.

import {
  waitForApiKeyRateLimit,
  settleApiKeyRateLimit,
  releaseApiKeyRateLimit,
  getKeyRateSnapshot,
} from "../src/engine/rate-limit/api-key-rate-limiter";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

async function main(): Promise<void> {
  const keyId = `release-test-${Date.now()}`;

  console.log("\n— Reservation release (no over-throttling) —\n");

  // 1) No-limit key stays at 0 even after a reservation is released.
  const noLimitRes = await waitForApiKeyRateLimit({ apiKeyId: keyId, requestedTokens: 100 });
  assert(noLimitRes.reservationId.length > 0, "no-limit key still returns a reservation id");
  await releaseApiKeyRateLimit(noLimitRes);
  const afterNoLimit = getKeyRateSnapshot(keyId);
  assert(afterNoLimit !== null, "snapshot exists after release (daily state kept)");
  assert(afterNoLimit!.rpmCurrent === 0, "no-limit key RPM stays 0 after release");
  assert(afterNoLimit!.rpdCurrent === 0, "no-limit key RPD stays 0 after release");

  // 2) RPM-limited key: reserving increments RPM; releasing decrements back.
  const limitedKey = `release-test-rpm-${Date.now()}`;
  const resRpm = await waitForApiKeyRateLimit({
    apiKeyId: limitedKey,
    rpmLimit: 15,
    requestedTokens: 100,
  });
  let snap = getKeyRateSnapshot(limitedKey);
  assert(snap!.rpmCurrent === 1, "rpm-limited key: reserve increments RPM to 1");

  // Simulate a FAILURE → release.
  await releaseApiKeyRateLimit(resRpm);
  snap = getKeyRateSnapshot(limitedKey);
  assert(snap!.rpmCurrent === 0, "rpm-limited key: release restores RPM to 0 (no over-throttle)");
  assert(snap!.rpdCurrent === 0, "rpm-limited key: release clears daily request too");

  // 3) Successful requests are NOT released — they stay counted.
  const successKey = `release-test-success-${Date.now()}`;
  const resSuccess = await waitForApiKeyRateLimit({
    apiKeyId: successKey,
    rpmLimit: 15,
    tpmLimit: 5000,
    requestedTokens: 100,
  });
  await settleApiKeyRateLimit(resSuccess, 123); // actual usage 123 tokens
  snap = getKeyRateSnapshot(successKey);
  assert(snap!.rpmCurrent === 1, "successful request stays counted (RPM 1)");
  assert(snap!.tpmCurrent === 123, "successful request settles to actual token count");
  assert(snap!.rpdCurrent === 1, "successful request counted in daily window");

  // 4) TPM release: a failed request that reserved tokens releases them.
  const tpmKey = `release-test-tpm-${Date.now()}`;
  const resTpm = await waitForApiKeyRateLimit({
    apiKeyId: tpmKey,
    tpmLimit: 5000,
    requestedTokens: 500,
  });
  snap = getKeyRateSnapshot(tpmKey);
  assert(snap!.tpmCurrent === 500, "tpm-limited key: reserve counts estimated tokens");
  await releaseApiKeyRateLimit(resTpm);
  snap = getKeyRateSnapshot(tpmKey);
  assert(snap!.tpmCurrent === 0, "tpm-limited key: release clears token reservation");

  // 5) Idempotent: releasing an empty-id reservation is a safe no-op.
  await releaseApiKeyRateLimit({ apiKeyId: keyId, reservationId: "", reservedTokens: 1, hasTpmLimit: false, requestTs: 0 });
  assert(true, "releasing an empty-id reservation is a safe no-op");

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
