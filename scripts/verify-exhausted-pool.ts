// ─── Exhausted-Pool Response Regression Test ──────────
// Verifies the gateway never hard-fails when a pool has no healthy key: it
// returns a valid assistant completion (NO tool_calls, finish_reason "stop")
// so an autonomous agent ends its turn instead of retrying forever.
//
// Run: npx tsx scripts/verify-exhausted-pool.ts

import {
  buildExhaustedPoolResponse,
  buildExhaustedPoolStream,
  EXHAUSTED_POOL_MESSAGE,
  NO_HEALTHY_KEY_CLASSIFICATION,
  isExhaustedPoolResponse,
} from "../src/engine/routing/exhausted-pool";

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
  console.log("verify-exhausted-pool\n");

  // Non-streaming response shape
  const resp = buildExhaustedPoolResponse("pool/model");
  assert(resp.model === "pool/model", "non-stream sets model");
  assert(resp.choices.length === 1, "non-stream has one choice");
  assert(resp.choices[0].message.role === "assistant", "role is assistant");
  assert(resp.choices[0].message.content === EXHAUSTED_POOL_MESSAGE, "content is the pre-defined message");
  assert(resp.choices[0].finish_reason === "stop", "finish_reason is stop (ends the turn)");
  assert(!("tool_calls" in resp.choices[0].message), "no tool_calls → agent loop ends");
  assert(resp.usage?.total_tokens === 0, "zero usage reported");
  assert(isExhaustedPoolResponse(resp), "isExhaustedPoolResponse detects the synthetic response");

  // A normal response is NOT detected as exhausted
  const normal = { id: "x", model: "m", created: 0, choices: [{ index: 0, message: { role: "assistant" as const, content: "hello" }, finish_reason: "stop" as const }] };
  assert(!isExhaustedPoolResponse(normal), "normal response is not flagged exhausted");

  // Streaming shape: message delta then terminal stop delta
  const chunks: unknown[] = [];
  for await (const delta of buildExhaustedPoolStream("pool/model")) {
    chunks.push(delta);
  }
  assert(chunks.length === 2, "stream emits message + terminal chunk");
  const first = chunks[0] as { choices: Array<{ delta: { content?: string } }> };
  const second = chunks[1] as { choices: Array<{ delta: object; finish_reason?: string }> };
  assert(first.choices[0].delta.content === EXHAUSTED_POOL_MESSAGE, "stream first delta carries the message");
  assert(second.choices[0].finish_reason === "stop", "stream terminal chunk is stop");
  assert(second.choices[0].delta && Object.keys(second.choices[0].delta).length === 0, "stream terminal delta is empty (no content/tools)");

  // Classification label
  assert(NO_HEALTHY_KEY_CLASSIFICATION === "NO_HEALTHY_KEY", "classification constant is NO_HEALTHY_KEY");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
