// ─── Discovery Pipeline ────────────────────────────────
// Orchestrates the exploration → staging lifecycle using
// the MCP servers and the router Admin API.

const { callMcpTool } = require("./mcp-client");
const { SEARCH_QUERIES } = require("./prompts");

/**
 * Runs a full discovery session:
 *  1. Search DuckDuckGo for free LLM endpoints
 *  2. Fetch promising pages
 *  3. Extract provider details
 *  4. Stage drafts via the router Admin API
 */
async function runDiscoverySession(routerAdminUrl) {
  const stagedDrafts = [];

  for (const query of SEARCH_QUERIES) {
    console.log(`[hermes] Searching: "${query}"`);

    let results;
    try {
      results = await callMcpTool("duckduckgo", "search", { query, max_results: 5 });
    } catch (err) {
      console.error(`[hermes] Search failed for "${query}":`, err.message);
      continue;
    }

    // Extract URLs from search results
    const urls = extractUrls(results);
    console.log(`[hermes] Found ${urls.length} candidate URL(s)`);

    for (const url of urls.slice(0, 3)) {
      try {
        const content = await callMcpTool("fetch", "fetch_content", { url });
        const providers = extractProviders(content, url);

        for (const provider of providers) {
          const draft = await stageDraft(routerAdminUrl, provider);
          if (draft) stagedDrafts.push(draft);
        }
      } catch (err) {
        console.error(`[hermes] Fetch failed for ${url}:`, err.message);
      }
    }
  }

  return stagedDrafts;
}

/**
 * Stages a discovered provider as a draft via the Admin API.
 */
async function stageDraft(routerAdminUrl, provider) {
  try {
    const res = await fetch(`${routerAdminUrl}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat || "CHAT_COMPLETIONS",
        sourceUrl: provider.sourceUrl,
        discoveredModels: (provider.discoveredModels || []).map((m) => ({
          modelId: m,
          displayName: m,
        })),
      }),
    });

    if (!res.ok) {
      console.error(`[hermes] Draft staging failed (${res.status}): ${await res.text()}`);
      return null;
    }

    const draft = await res.json();
    console.log(`[hermes] Staged draft: ${draft.name} (${draft.baseUrl})`);
    return draft;
  } catch (err) {
    console.error("[hermes] Draft staging error:", err.message);
    return null;
  }
}

/**
 * Extracts URLs from MCP search results.
 */
function extractUrls(results) {
  const urls = [];
  for (const item of results) {
    if (typeof item === "string") {
      const matches = item.match(/https?:\/\/[^\s"']+/g);
      if (matches) urls.push(...matches);
    } else if (item.text) {
      const matches = item.text.match(/https?:\/\/[^\s"']+/g);
      if (matches) urls.push(...matches);
    }
  }
  return [...new Set(urls)];
}

/**
 * Extracts provider records from fetched content.
 * This is a heuristic parser; a real LLM would do this better.
 */
function extractProviders(content, sourceUrl) {
  const providers = [];
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === "string" ? c : c.text || "")).join("\n")
    : String(content);

  // Heuristic: look for base URLs with /v1 or /api patterns
  const urlMatches = text.match(/https?:\/\/[^\s"']+\/v1[^\s"']*/g) || [];
  const seen = new Set();

  for (const url of urlMatches) {
    const baseUrl = url.replace(/\/chat\/completions$/, "").replace(/\/messages$/, "");
    if (seen.has(baseUrl)) continue;
    seen.add(baseUrl);

    const hostname = new URL(baseUrl).hostname;
    providers.push({
      name: hostname.split(".")[0] || hostname,
      baseUrl,
      apiFormat: url.includes("/messages") ? "MESSAGES" : "CHAT_COMPLETIONS",
      sourceUrl,
      discoveredModels: [],
    });
  }

  return providers;
}

module.exports = { runDiscoverySession };
