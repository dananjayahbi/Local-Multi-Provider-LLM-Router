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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ─── Bing search (primary) ─────────────────────────────
// Bing is more lenient with scraping than DuckDuckGo, which
// frequently serves an anomaly/captcha challenge to datacenter
// IPs. Parses the `b_algo` result blocks.
async function searchBing(query, maxResults = 5) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Bing search failed (${res.status})`);
  const html = await res.text();

  const results = [];
  // Each result is a <li class="b_algo"> block containing an <h2><a href="...">title</a></h2>
  const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/gi;
  const blocks = html.match(blockRe) || [];

  for (const block of blocks) {
    if (results.length >= maxResults) break;
    const linkMatch = block.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const url = decodeBingUrl(linkMatch[1]);
    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    results.push({ title, url, snippet });
  }
  return results;
}

/**
 * Decodes a Bing redirect URL (https://www.bing.com/ck/a?...&u=a1<base64>)
 * back to the real destination URL.
 */
function decodeBingUrl(href) {
  try {
    // Decode HTML entities (&amp; -> &) before URL parsing
    const clean = href.replace(/&amp;/g, "&");
    const u = new URL(clean);
    if (u.hostname.includes("bing.com") && u.searchParams.has("u")) {
      const encoded = u.searchParams.get("u");
      // Bing base64-encodes the target with a leading "a1" marker
      const b64 = encoded.replace(/^a1/, "");
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      if (decoded.startsWith("http")) return decoded;
    }
  } catch {}
  return href;
}

// ─── DuckDuckGo search (fallback) ──────────────────────
// Uses the HTML lite endpoint. Often blocked by an anomaly
// challenge, so Bing is preferred.
async function searchDuckDuckGo(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
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

// ─── Web search (Bing first, DDG fallback) ─────────────
async function searchWeb(query, maxResults = 5) {
  try {
    const results = await searchBing(query, maxResults);
    if (results.length > 0) return results;
  } catch (err) {
    console.error(`[mcp-http] Bing search failed, falling back to DDG: ${err.message}`);
  }
  return searchDuckDuckGo(query, maxResults);
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

// ─── Curated free-LLM-API sources ──────────────────────
// The most reliable signal for discovery is the curated GitHub
// lists of free OpenAI-compatible endpoints. Fetching these
// directly yields far better results than scraping generic
// search results (which return gaming/travel spam from
// datacenter IPs).
const CURATED_SOURCES = [
  {
    name: "awesome-free-llm-apis",
    url: "https://raw.githubusercontent.com/amardeeplakshkar/awesome-free-llm-apis/main/README.md",
  },
  {
    name: "awesome-freellm-apis",
    url: "https://raw.githubusercontent.com/freellms/awesome-freellm-apis/main/README.md",
  },
  {
    name: "free-llm-api-resources",
    url: "https://raw.githubusercontent.com/cheahjs/free-llm-api-resources/main/README.md",
  },
];

async function fetchCuratedSources() {
  const out = [];
  for (const src of CURATED_SOURCES) {
    try {
      const text = await fetchContent(src.url, 20000);
      out.push({ name: src.name, url: src.url, content: text });
    } catch (err) {
      console.error(`[mcp-http] Curated source ${src.name} failed: ${err.message}`);
    }
  }
  return out;
}

// ─── Tool registry ─────────────────────────────────────
const TOOLS = {
  search: {
    description: "Search the web (Bing primary, DuckDuckGo fallback).",
    handler: async (args) => {
      const results = await searchWeb(args.query, args.max_results || 5);
      return results.map((r) => ({ type: "text", text: JSON.stringify(r) }));
    },
  },
  curated_sources: {
    description:
      "Fetch curated GitHub lists of free OpenAI-compatible LLM API providers. Best source for discovery.",
    handler: async () => {
      const sources = await fetchCuratedSources();
      return sources.map((s) => ({ type: "text", text: JSON.stringify(s) }));
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
