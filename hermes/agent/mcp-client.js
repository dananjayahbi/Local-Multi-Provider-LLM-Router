// ─── MCP Protocol Client ───────────────────────────────
// Thin client for the three MCP servers (DuckDuckGo, Fetch,
// Context7). Uses the MCP SDK's HTTP transport.

const MCP_SERVERS = {
  duckduckgo: {
    url: process.env.MCP_DDG_URL || "http://localhost:3000",
    tools: ["search"],
  },
  fetch: {
    url: process.env.MCP_FETCH_URL || "http://localhost:3001",
    tools: ["fetch_content"],
  },
  context7: {
    url: process.env.MCP_DOCS_URL || "http://localhost:3002",
    tools: ["query_docs"],
  },
};

/**
 * Executes a tool call on the specified MCP server.
 * Falls back to a direct HTTP call if the SDK transport is unavailable.
 */
async function callMcpTool(serverName, toolName, args) {
  const server = MCP_SERVERS[serverName];
  if (!server) throw new Error(`Unknown MCP server: ${serverName}`);

  // Direct HTTP fallback (JSON-RPC over HTTP)
  const res = await fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    throw new Error(`MCP call failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.result?.content ?? [];
}

module.exports = { callMcpTool, MCP_SERVERS };
