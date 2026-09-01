// ─── Chat Handler ──────────────────────────────────────
// Multi-turn agentic chat handler. The LLM can call tools
// (search, fetch, CRUD), get results, and continue reasoning
// before producing a final user-facing response.

const { callLLM } = require("./llm-client");
const { callMcpTool } = require("./mcp-client");

const ROUTER_ADMIN_URL =
  process.env.ROUTER_ADMIN_URL || "http://localhost:4006/api/admin";

const MAX_TOOL_ROUNDS = 5;

// ─── MCP Tool Wrappers ─────────────────────────────────

async function mcpSearch(query, maxResults = 5) {
  return callMcpTool("duckduckgo", "search", { query, max_results: maxResults });
}

async function mcpFetch(url, maxLen = 8000) {
  return callMcpTool("fetch", "fetch_content", { url, max_length: maxLen });
}

async function mcpDocs(query, maxResults = 3) {
  return callMcpTool("context7", "query_docs", { query, max_results: maxResults });
}

async function mcpCuratedSources() {
  return callMcpTool("duckduckgo", "curated_sources", {});
}

// ─── Router Admin API Tools ────────────────────────────

async function adminGet(path) {
  const res = await fetch(`${ROUTER_ADMIN_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function adminPost(path, body) {
  const res = await fetch(`${ROUTER_ADMIN_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function listProviders() { return adminGet("/providers"); }

async function createProvider(name, baseUrl, apiFormat = "CHAT_COMPLETIONS", notes = null) {
  return adminPost("/providers", { name, baseUrl, apiFormat, notes });
}

async function addApiKey(providerId, label, secret, rpmLimit = null, tpmLimit = null) {
  return adminPost(`/providers/${providerId}/keys`, { label, secret, rpmLimit, tpmLimit });
}

async function addProviderModel(providerId, modelId, displayName, opts = {}) {
  return adminPost(`/providers/${providerId}/models`, {
    modelId, displayName,
    supportsVision: opts.supportsVision ?? false,
    supportsFunctionCalling: opts.supportsFunctionCalling ?? false,
    contextWindow: opts.contextWindow ?? null,
  });
}

async function listPools() { return adminGet("/pools"); }

async function createPool(name, virtualModelName, members, opts = {}) {
  return adminPost("/pools", {
    name, virtualModelName,
    description: opts.description ?? null,
    routingStrategy: opts.routingStrategy ?? "ROUND_ROBIN",
    members,
  });
}

async function createDraft(name, baseUrl, apiFormat = "CHAT_COMPLETIONS", opts = {}) {
  return adminPost("/drafts", {
    name, baseUrl, apiFormat,
    sourceUrl: opts.sourceUrl ?? null,
    discoveredModels: opts.discoveredModels ?? [],
    notes: opts.notes ?? null,
  });
}

async function acceptDraft(draftId, secret) {
  return adminPost(`/drafts/${draftId}/validate`, { secret });
}

async function listDrafts() { return adminGet("/drafts"); }

// ─── Tool Registry ─────────────────────────────────────

const TOOLS = {
  search: {
    fn: (args) => mcpSearch(args.query, args.max_results),
    desc: "Search the web. Args: { query: string, max_results?: number }",
  },
  fetch_content: {
    fn: (args) => mcpFetch(args.url, args.max_length),
    desc: "Fetch and extract text from a URL. Args: { url: string, max_length?: number }",
  },
  query_docs: {
    fn: (args) => mcpDocs(args.query, args.max_results),
    desc: "Look up library/framework documentation. Args: { query: string, max_results?: number }",
  },
  list_providers: {
    fn: () => listProviders(),
    desc: "List all configured providers. Args: {}",
  },
  create_provider: {
    fn: (args) => createProvider(args.name, args.baseUrl, args.apiFormat, args.notes),
    desc: 'Create a provider. Args: { name: string, baseUrl: string, apiFormat?: "CHAT_COMPLETIONS"|"MESSAGES"|"RESPONSES", notes?: string }',
  },
  add_api_key: {
    fn: (args) => addApiKey(args.providerId, args.label, args.secret, args.rpmLimit, args.tpmLimit),
    desc: "Add an API key to a provider. Args: { providerId: string, label: string, secret: string, rpmLimit?: number, tpmLimit?: number }",
  },
  add_model: {
    fn: (args) => addProviderModel(args.providerId, args.modelId, args.displayName, args),
    desc: "Add a model to a provider. Args: { providerId: string, modelId: string, displayName: string, supportsVision?: bool, supportsFunctionCalling?: bool, contextWindow?: number }",
  },
  list_pools: {
    fn: () => listPools(),
    desc: "List all configured pools. Args: {}",
  },
  create_pool: {
    fn: (args) => createPool(args.name, args.virtualModelName, args.members, args),
    desc: 'Create a virtual model pool. Args: { name: string, virtualModelName: string, members: [{ providerModelId: string, priority?: number }] }',
  },
  create_draft: {
    fn: (args) => createDraft(args.name, args.baseUrl, args.apiFormat, args),
    desc: 'Stage a discovered provider as a draft. Args: { name: string, baseUrl: string, apiFormat?: string, sourceUrl?: string, discoveredModels?: string[] }',
  },
  accept_draft: {
    fn: (args) => acceptDraft(args.draftId, args.secret),
    desc: "Accept a draft provider with an API key. Args: { draftId: string, secret: string }",
  },
  list_drafts: {
    fn: () => listDrafts(),
    desc: "List all draft providers. Args: {}",
  },
  curated_sources: {
    fn: () => mcpCuratedSources(),
    desc: "Fetch curated GitHub lists of free OpenAI-compatible LLM API providers. Best source for discovery. Args: {}",
  },
};

function buildToolDocs() {
  return Object.entries(TOOLS)
    .map(([name, t]) => `- **${name}** — ${t.desc}`)
    .join("\n");
}

// ─── System Prompt ─────────────────────────────────────

function buildSystemPrompt() {
  return `You are Hermes, an AI assistant embedded in a Local Multi-Provider LLM Router admin panel.
You help users discover, configure, and manage LLM API providers.

## Tools
You have access to these tools. Call them by outputting EXACTLY one JSON block per tool call inside fenced code blocks:

\`\`\`tool_call
{"name": "tool_name", "args": { ... }}
\`\`\`

Available tools:
${buildToolDocs()}

## Rules
1. You may call MULTIPLE tools in a single response (one JSON block each).
2. After receiving tool results, continue reasoning and either call more tools or give a final answer.
3. When you have enough information, give a clear, natural-language final answer. Do NOT include tool_call blocks in your final answer.
4. When presenting discovered providers, wrap each in a fenced code block:

\`\`\`provider_card
{
  "name": "...",
  "baseUrl": "...",
  "apiFormat": "CHAT_COMPLETIONS",
  "discoveredModels": ["model-1"],
  "sourceUrl": "...",
  "rateLimitInfo": { "rpm": 60, "tpm": 100000, "freeQuota": "...", "docsUrl": "..." }
}
\`\`\`

5. Before asking the user for rate-limit info, ALWAYS check documentation or the provider's pricing page first.
6. When the user gives you an API key, immediately set it up.
7. For finding free LLM API providers, ALWAYS use curated_sources FIRST (it returns curated GitHub lists with the best signal). Only use generic search as a supplement.
8. Be concise but thorough. Use markdown formatting for readability.`;
}

// ─── Agentic Loop ──────────────────────────────────────

/**
 * Check if a session has been cancelled by the user.
 */
async function isCancelled(sessionId) {
  try {
    const res = await fetch(
      `${ROUTER_ADMIN_URL}/chat/cancelled?ids=${sessionId}`
    );
    if (!res.ok) return false;
    const cancelled = await res.json();
    return Array.isArray(cancelled) && cancelled.includes(sessionId);
  } catch {
    return false;
  }
}

async function processChatSession(sessionId) {
  console.log(`[hermes] Processing chat session ${sessionId}`);

  try {
    const sessionRes = await fetch(`${ROUTER_ADMIN_URL}/chat/sessions/${sessionId}`);
    if (!sessionRes.ok) throw new Error(`Failed to fetch session: ${sessionRes.status}`);
    const session = await sessionRes.json();

    const messages = session.messages || [];
    const recentMessages = messages.slice(-30);

    const llmMessages = [
      { role: "system", content: buildSystemPrompt() },
      ...recentMessages.map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
      })),
    ];

    let finalContent = "";
    let finalAssets = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Check if user cancelled
      if (await isCancelled(sessionId)) {
        console.log(`[hermes] Chat session ${sessionId} cancelled by user`);
        finalContent = cleanResponse(llmMessages[llmMessages.length - 1]?.content) || "⏹️ Processing stopped by user.";
        break;
      }

      const rawResponse = await callLLM(llmMessages);
      if (!rawResponse) throw new Error("LLM returned empty response");

      const providerCards = extractProviderCards(rawResponse);
      const toolCalls = extractToolCalls(rawResponse);
      const cleanText = cleanResponse(rawResponse);

      // No tools = final answer
      if (toolCalls.length === 0) {
        finalContent = cleanText || rawResponse;
        if (providerCards.length > 0) finalAssets = providerCards;
        break;
      }

      console.log(`[hermes] Chat round ${round + 1}: executing ${toolCalls.length} tool(s)`);

      const toolSummary = toolCalls.map((t) => `Calling ${t.name}...`).join(", ");
      const assistantMsg = cleanText
        ? `${cleanText}\n\n⏳ ${toolSummary}`
        : `⏳ ${toolSummary}`;

      const toolResults = [];
      for (const call of toolCalls) {
        try {
          const result = await executeToolCall(call);
          const resultStr = JSON.stringify(result, null, 2);
          toolResults.push({ name: call.name, success: true, result: resultStr });
          console.log(`[hermes]   ✅ ${call.name} (${resultStr.length} chars)`);
        } catch (err) {
          toolResults.push({ name: call.name, success: false, error: err.message });
          console.log(`[hermes]   ❌ ${call.name}: ${err.message}`);
        }
      }

      const toolResultsText = toolResults
        .map((r) => {
          if (r.success) {
            const truncated = r.result.length > 3000
              ? r.result.slice(0, 3000) + "\n... (truncated)"
              : r.result;
            return `### Tool: ${r.name} (success)\n\`\`\`json\n${truncated}\n\`\`\``;
          }
          return `### Tool: ${r.name} (error)\n${r.error}`;
        })
        .join("\n\n");

      llmMessages.push(
        { role: "assistant", content: assistantMsg },
        { role: "user", content: `Tool results:\n\n${toolResultsText}\n\nContinue reasoning. When ready, give your final answer to the user (no more tool calls).` }
      );

      if (providerCards.length > 0) finalAssets = providerCards;
    }

    if (!finalContent) {
      finalContent = "I've gathered some information but need more steps. Please try rephrasing your request.";
    }

    // Don't post if cancelled (the /stop endpoint already posted a message)
    if (await isCancelled(sessionId)) {
      console.log(`[hermes] Chat session ${sessionId} cancelled, skipping final post`);
      return;
    }

    await postMessage(sessionId, {
      role: "AGENT",
      content: finalContent,
      kind: finalAssets ? "ASSETS" : "TEXT",
      assets: finalAssets,
    });

    console.log(`[hermes] Chat response posted for session ${sessionId}`);
  } catch (err) {
    console.error(`[hermes] Chat processing failed for ${sessionId}:`, err.message);
    await postMessage(sessionId, {
      role: "AGENT",
      content: `I encountered an error: ${err.message}. Please try again.`,
      kind: "ERROR",
    });
  }
}

// ─── Helpers ───────────────────────────────────────────

async function postMessage(sessionId, msg) {
  await fetch(`${ROUTER_ADMIN_URL}/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  }).catch((err) => console.error("[hermes] Failed to post message:", err.message));
}

function extractToolCalls(text) {
  const calls = [];
  // ```tool_call\n{...}\n```
  const fenced = /```tool_call\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = fenced.exec(text)) !== null) {
    try { const o = JSON.parse(m[1].trim()); if (o.name) calls.push(o); } catch {}
  }
  if (calls.length > 0) return calls;
  // [TOOL_CALL]{...}[/TOOL_CALL]
  const bracket = /\[TOOL_CALL\]\s*([\s\S]*?)\s*\[\/TOOL_CALL\]/g;
  while ((m = bracket.exec(text)) !== null) {
    try { const o = JSON.parse(m[1].trim()); if (o.name) calls.push(o); } catch {}
  }
  if (calls.length > 0) return calls;
  // Bare JSON
  const bare = /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g;
  while ((m = bare.exec(text)) !== null) {
    try { const o = JSON.parse(m[0]); if (o.name) calls.push(o); } catch {}
  }
  return calls;
}

function extractProviderCards(text) {
  const cards = [];
  const fenced = /```provider_card\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = fenced.exec(text)) !== null) {
    try { cards.push(JSON.parse(m[1].trim())); } catch {}
  }
  const bracket = /\[PROVIDER_CARD\]\s*([\s\S]*?)\s*\[\/PROVIDER_CARD\]/g;
  while ((m = bracket.exec(text)) !== null) {
    try { cards.push(JSON.parse(m[1].trim())); } catch {}
  }
  return cards;
}

function cleanResponse(text) {
  return text
    .replace(/```tool_call\s*\n[\s\S]*?\n```/g, "")
    .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, "")
    .replace(/```provider_card\s*\n[\s\S]*?\n```/g, "")
    .replace(/\[PROVIDER_CARD\][\s\S]*?\[\/PROVIDER_CARD\]/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function executeToolCall(call) {
  const tool = TOOLS[call.name];
  if (!tool) throw new Error(`Unknown tool: ${call.name}`);
  return tool.fn(call.args || {});
}

module.exports = { processChatSession };
