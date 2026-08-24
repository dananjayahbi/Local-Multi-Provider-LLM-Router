// ─── Flow-Map Layout Verification ─────────────────────
// Confirms the 3-container geometry: client → gateway → providers, with keys
// grouped by provider, one edge per key, and a queue box inside the gateway.

import { computeFlowMapLayout, providerColor } from "../src/components/usage/flow-map-layout";

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

console.log("Flow-map layout verification");

const layout = computeFlowMapLayout([
  { id: "k1", label: "copilot", providerName: "Openrouter-OX-Alpha", rpm: 4, rpmLimit: 12, queued: 1, inFlight: 2 },
  { id: "k2", label: "copilot_3366", providerName: "Openrouter-OX-Alpha", rpm: 8, rpmLimit: 12, queued: 0, inFlight: 1 },
  { id: "k3", label: "nscale", providerName: "Nscale", rpm: 2, rpmLimit: 10, queued: 0, inFlight: 0 },
]);

assert(layout.client.label.includes("Copilot"), "client is Copilot / Client");
assert(layout.client.outX > layout.client.x, "client has a right-edge output anchor");
assert(layout.gateway.label === "Gateway", "gateway block exists");
assert(layout.gateway.inX < layout.gateway.outX, "gateway left edge < right edge");
assert(layout.queue.label === "Queue" && layout.queue.w > 0, "gateway contains a queue box");

// 2 providers → 2 provider boxes.
assert(layout.providers.length === 2, "two providers → two provider boxes");
assert(layout.providers.map((p) => p.name).sort().join(",") === "Nscale,Openrouter-OX-Alpha", "provider names match");

// 3 keys total, all attached to a provider box.
const allKeys = layout.providers.flatMap((p) => p.keys);
assert(allKeys.length === 3, "three key chips total");
assert(allKeys.every((k) => k.w > 0 && k.h > 0), "every key chip has non-zero size");

// One edge per key.
assert(layout.edges.length === 3, "one edge per key");

// Edges connect gateway right edge to the key's left anchor.
assert(layout.edges.every((e) => e.x1 === layout.gateway.outX), "edge starts at gateway right edge");
assert(layout.edges.every((e) => e.x2 > e.x1), "edge ends to the right of the gateway");

// Active edges reflect key traffic.
assert(layout.edges.find((e) => e.keyId === "k1")!.active === true, "edge for busy key is active");
assert(layout.edges.find((e) => e.keyId === "k3")!.active === false, "edge for idle key is inactive");

// Key chips are inside their provider box horizontally.
for (const p of layout.providers) {
  for (const k of p.keys) {
    assert(k.x >= p.x && k.x + k.w <= p.x + p.w, `key ${k.id} fits within provider ${p.name}`);
  }
}

// Provider boxes within the canvas and stacked vertically (no overlap).
const sortedY = [...layout.providers].sort((a, b) => a.y - b.y);
for (let i = 1; i < sortedY.length; i++) {
  assert(sortedY[i].y >= sortedY[i - 1].y + sortedY[i - 1].h, `provider boxes do not overlap (#${i})`);
}

// Provider color deterministic.
assert(providerColor("Openrouter-OX-Alpha") === providerColor("Openrouter-OX-Alpha"), "provider color deterministic");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
