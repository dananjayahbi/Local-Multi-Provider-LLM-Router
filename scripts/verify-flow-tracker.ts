// ─── Flow-Tracker Verification ──────────────────────────
// Exercises the live data-flow event stream that powers /usage animation:
//   arrived → queued → assigned → success/failed
// and asserts the active/held/in-flight accounting is correct.

import {
  recordFlowEvent,
  getFlowSnapshot,
  resetFlowTracker,
} from "../src/engine/rate-limit/flow-tracker";

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

function reset(): void {
  resetFlowTracker();
  // Fresh request id per scenario.
  return;
}

const POOL = "pool-1";
const KEY = "key-alpha";

console.log("Flow-Tracker verification");

// Scenario 1: a full success round-trip clears the request.
reset();
const r1 = crypto.randomUUID();
recordFlowEvent({ requestId: r1, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "arrived" });
recordFlowEvent({ requestId: r1, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "queued" });
recordFlowEvent({ requestId: r1, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "assigned", tokens: 500 });
let snap = getFlowSnapshot();
assert(snap.counts.held === 0, "queued→assigned clears held");
assert(snap.counts.inFlight === 1, "assigned request is in flight");
recordFlowEvent({ requestId: r1, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "success", latencyMs: 120 });
snap = getFlowSnapshot();
assert(snap.active.length === 0, "success removes request from active");
assert(snap.counts.total === 0, "success resets total to 0");
assert(snap.events.length === 4, "four events recorded for round-trip (arrived/queued/assigned/success)");

// Scenario 2: multiple queued requests count as held, and failure clears them.
reset();
const r2a = crypto.randomUUID();
const r2b = crypto.randomUUID();
recordFlowEvent({ requestId: r2a, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "arrived" });
recordFlowEvent({ requestId: r2a, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "queued" });
recordFlowEvent({ requestId: r2b, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "arrived" });
recordFlowEvent({ requestId: r2b, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "queued" });
snap = getFlowSnapshot();
assert(snap.counts.held === 2, "two queued requests held");
assert(snap.counts.byKey.length === 1 && snap.counts.byKey[0].queued === 2, "byKey aggregates queued count");
recordFlowEvent({ requestId: r2a, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "failed", latencyMs: 30 });
recordFlowEvent({ requestId: r2b, poolId: POOL, apiKeyId: KEY, poolName: "P", apiKeyLabel: "alpha", providerName: "Prv", stage: "failed", latencyMs: 40 });
snap = getFlowSnapshot();
assert(snap.counts.held === 0, "failures clear held count");
assert(snap.active.length === 0, "failures remove all active requests");

// Scenario 3: no-op when no reservation (empty pipeline events only).
reset();
const r3 = crypto.randomUUID();
recordFlowEvent({ requestId: r3, poolId: null, apiKeyId: null, poolName: null, apiKeyLabel: null, providerName: null, stage: "arrived" });
snap = getFlowSnapshot();
assert(snap.counts.total === 0, "arrived-only request is not held/in-flight");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
