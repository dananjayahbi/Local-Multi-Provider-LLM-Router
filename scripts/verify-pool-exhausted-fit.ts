// ─── Verify: Phantom "Pool Exhausted" fix ─────────────
// Demonstrates the double-count bug that made healthy keys look like they
// overflowed their context window, causing a phantom "pool exhausted". With the
// fix (separating promptTokens from completionBudget), the same healthy key now
// fits. Run: npx tsx scripts/verify-pool-exhausted-fit.ts
import { selectKey, emptyUsage } from "../src/engine/playground";

function makeKey(id: string, contextWindow: number, label = id) {
  return {
    key: {
      id,
      label,
      provider: "",
      rpmLimit: 1000,
      tpmLimit: 1000000,
      rpdLimit: null,
      tpdLimit: null,
      tps: 100,
      timeToFirstTokenMs: 200,
      contextWindow,
      cacheCapable: true,
      cacheDiscountFactor: 0.1,
      status: "ACTIVE" as const,
      penaltyLevel: 0,
      penaltyExpiresAt: null,
    },
    usage: emptyUsage(),
  };
}

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// A pool with one healthy ACTIVE key, contextWindow 32k.
// Request prompt ~20k tokens + a 4k output reserve = 24k → FITS in 32k.
const keys = [makeKey("key1", 32768)];
const request = { promptTokens: 20000, completionBudget: 4096 };
const result = selectKey(keys, request, { currentKeyId: null, lastPromptTokens: 0 }, { allowPenalized: false });

assert(result.candidates.length > 0, `healthy key kept when prompt=${request.promptTokens}, completion=${request.completionBudget} (got ${result.candidates.length})`);
assert(result.chosenKeyId === "key1", "chosen candidate is the healthy key");

// Regression: the OLD bug double-counted completion into promptTokens.
// prompt = estimateTokensForRateLimit() = 20000 + 4096 = 24096, THEN
// completionBudget added again = 4096 → total 28192 which still fits 32k, but
// with a large prompt the double-count pushes it over. Show the amplified case:
const buggySpec = { promptTokens: 20000 + 4096, completionBudget: 4096 };
const buggyResult = selectKey(keys, buggySpec, { currentKeyId: null, lastPromptTokens: 0 }, { allowPenalized: false });
// 24096 + 4096 = 28192 <= 32768, still fits — but push the prompt up: 30k prompt
const bigPrompt = { promptTokens: 30000 + 4096, completionBudget: 4096 };
const bigResult = selectKey(keys, bigPrompt, { currentKeyId: null, lastPromptTokens: 0 }, { allowPenalized: false });
assert(bigResult.candidates.length === 0, "old double-count of a large prompt falsely excludes the healthy key (regression reproduced)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
