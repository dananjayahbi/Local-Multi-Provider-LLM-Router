// ─── Copilot-like Gateway Stream Test ─────────────────
// Simulates how GitHub Copilot talks to the gateway. Sends a Bearer pool key,
// MANY tools, a system prompt, multi-turn messages, and requests `stream: true`.
// It renders only `delta.content` / `delta.tool_calls` / `finish_reason`, exactly
// like Copilot. If the stream yields neither content nor tool calls, Copilot
// would report "no response returned" — so we assert it produces usable output.
//
// Run: npx tsx scripts/test-copilot-stream.ts

export {}; // module-scope: prevents top-level const collision with other scripts

const GATEWAY_URL = "http://localhost:4006/api/gateway/v1/chat/completions";
const POOL_KEY = "sk-NseiAVeURYm9B6o42iqGnnbtaaz_Cjjak4ulTPWu9za00pwa";
const POOL_MODEL = "OpenRouter-Free-Endpoint";

const TOOLS = [
  { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "apply_patch", description: "Apply a patch", parameters: { type: "object", properties: { patch: { type: "string" } }, required: ["patch"] } } },
  { type: "function", function: { name: "grep", description: "Search text", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "run_command", description: "Run a shell command", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } } },
  { type: "function", function: { name: "list_dir", description: "List a directory", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
];

const MESSAGES = [
  { role: "system", content: "You are a code assistant. Use the provided tools when needed." },
  { role: "user", content: "Look at the project structure and explain what the orchestrator does." },
];

async function run() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120_000);

  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${POOL_KEY}` },
      body: JSON.stringify({ model: POOL_MODEL, messages: MESSAGES, tools: TOOLS, temperature: 0.2, stream: true, stream_options: { include_usage: true } }),
      signal: abort.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error("❌ Request failed:", (err as Error).message);
    process.exit(1);
  }

  console.log("HTTP status:", res.status);

  if (!res.ok) {
    const text = await res.text();
    console.error("❌ Error body:", text.slice(0, 800));
    process.exit(1);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", finishReason = null;
  let chunks = 0, emptyContentChunks = 0, toolCallChunks = 0;
  const firstChunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim() || line.startsWith(":") || !line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const chunk = JSON.parse(json);
        chunks++;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta ?? {};
        const piece = typeof d.content === "string" ? d.content : "";
        if (piece.length > 0) content += piece;
        else emptyContentChunks++;
        if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) toolCallChunks++;
        if (firstChunks.length < 4 && piece.length > 0) firstChunks.push(piece);
      } catch {}
    }
  }
  clearTimeout(timer);

  console.log("--- Summary ---");
  console.log("total chunks:", chunks);
  console.log("chunks with EMPTY content:", emptyContentChunks);
  console.log("chunks with tool_calls:", toolCallChunks);
  console.log("finish_reason:", finishReason);
  console.log("joined content length:", content.length);
  console.log("first content pieces:", JSON.stringify(firstChunks));
  console.log("content preview:", JSON.stringify(content.slice(0, 240)));

  const usable = content.trim().length > 0 || toolCallChunks > 0;
  console.log("\n" + (usable
    ? "✅ SUCCESS — stream produced usable output; Copilot would render it."
    : "❌ FAIL — stream produced NO content AND NO tool calls (reproduces 'no response returned')."));
  process.exit(usable ? 0 : 1);
}

run();
