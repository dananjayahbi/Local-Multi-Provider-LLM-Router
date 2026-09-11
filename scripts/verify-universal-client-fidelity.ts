// ─── Universal Client Fidelity Verification ─────────────
// Guards the fixes in docs/10-proxy-universal-client-fidelity-and-ttft-plan.md:
//   D3  reasoning bridged into `content` for universal clients (Copilot unchanged)
//   D4  Anthropic adapter forwards assistant tool_calls as `tool_use` and maps a
//       `tool` result to a `tool_result` block inside a `user` turn
//   D6  Anthropic `thinking` / `thinking_delta` preserved as reasoning
//   D7  terminal reason becomes `tool_calls` when the turn produced tool calls
//   D8  responses adapter maps real status/incomplete reason (no stop-collapse)
//   D9  image_url parts forwarded on the chat-completions path
//   EXH exhausted-pool outage marker for universal clients only
//   CAP client-profile resolution (header > Copilot heuristic > env default)
//   KA  keepalive frame is a valid no-op
//   D12 rate-limit pre-dispatch wait cap is exposed/bounded
//
// Run: npx tsx scripts/verify-universal-client-fidelity.ts

import { chatCompletionsAdapter } from "../src/engine/adapters/chat-completions";
import { messagesAdapter } from "../src/engine/adapters/messages";
import { responsesAdapter } from "../src/engine/adapters/responses";
import {
  bridgeReasoningToContent,
  resolveFinishReason,
  deltaHasToolCalls,
} from "../src/engine/adapters/stream-helpers";
import { serializeDelta, serializeResponse } from "../src/engine/serializer";
import {
  capabilitiesFor,
  resolveClientProfile,
  CLIENT_PROFILE_HEADER,
  CLIENT_PROFILE_ENV,
} from "../src/engine/clients/client-profile";
import {
  exhaustedMessageFor,
  EXHAUSTED_POOL_MARKER,
  buildExhaustedPoolResponse,
} from "../src/engine/routing/exhausted-pool";
import { buildKeepaliveChunk } from "../src/engine/streaming/keepalive";
import { maxPreDispatchWaitMs } from "../src/engine/rate-limit/api-key-rate-limiter";
import { CanonicalRequest, CanonicalDelta } from "../src/engine/canonical";

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

// ─────────────────────────────────────────────────────────
// CAP — client profile resolution
// ─────────────────────────────────────────────────────────
console.log("CAP. client profile resolution");
{
  const hdr = new Headers();
  hdr.set(CLIENT_PROFILE_HEADER, "universal");
  check("explicit header override wins", resolveClientProfile(hdr) === "universal");

  const hdr2 = new Headers();
  hdr2.set(CLIENT_PROFILE_HEADER, "copilot");
  check("explicit copilot override", resolveClientProfile(hdr2) === "copilot");

  const copilotUa = new Headers();
  copilotUa.set("user-agent", "GitHubCopilotChat/0.62.0");
  check("Copilot UA detected even when env default is universal", (() => {
    const prev = process.env[CLIENT_PROFILE_ENV];
    process.env[CLIENT_PROFILE_ENV] = "universal";
    const r = resolveClientProfile(copilotUa) === "copilot";
    process.env[CLIENT_PROFILE_ENV] = prev;
    return r;
  })());

  const plain = new Headers();
  plain.set("user-agent", "OpenAI/NodeJS");
  check("generic client defaults to copilot (zero-regression default)", resolveClientProfile(plain) === "copilot");

  const u = capabilitiesFor("universal");
  const c = capabilitiesFor("copilot");
  check("universal bridges reasoning", u.bridgeReasoningToContent === true);
  check("copilot does NOT bridge reasoning", c.bridgeReasoningToContent === false);
  check("copilot allows askQuestion injection", c.supportsAskQuestionInjection === true);
  check("universal blocks askQuestion injection", u.supportsAskQuestionInjection === false);
  check("universal never strips tools", u.neverStripTools === true);
  check("universal emits outage marker", u.emitOutageMarker === true);
  check("copilot does not emit outage marker", c.emitOutageMarker === false);
}

// ─────────────────────────────────────────────────────────
// D3 — reasoning bridge
// ─────────────────────────────────────────────────────────
console.log("D3. reasoning → content bridge");
{
  const reasoningOnly: CanonicalDelta = {
    choices: [{ index: 0, delta: { reasoning_content: "thinking hard" } }],
  };
  const bridged = bridgeReasoningToContent(reasoningOnly, true);
  check("universal: reasoning mirrored into content", bridged.choices[0].delta.content === "thinking hard");
  check("universal: reasoning field KEPT (Thinking UI still works)", bridged.choices[0].delta.reasoning_content === "thinking hard");

  const untouched = bridgeReasoningToContent(reasoningOnly, false);
  check("copilot: bridge is a strict no-op", untouched.choices[0].delta.content === undefined);

  const withContent: CanonicalDelta = {
    choices: [{ index: 0, delta: { content: "real answer", reasoning: "thinking" } }],
  };
  const notDuped = bridgeReasoningToContent(withContent, true);
  check("real content is never overwritten/duplicated", notDuped.choices[0].delta.content === "real answer");

  // End-to-end through the serializer.
  const frame = serializeDelta(reasoningOnly, capabilitiesFor("universal"));
  const payload = JSON.parse(frame.replace(/^data: /, ""));
  check("serializer (universal) emits bridged content", payload.choices[0].delta.content === "thinking hard");
  check("serializer (universal) keeps reasoning_content", payload.choices[0].delta.reasoning_content === "thinking hard");

  const frameCopilot = serializeDelta(reasoningOnly, capabilitiesFor("copilot"));
  const payloadCopilot = JSON.parse(frameCopilot.replace(/^data: /, ""));
  check("serializer (copilot) does NOT bridge", payloadCopilot.choices[0].delta.content === undefined);

  // Non-streamed response bridging.
  const resp = {
    id: "x", model: "m", created: 1,
    choices: [{ index: 0, message: { role: "assistant" as const, content: null, reasoning_content: "cot only" }, finish_reason: "stop" as const }],
  };
  const serU = serializeResponse(resp as any, capabilitiesFor("universal")) as any;
  check("serializeResponse (universal) bridges reasoning-only turn", serU.choices[0].message.content === "cot only");
  const serC = serializeResponse(resp as any, capabilitiesFor("copilot")) as any;
  check("serializeResponse (copilot) leaves content null", serC.choices[0].message.content === null);
}

// ─────────────────────────────────────────────────────────
// D4 — Anthropic tool_calls / tool_result
// ─────────────────────────────────────────────────────────
console.log("D4. Anthropic tool_use / tool_result forwarding");
{
  const TOOL_CALL = {
    id: "call_1",
    type: "function" as const,
    function: { name: "manage_todo_list", arguments: '{"todoList":[]}' },
  };
  const REQ: CanonicalRequest = {
    model: "m",
    messages: [
      { role: "user", content: "Plan." },
      { role: "assistant", content: null as any, tool_calls: [TOOL_CALL] },
      { role: "tool", content: "Updated todo list", tool_call_id: "call_1" },
    ],
    stream: false,
  };
  const built = messagesAdapter.buildRequest(REQ, "k", "https://api.anthropic.com/v1", "m");
  const body = JSON.parse(built.body);
  const assistant = body.messages.find((m: any) => m.role === "assistant");
  check("assistant turn present", !!assistant);
  const toolUse = assistant?.content?.find((b: any) => b.type === "tool_use");
  check("assistant emits a tool_use block", !!toolUse);
  check("tool_use id/name preserved", toolUse?.id === "call_1" && toolUse?.name === "manage_todo_list");
  check("tool_use input is parsed JSON", toolUse?.input && typeof toolUse.input === "object");

  const toolResultTurn = body.messages.find(
    (m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result")
  );
  check("tool result becomes a `user` turn (Anthropic requirement)", toolResultTurn?.role === "user");
  const tr = toolResultTurn?.content?.find((b: any) => b.type === "tool_result");
  check("tool_result anchors to the call id", tr?.tool_use_id === "call_1");
  check("tool_result carries the text", tr?.content?.[0]?.text === "Updated todo list");
  check("no bare role:'tool' message leaks", !body.messages.some((m: any) => m.role === "tool"));
}

// ─────────────────────────────────────────────────────────
// D6 — Anthropic thinking preservation
// ─────────────────────────────────────────────────────────
console.log("D6. Anthropic thinking → reasoning");
{
  const nonStreamBody = JSON.stringify({
    id: "msg_1", model: "claude", stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "let me consider" },
      { type: "text", text: "Answer." },
    ],
  });
  const parsed = messagesAdapter.parseResponse(nonStreamBody, 200);
  check("non-stream thinking preserved as reasoning", parsed.choices[0].message.reasoning === "let me consider");
  check("non-stream text still present", parsed.choices[0].message.content === "Answer.");

  const chunk = [
    "event: content_block_delta",
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"hmm"}}',
  ].join("\n");
  const delta = messagesAdapter.parseStreamChunk(chunk);
  check("thinking_delta → reasoning", delta?.choices[0].delta.reasoning === "hmm");
}

// ─────────────────────────────────────────────────────────
// D7 — tool-aware terminal reason
// ─────────────────────────────────────────────────────────
console.log("D7. terminal reason reflects tool calls");
{
  check("sawToolCalls=true → tool_calls", resolveFinishReason(true, undefined) === "tool_calls");
  check("sawToolCalls=true overrides upstream 'stop'", resolveFinishReason(true, "stop") === "tool_calls");
  check("no tool calls + upstream stop → stop", resolveFinishReason(false, "stop") === "stop");
  check("no tool calls + no upstream → stop", resolveFinishReason(false, undefined) === "stop");
  check("no tool calls + upstream length → length", resolveFinishReason(false, "length") === "length");

  const toolDelta: CanonicalDelta = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1" }] } }] };
  check("deltaHasToolCalls detects tool deltas", deltaHasToolCalls(toolDelta) === true);
  check("deltaHasToolCalls false for text", deltaHasToolCalls({ choices: [{ index: 0, delta: { content: "x" } }] }) === false);
}

// ─────────────────────────────────────────────────────────
// D8 — responses terminal mapping
// ─────────────────────────────────────────────────────────
console.log("D8. responses status → finish_reason");
{
  const mk = (status: string, extra: Record<string, unknown> = {}) =>
    [
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: { id: "r1", model: "m", status, usage: { input_tokens: 1, output_tokens: 2 }, ...extra },
        }),
    ].join("\n");

  const completed = responsesAdapter.parseStreamChunk(mk("completed"));
  check("completed → stop", completed?.choices[0].finish_reason === "stop");

  const toolIncomplete = responsesAdapter.parseStreamChunk(
    mk("incomplete", { incomplete_details: { reason: "tool_calls" } })
  );
  check("incomplete/tool_calls → tool_calls (was collapsed to stop)", toolIncomplete?.choices[0].finish_reason === "tool_calls");

  const lenIncomplete = responsesAdapter.parseStreamChunk(
    mk("incomplete", { incomplete_details: { reason: "max_output_tokens" } })
  );
  check("incomplete/max_output_tokens → length", lenIncomplete?.choices[0].finish_reason === "length");

  // Non-streaming: a completed turn WITH function calls must report tool_calls.
  const nonStream = JSON.stringify({
    id: "r2", model: "m", status: "completed",
    output: [
      { type: "function_call", call_id: "c1", name: "t", arguments: "{}" },
    ],
  });
  const parsedResp = responsesAdapter.parseResponse(nonStream, 200);
  check("non-stream with function_call → tool_calls", parsedResp.choices[0].finish_reason === "tool_calls");
}

// ─────────────────────────────────────────────────────────
// D9 — image passthrough
// ─────────────────────────────────────────────────────────
console.log("D9. image_url parts forwarded");
{
  const REQ: CanonicalRequest = {
    model: "m",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
        ],
      },
    ],
    stream: false,
  };
  const body = JSON.parse(chatCompletionsAdapter.buildRequest(REQ, "k", "https://api.openai.com/v1", "m").body);
  const content = body.messages[0].content;
  check("multimodal content stays an array", Array.isArray(content));
  check("image_url part preserved", content.some((c: any) => c.type === "image_url" && c.image_url.url === "https://example.com/a.png"));
  check("text part preserved", content.some((c: any) => c.type === "text" && c.text === "What is this?"));

  // All-text arrays still flatten to a plain string (unchanged behavior).
  const textOnly: CanonicalRequest = {
    model: "m",
    messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
    stream: false,
  };
  const tbody = JSON.parse(chatCompletionsAdapter.buildRequest(textOnly, "k", "u", "m").body);
  check("all-text array still flattens to string", tbody.messages[0].content === "ab");
}

// ─────────────────────────────────────────────────────────
// EXH — outage marker
// ─────────────────────────────────────────────────────────
console.log("EXH. exhausted-pool outage marker");
{
  const copilotMsg = exhaustedMessageFor(false);
  const universalMsg = exhaustedMessageFor(true);
  check("universal message carries the marker", universalMsg.startsWith(EXHAUSTED_POOL_MARKER));
  check("copilot message has NO marker", !copilotMsg.includes(EXHAUSTED_POOL_MARKER));
  check("universal message still explains the outage", universalMsg.includes("pool is exhausted"));

  const resp = buildExhaustedPoolResponse("m", universalMsg);
  check("response uses the supplied message", (resp.choices[0].message.content as string).includes(EXHAUSTED_POOL_MARKER));
  check("outage response still ends the turn (stop, no tools)", resp.choices[0].finish_reason === "stop" && !resp.choices[0].message.tool_calls);
}

// ─────────────────────────────────────────────────────────
// KA — keepalive frame
// ─────────────────────────────────────────────────────────
console.log("KA. keepalive frame validity");
{
  const frame = buildKeepaliveChunk();
  check("frame is an SSE data line", frame.startsWith("data: ") && frame.endsWith("\n\n"));
  const payload = JSON.parse(frame.replace(/^data: /, ""));
  check("frame has exactly one choice", payload.choices?.length === 1);
  check("frame delta is empty (no content/tools)", !payload.choices[0].delta.content && !payload.choices[0].delta.tool_calls);
  check("frame finish_reason is null (not terminal)", payload.choices[0].finish_reason === null);
}

// ─────────────────────────────────────────────────────────
// D12 — rate-limit pre-dispatch cap
// ─────────────────────────────────────────────────────────
console.log("D12. pre-dispatch wait cap");
{
  const prev = process.env.ROUTER_MAX_PRE_DISPATCH_WAIT_MS;
  delete process.env.ROUTER_MAX_PRE_DISPATCH_WAIT_MS;
  check("default cap is bounded (< a full window)", maxPreDispatchWaitMs() > 0 && maxPreDispatchWaitMs() <= 10_000);
  process.env.ROUTER_MAX_PRE_DISPATCH_WAIT_MS = "250";
  check("env override respected", maxPreDispatchWaitMs() === 250);
  if (prev === undefined) delete process.env.ROUTER_MAX_PRE_DISPATCH_WAIT_MS;
  else process.env.ROUTER_MAX_PRE_DISPATCH_WAIT_MS = prev;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
