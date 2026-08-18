// ─── Lightweight HTTP MCP Server ───────────────────────
// Dependency-free JSON-RPC-over-HTTP server exposing the
// three tools the Hermes agent expects:
//   - search        (DuckDuckGo web search)
//   - fetch_content (web page content extraction)
//   - query_docs    (Context7 documentation lookup)
//
// The Hermes agent calls these via POST /mcp with a
// JSON-RPC 2.0 "tools/call" payload. This server responds
// with the same shape the agent's mcp-client.js expects.

const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;

// ─── DuckDuckGo search (uses the HTML lite endpoint) ───
async function searchDuckDuckGo(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const html = await res.text();

  // Parse result links from the HTML
  const results = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  const links = [...html.matchAll(linkRe)];
  const snippets = [...html.matchAll(snippetRe)];

  for (let i = 0; i < links.length && results.length < maxResults; i++) {
    let href = links[i][1];
    // DuckDuckGo wraps links in a redirect
    const m = href.match(/uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    const title = links[i][2].replace(/<[^>]+>/g, "").trim();
    const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]+>/g, "").trim() : "";
    results.push({ title, url: href, snippet });
  }
  return results;
}

// ─── Web content fetcher ───────────────────────────────
async function fetchContent(url, maxLength = 8000) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("application/json")) {
    return text.slice(0, maxLength);
  }

  // Strip HTML tags for readability
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, maxLength);
}

// ─── Context7 documentation lookup ─────────────────────
async function queryContext7(query, maxResults = 5) {
  const url = `https://context7.com/api/v1/search?query=${encodeURIComponent(query)}&limit=${maxResults}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "hermes-agent/1.0" },
  });
  if (!res.ok) throw new Error(`Context7 failed (${res.status})`);
  const data = await res.json();
  // Normalize to a simple list of { title, url, snippet }
  const items = Array.isArray(data) ? data : data.results || data.items || [];
  return items.map((it) => ({
    title: it.title || it.name || it.library || "",
    url: it.url || it.link || "",
    snippet: it.snippet || it.description || "",
  }));
}

// ─── Tool registry ─────────────────────────────────────
const TOOLS = {
  search: {
    description: "Search the web using DuckDuckGo.",
    handler: async (args) => {
      const results = await searchDuckDuckGo(args.query, args.max_results || 5);
      return results.map((r) => ({ type: "text", text: JSON.stringify(r) }));
    },
  },
  fetch_content: {
    description: "Fetch and extract the main text content from a webpage.",
    handler: async (args) => {
      const text = await fetchContent(args.url, args.max_length || 8000);
      return [{ type: "text", text }];
    },
  },
  query_docs: {
    description: "Look up documentation for a library using Context7.",
    handler: async (args) => {
      const results = await queryContext7(args.query, args.max_results || 5);
      return results.map((r) => ({ type: "text", text: JSON.stringify(r) }));
    },
  },
};

// ─── JSON-RPC request handler ──────────────────────────
function handleRequest(body) {
  const { id, method, params } = body;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-http-server", version: "1.0.0" },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: { type: "object", properties: {} },
        })),
      },
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    const tool = TOOLS[name];
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
    }
    return tool
      .handler(args || {})
      .then((content) => ({ jsonrpc: "2.0", id, result: { content } }))
      .catch((err) => ({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: err.message },
      }));
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// ─── HTTP server ───────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/mcp") {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  try {
    const body = JSON.parse(raw);
    const response = await handleRequest(body);
    res.end(JSON.stringify(response));
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[mcp-http] Listening on port ${PORT}`);
});
