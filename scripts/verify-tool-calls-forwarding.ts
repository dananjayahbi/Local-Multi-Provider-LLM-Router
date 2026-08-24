// ─── Tool-Calls Forwarding Verification ────────────────
// Reproduces & guards against the "todo tool loops" bug.
//
// When GitHub Copilot calls a tool (e.g. `manage_todo_list`), it sends the
// conversation back with an `assistant` message that carries `tool_calls`
// followed by one or more `tool`-role result messages. A proxy that DROPS
// `tool_calls` (our router did) leaves each `tool` result with NO anchor, so
// the upstream model can't correlate results to calls and keeps re-issuing
// the same tool — the repeated "Added todo" / "Updated todo list" loop.
//
// This test asserts that the chat-completions + responses adapters forward
// assistant `tool_calls` in the request body.
//
// Run: npx tsx scripts/verify-tool-calls-forwarding.ts

import { chatCompletionsAdapter } from "../src/engine/adapters/chat-completions";
import { responsesAdapter } from "../src/engine/adapters/responses";
import { CanonicalRequest } from "../src/engine/canonical";

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

const TOOL_CALL = {
  id: "call_abc123",
  type: "function" as const,
  function: { name: "manage_todo_list", arguments: '{"todoList":[{"title":"a","status":"in-progress"}]}' },
};

const REQ: CanonicalRequest = {
  model: "m",
  messages: [
    { role: "user", content: "Plan the work." },
    { role: "assistant", content: null as any, tool_calls: [TOOL_CALL] },
    { role: "tool", content: "Updated todo list", tool_call_id: "call_abc123" },
  ],
  stream: false,
  tools: [{ type: "function", function: { name: "manage_todo_list", description: "d", parameters: { type: "object", properties: {} } } }],
};

// 1. chat-completions buildRequest forwards assistant tool_calls.
console.log("1. chat-completions forwards assistant tool_calls");
const cc = chatCompletionsAdapter.buildRequest(REQ, "k", "https://api.openai.com/v1", "m");
const ccBody = JSON.parse(cc.body);
const ccAssistant = ccBody.messages.find((m: any) => m.role === "assistant");
check("assistant message present", !!ccAssistant, "missing assistant message");
check("assistant.tool_calls forwarded", JSON.stringify(ccAssistant.tool_calls) === JSON.stringify([TOOL_CALL]), JSON.stringify(ccAssistant.tool_calls));
const ccTool = ccBody.messages.find((m: any) => m.role === "tool");
check("tool result preserved", !!ccTool && ccTool.content === "Updated todo list" && ccTool.tool_call_id === "call_abc123");

// 2. content:null assistant message is NOT collapsed to "" (null preserved so
//    tool_calls is the meaningful payload and the message isn't mistaken for empty).
console.log("2. assistant content:null preserved");
check("assistant.content preserved as null", ccAssistant.content === null, JSON.stringify(ccAssistant.content));

// 3. Anthropic-content assistant message (json parts) is flattened to a string,
//    never breaking tool_calls attachment.
console.log("3. flattened content keeps tool_calls");
const REQ2: CanonicalRequest = {
  model: "m",
  messages: [
    { role: "assistant", content: [{ type: "text", text: "hi" }], tool_calls: [TOOL_CALL] },
  ],
  stream: false,
};
const cc2 = chatCompletionsAdapter.buildRequest(REQ2, "k", "https://api.openai.com/v1", "m");
const cc2Assistant = JSON.parse(cc2.body).messages.find((m: any) => m.role === "assistant");
check("flattened content = 'hi'", cc2Assistant.content === "hi", JSON.stringify(cc2Assistant.content));
check("tool_calls still attached", JSON.stringify(cc2Assistant.tool_calls) === JSON.stringify([TOOL_CALL]));

// 4. responses adapter forwards tool_calls too.
console.log("4. responses adapter forwards assistant tool_calls");
const rs = responsesAdapter.buildRequest(REQ, "k", "https://api.openai.com/v1", "m");
const rsBody = JSON.parse(rs.body);
const rsAssistant = rsBody.input.find((m: any) => m.role === "assistant");
check("responses assistant.tool_calls forwarded", JSON.stringify(rsAssistant.tool_calls) === JSON.stringify([TOOL_CALL]), JSON.stringify(rsAssistant.tool_calls));

// 5. A message WITHOUT tool_calls is unaffected (no empty array leaks).
console.log("5. no tool_calls → no empty array");
const REQ3: CanonicalRequest = {
  model: "m",
  messages: [{ role: "assistant", content: "hello" }],
  stream: false,
};
const cc3 = chatCompletionsAdapter.buildRequest(REQ3, "k", "https://api.openai.com/v1", "m");
const cc3Assistant = JSON.parse(cc3.body).messages.find((m: any) => m.role === "assistant");
check("no tool_calls key when empty", !("tool_calls" in cc3Assistant), JSON.stringify(cc3Assistant));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
