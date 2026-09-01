// ─── Scenario: Key Exhaustion ─────────────────────────
// Verifies the gateway does NOT hard-fail when all of a pool's routable keys are
// unusable. When every key is disabled/penalized, the orchestrator returns an
// EXHAUSTED pool result and the route returns a valid 200 assistant completion
// (no tool_calls, finish_reason "stop") so an agent stops instead of retrying.
//
// Steps:
//   1. Pick a pool + confirm its keys.
//   2. DISABLE all of the pool's routable keys.
//   3. Fire a request → assert 200 + the pre-defined exhausted-pool body.
//   4. Assert a RequestLog row was written (NO_HEALTHY_KEY classification).
//   5. Re-enable every key to restore state.
//
// Run: npx tsx scripts/test-key-exhaustion.ts

import {
  listPools,
  listKeys,
  promptChoice,
  promptConfirm,
  sendGatewayRequest,
  buildRequest,
  listRecentLogs,
  GATEWAY_BASE,
  PoolInfo,
  KeyInfo,
} from "./lib/gateway-fixture";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function patchKey(keyId: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${GATEWAY_BASE}/api/admin/keys/${keyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

void (async () => {
  console.log("╭──────────────────────────────────────────────╮");
  console.log("│  Scenario: KEY EXHAUSTION                     │");
  console.log("│  Expects the gateway to return a graceful     │");
  console.log("│  exhausted-pool completion, NOT a hard error. │");
  console.log("╰──────────────────────────────────────────────╯");

  const pools = await listPools();
  const allKeys = await listKeys();
  if (pools.length === 0) {
    console.log("No pools found.");
    process.exit(1);
  }

  const pool = await promptChoice("Select a pool", pools, (p) => `${p.name} (${p.virtualModelName})`);

  // Keys attached to this pool.
  const poolKeys = allKeys
    .filter((k) => k.poolIds.includes(pool.id) && k.status === "ACTIVE")
    .map((k) => ({ ...k, poolIds: [pool.id] }));

  if (poolKeys.length === 0) {
    console.log(`Pool "${pool.name}" has no ACTIVE keys attached — nothing to exhaust.`);
    process.exit(0);
  }

  console.log(`\n  Pool keys to exhaust: ${poolKeys.map((k) => k.label).join(", ")}`);
  const go = await promptConfirm("Disable ALL these keys and test exhaustion?", true);
  if (!go) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // Snapshot of disabled keys for restoration.
  const disabledIds: string[] = [];
  try {
    console.log("\n  Disabling keys…");
    for (const k of poolKeys) {
      const r = await patchKey(k.id, { action: "disable" });
      assert(r.status === 200, `disabled ${k.label} (HTTP ${r.status})`);
      disabledIds.push(k.id);
    }

    // Fire a request — expect a 200 with the exhausted completion body.
    console.log(`  Sending request to "${pool.virtualModelName}" with all keys down…`);
    const { status, body } = await sendGatewayRequest({
      pool,
      body: buildRequest(pool.virtualModelName, "Hello", false),
      timeoutMs: 20_000,
    });

    assert(status === 200, `gateway returned HTTP 200 (got ${status}) — NOT a hard 502`);
    const b = body as { choices?: Array<{ message?: { content?: string; tool_calls?: unknown }; finish_reason?: string }> };
    assert(Array.isArray(b.choices) && b.choices.length > 0, "response contains a choices array");
    const choice = b.choices?.[0];
    assert(choice?.message?.content?.length ? choice.message.content.length > 0 : true, "completion carries a final assistant message");
    assert(!(choice?.message?.tool_calls), "NO tool_calls → agent loop ends");
    assert(choice?.finish_reason === "stop", "finish_reason is 'stop'");

    // Verify a RequestLog row was written for the exhausted outcome.
    const logs = await listRecentLogs(20);
    const exhausted = logs.find(
      (l) => l.requestedVirtualModel === pool.virtualModelName && l.poolId === pool.id
    );
    assert(Boolean(exhausted), "a RequestLog row was written for this pool");
    if (exhausted) {
      assert(exhausted.outcome === "FAILURE", `log outcome is FAILURE (got ${exhausted.outcome})`);
      assert(exhausted.errorClassification === "NO_HEALTHY_KEY", `log classification is NO_HEALTHY_KEY (got ${exhausted.errorClassification})`);
    }
  } finally {
    // Restore everything regardless of outcome.
    console.log("\n  Re-enabling keys to restore state…");
    for (const id of disabledIds) {
      const r = await patchKey(id, { action: "enable" });
      assert(r.status === 200, `re-enabled ${id.slice(0, 10)} (HTTP ${r.status})`);
    }
    console.log("  Restored.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
