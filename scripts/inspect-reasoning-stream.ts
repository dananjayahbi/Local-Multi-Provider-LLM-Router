// ─── Raw Stream Reasoning Inspector ───────────────────
// Captures the raw SSE from the gateway and prints the first reasoning-bearing
// deltas so we can confirm the fix: `delta.reasoning` (string) passes through
// and `reasoning_details` (array) is normalized to a string.
//
// Run: npx tsx scripts/inspect-reasoning-stream.ts

export {}; // module-scope: prevents top-level const collision with other scripts

const GATEWAY_URL = "http://localhost:4006/api/gateway/v1/chat/completions";
const POOL_KEY = "sk-NseiAVeURYm9B6o42iqGnnbtaaz_Cjjak4ulTPWu9za00pwa";
const POOL_MODEL = "OpenRouter-Free-Endpoint";

const MESSAGES = [
  { role: "system", content: "You are a code assistant. Think carefully before answering." },
  { role: "user", content: "What is 17 * 23? Show your reasoning." },
];

async function run() {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${POOL_KEY}` },
    body: JSON.stringify({ model: POOL_MODEL, messages: MESSAGES, temperature: 0.2, stream: true }),
  });
  console.log("HTTP status:", res.status);
  if (!res.ok) { console.error(await res.text()); process.exit(1); }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "", reasoningChunks = 0, reasoningDetailsChunks = 0, bridgedContent = 0;
  const samples: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim() || !line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const chunk = JSON.parse(json);
        const d = chunk.choices?.[0]?.delta ?? {};
        if (typeof d.reasoning === "string" && d.reasoning.length > 0) {
          reasoningChunks++;
          if (samples.length < 3) samples.push(JSON.stringify(d));
        }
        if (Array.isArray(d.reasoning_details)) reasoningDetailsChunks++;
        if (typeof d.content === "string" && d.content.startsWith("> thinking")) bridgedContent++;
      } catch {}
    }
  }

  console.log("reasoning (string) chunks:", reasoningChunks);
  console.log("reasoning_details (array) chunks:", reasoningDetailsChunks);
  console.log("content bridged as '> thinking' chunks:", bridgedContent);
  console.log("sample reasoning deltas:");
  for (const s of samples) console.log("  ", s);

  const fixed = reasoningChunks > 0 && reasoningDetailsChunks === 0 && bridgedContent === 0;
  console.log("\n" + (fixed
    ? "✅ FIX CONFIRMED — reasoning passes as a string in delta.reasoning; no array, no content bridging."
    : "⚠️  review — expected delta.reasoning string deltas."));
  process.exit(fixed ? 0 : 1);
}

run();
