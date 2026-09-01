// ─── Reasoning Passthrough Verification ───────────────
// Verifies that the chat-completions adapter passes reasoning through to the
// client (Copilot renders it as a collapsible Thinking UI) instead of:
//   (a) bridging it into `content` as "> thinking:" text (plain inline render), or
//   (b) stripping it entirely (reasoning-only stream = "no response returned").
//
// Run: npx tsx scripts/verify-reasoning-passthrough.ts

import { chatCompletionsAdapter } from "../src/engine/adapters/chat-completions";
import { normalizeReasoningDelta, isBareDelta } from "../src/engine/adapters/stream-helpers";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

// 1. OpenRouter reasoning_details (ARRAY) → reasoning (STRING) that Copilot reads.
console.log("1. OpenRouter reasoning_details → reasoning string");
const orChunk = `data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_details":[{"type":"text","text":"Let me "},{"type":"text","text":"think."}]}}]}`;
const orDelta = chatCompletionsAdapter.parseStreamChunk(orChunk)!;
const orChoice = orDelta.choices[0];
check("reasoning_details no longer leaks", !("reasoning_details" in (orChoice.delta as any)));
check("delta.reasoning is a joined string", typeof orChoice.delta.reasoning === "string" && orChoice.delta.reasoning === "Let me think.");
check("content stays empty (not bridged)", orChoice.delta.content === "");
check("delta NOT dropped (has reasoning)", orDelta !== null);

// 2. DeepSeek reasoning_content passes through untouched.
console.log("2. DeepSeek reasoning_content passthrough");
const dsChunk = `data: {"id":"y","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":" 9.11 vs 9.8"}}]}`;
const dsDelta = chatCompletionsAdapter.parseStreamChunk(dsChunk)!;
check("delta.reasoning_content preserved", dsDelta.choices[0].delta.reasoning_content === " 9.11 vs 9.8");
check("content stays empty (reasoning-only)", dsDelta.choices[0].delta.content === "");

// 3. Plain content passthrough (no reasoning) — must still work.
console.log("3. Plain content passthrough");
const plainChunk = `data: {"id":"z","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}`;
const plainDelta = chatCompletionsAdapter.parseStreamChunk(plainChunk)!;
check("delta.content preserved", plainDelta.choices[0].delta.content === "Hello");

// 4. Bare/empty delta (no content, no reasoning) is dropped.
console.log("4. Bare delta dropped");
const bareDelta = { choices: [{ index: 0, delta: { role: "assistant" } }] };
check("isBareDelta true for empty", isBareDelta(bareDelta as any));
const bareChunk = `data: {"id":"w","choices":[{"index":0,"delta":{"role":"assistant"}}]}`;
const bare = chatCompletionsAdapter.parseStreamChunk(bareChunk);
check("bare delta filtered to null", bare === null);

// 5. Terminal chunk with finish_reason preserved.
console.log("5. Terminal chunk preserved");
const termChunk = `data: {"id":"v","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`;
const termDelta = chatCompletionsAdapter.parseStreamChunk(termChunk);
check("terminal delta kept", termDelta !== null && termDelta!.choices[0].finish_reason === "stop");

// 6. normalizeReasoningDelta leaves a no-reasoning delta intact.
console.log("6. normalize no-op on clean delta");
const clean = normalizeReasoningDelta({ choices: [{ index: 0, delta: { content: "Hi" } }] } as any);
check("no reasoning added", clean.choices[0].delta.content === "Hi" && !("reasoning" in clean.choices[0].delta));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
