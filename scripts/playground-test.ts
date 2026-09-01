// ─── Playground algorithm test harness ─────────────────
// Validates the caching-aware selector + penalty + injection
// logic against edge-case scenarios. This is MY (the agent's)
// sandbox — used to finetune the algorithm before production.
// Run with: npx tsx scripts/playground-test.ts

import {
  SimKey,
  ScenarioStep,
  runScenario,
  makeKey,
  selectKey,
  emptyUsage,
  buildInjection,
  KeyUsage,
} from "../src/engine/playground";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function keyUsages(keys: SimKey[]): Array<{ key: SimKey; usage: KeyUsage }> {
  return keys.map((key) => ({ key, usage: emptyUsage() }));
}

// ── Edge 1: small prompt should prefer the SMALLEST fitting context ──
function edgeSmallPromptPrefersSmallContext() {
  const keys = [
    makeKey({ id: "Big", label: "Big", provider: "p", contextWindow: 128000, cacheCapable: false }),
    makeKey({ id: "Small", label: "Small", provider: "p", contextWindow: 16000, cacheCapable: false }),
    makeKey({ id: "Tiny", label: "Tiny", provider: "p", contextWindow: 8000, cacheCapable: false }),
  ];
  const sel = selectKey(keyUsages(keys), { promptTokens: 2000, completionBudget: 500 }, { currentKeyId: null, lastPromptTokens: 0 });
  // Tiny (8000) fits 2500 and is the smallest → should win on context-fit.
  check("Edge1: small prompt → smallest fitting context", sel.chosenKeyId === "Tiny", `chose=${sel.chosenKeyId}`);
}

// ── Edge 2: current key context overflow → MUST switch ──
function edgeContextOverflowForcesSwitch() {
  const keys = [
    makeKey({ id: "A", label: "A", provider: "p", contextWindow: 10000 }),
    makeKey({ id: "B", label: "B", provider: "p", contextWindow: 128000 }),
  ];
  const sel = selectKey(keyUsages(keys), { promptTokens: 20000, completionBudget: 1024 }, { currentKeyId: "A", lastPromptTokens: 5000 });
  check("Edge2: current key context overflow → switch to fitting key", sel.chosenKeyId === "B", `chose=${sel.chosenKeyId}`);
  check("Edge2: sticky NOT used on overflow", sel.stickyUsed === false);
}

// ── Edge 3: all keys penalized → allowPenalized fallback picks earliest expiry ──
function edgeAllPenalizedFallback() {
  const now = Date.now();
  const keys = [
    makeKey({ id: "A", label: "A", provider: "p", contextWindow: 32000 }),
    makeKey({ id: "B", label: "B", provider: "p", contextWindow: 32000 }),
  ];
  keys[0].status = "PENALIZED";
  keys[0].penaltyExpiresAt = now + 60000;
  keys[1].status = "PENALIZED";
  keys[1].penaltyExpiresAt = now + 600000;

  const sel = selectKey(keyUsages(keys), { promptTokens: 1000, completionBudget: 500 }, { currentKeyId: null, lastPromptTokens: 0 }, { allowPenalized: true, now });
  check("Edge3: allowPenalized picks a key", sel.chosenKeyId != null);
}

// ── Edge 4: sticky preserved even when another key is faster (cache wins) ──
function edgeStickyBeatsSpeed() {
  const keys = [
    makeKey({ id: "Slow", label: "Slow", provider: "p", contextWindow: 64000, tps: 30 }),
    makeKey({ id: "Fast", label: "Fast", provider: "p", contextWindow: 64000, tps: 500 }),
  ];
  const sel = selectKey(keyUsages(keys), { promptTokens: 10000, completionBudget: 1024 }, { currentKeyId: "Slow", lastPromptTokens: 9000 });
  check("Edge4: sticky (cache) beats faster key", sel.chosenKeyId === "Slow", `chose=${sel.chosenKeyId}`);
}

// ── Edge 5: no cache capability on current key → sticky disabled ──
function edgeNoCacheStickyOff() {
  const keys = [
    makeKey({ id: "A", label: "A", provider: "p", contextWindow: 64000, cacheCapable: false }),
    makeKey({ id: "B", label: "B", provider: "p", contextWindow: 64000, tps: 500 }),
  ];
  const sel = selectKey(keyUsages(keys), { promptTokens: 10000, completionBudget: 1024 }, { currentKeyId: "A", lastPromptTokens: 9000 });
  check("Edge5: current key not cache-capable → sticky off, fastest wins", sel.chosenKeyId === "B", `chose=${sel.chosenKeyId}`);
}

// ── Edge 6: TPD limit check trips (daily window) ──
function edgeTpdTrip() {
  const now = Date.now();
  const key = makeKey({ id: "K", label: "K", provider: "p", contextWindow: 128000, tpdLimit: 10000, rpmLimit: 100 });
  const usage: KeyUsage = emptyUsage();
  // Simulate 8000 tokens already used today.
  usage.tpd.push({ ts: now - 1000, tokens: 8000 });
  // Pass the SAME usage object that carries the daily usage.
  const sel = selectKey([{ key, usage }], { promptTokens: 3000, completionBudget: 500 }, { currentKeyId: null, lastPromptTokens: 0 }, { now });
  // 8000+3000=11000 > 10000 → key must NOT be chosen for this request (no fit candidate).
  check("Edge6: TPD would trip → key excluded", sel.chosenKeyId === null, `chose=${sel.chosenKeyId}`);
}

// ── Edge 7: cache discount accrues correctly on sticky key ──
function edgeCacheAccrual() {
  const keys = [makeKey({ id: "A", label: "A", provider: "p", contextWindow: 64000 })];
  const res = runScenario(
    keys,
    [
      { id: 1, request: { promptTokens: 10000, completionBudget: 1024 }, injectError: null },
      { id: 2, request: { promptTokens: 15000, completionBudget: 1024 }, injectError: null },
    ],
    {},
    "A"
  );
  // Second request caches min(10000,15000)=10000.
  check("Edge7: cache accrual on sticky", res.cachedTokensSaved === 10000, `saved=${res.cachedTokensSaved}`);
}

// ── Edge 8: rotation due to daily-limit pre-exclusion emits injection ──
function edgeRotationCost() {
  const keys = [
    makeKey({ id: "A", label: "A", provider: "p", contextWindow: 64000, tpdLimit: 30000 }),
    makeKey({ id: "B", label: "B", provider: "p", contextWindow: 64000, tpdLimit: 500000 }),
  ];
  // Step 1: A serves 20k (sticky). Step 2: 20k+15k > A's 30k TPD → selector
  // pre-excludes A and routes to B (a rotation). No forced injectError needed.
  const res = runScenario(
    keys,
    [
      { id: 1, request: { promptTokens: 20000, completionBudget: 1024 }, injectError: null },
      { id: 2, request: { promptTokens: 15000, completionBudget: 1024 }, injectError: null },
    ],
    { emitInjection: true },
    "A"
  );
  check("Edge8: rotation happened (pre-exclusion)", res.rotationCount === 1, `rotations=${res.rotationCount}`);
  const inj = res.trace.find((t) => t.kind === "injection");
  check("Edge8: injection emitted on rotation", !!inj);
  check("Edge8: rotation mentions cached-token loss", res.trace.some((t) => t.message.includes("cached tokens")));
}

// ── Edge 9: penalty scaling by limit type ──
function edgePenaltyScaling() {
  const rpm = makeKey({ id: "R", label: "R", provider: "p", contextWindow: 32000, rpmLimit: 1 });
  const res1 = runScenario([rpm], [{ id: 1, request: { promptTokens: 100, completionBudget: 100 }, injectError: "RPM" }]);
  const rpmKey = res1.keys[0];
  const rpmPenalty = rpmKey.penaltyExpiresAt! - Date.now();

  // Generous TPD limit (won't pre-exclude); injectError forces the TPD penalty.
  const tpd = makeKey({ id: "T", label: "T", provider: "p", contextWindow: 32000, tpdLimit: 100000 });
  const res2 = runScenario([tpd], [{ id: 1, request: { promptTokens: 100, completionBudget: 100 }, injectError: "TPD" }]);
  const tpdKey = res2.keys[0];
  const tpdPenalty = tpdKey.penaltyExpiresAt! - Date.now();

  check("Edge9: RPM penalty ≈ 60s", Math.abs(rpmPenalty - 60000) < 5000, `${rpmPenalty}ms`);
  check("Edge9: TPD penalty ≈ 24h", Math.abs(tpdPenalty - 86400000) < 5000, `${tpdPenalty}ms`);
}

// ── Edge 10: sticky budget prevents staying when too close to window edge ──
function edgeStickyBudget() {
  const keys = [
    makeKey({ id: "A", label: "A", provider: "p", contextWindow: 12000 }),
    makeKey({ id: "B", label: "B", provider: "p", contextWindow: 64000 }),
  ];
  // Prompt 11000+1024=12024 > window 12000 → A can't fit anyway.
  const sel = selectKey(keyUsages(keys), { promptTokens: 11000, completionBudget: 1024 }, { currentKeyId: "A", lastPromptTokens: 5000 }, { stickyBudgetTokens: 2000 });
  check("Edge10: sticky budget / overflow → switch to fitting key", sel.chosenKeyId === "B", `chose=${sel.chosenKeyId} sticky=${sel.stickyUsed}`);
}

edgeSmallPromptPrefersSmallContext();
edgeContextOverflowForcesSwitch();
edgeAllPenalizedFallback();
edgeStickyBeatsSpeed();
edgeNoCacheStickyOff();
edgeTpdTrip();
edgeCacheAccrual();
edgeRotationCost();
edgePenaltyScaling();
edgeStickyBudget();

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
