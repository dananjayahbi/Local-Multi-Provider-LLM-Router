// ─── Discovery Pipeline ────────────────────────────────
// Orchestrates the exploration → staging lifecycle using
// the MCP servers and the router Admin API. Emits a live
// event stream (INFO/SEARCH/FETCH/EXTRACT/STAGE/SKIP/ERROR)
// so the UI can render the agent's conversation in real time.

const { callMcpTool } = require("./mcp-client");
const { SEARCH_QUERIES } = require("./prompts");
const { extractProvidersWithLLM, isConfigured, LLM_MODEL } = require("./llm-client");

// Domains that are never relevant to LLM API discovery.
const IRRELEVANT_HOSTS = [
  "poki.com",
  "crazygames.com",
  "play.google.com",
  "tripadvisor.com",
  "worldguidestotravel.com",
  "salutfromparis.com",
  "grow.google",
  "chatgpt.com",
  "openai.com",
];

/**
 * Runs a full discovery session:
 *  1. Fetch curated GitHub lists of free LLM APIs (best signal)
 *  2. Search the web for additional endpoints
 *  3. Fetch promising pages
 *  4. Extract provider details (LLM if configured, else heuristic)
 *  5. Dedupe against already-configured providers
 *  6. Stage drafts via the router Admin API
 *
 * @param {string} routerAdminUrl
 * @param {string|null} userPrompt Optional user-injected research focus.
 * @param {string|null} requestId   Discovery request id for event streaming.
 */
async function runDiscoverySession(routerAdminUrl, userPrompt = null, requestId = null) {
  const stagedDrafts = [];
  const emit = makeEmitter(routerAdminUrl, requestId);

  // Load already-configured provider base URLs so we skip them.
  const existingBaseUrls = await fetchExistingBaseUrls(routerAdminUrl);
  emit(
    "INFO",
    `${existingBaseUrls.size} existing provider/draft base URL(s) will be skipped.`
  );

  // Phase 1: curated sources (highest signal-to-noise).
  await exploreCuratedSources(routerAdminUrl, existingBaseUrls, stagedDrafts, emit, userPrompt);

  // Phase 2: web search for anything the curated lists miss.
  const queries = buildQueries(userPrompt);
  for (const query of queries) {
    emit("SEARCH", `Searching: "${query}"`);
    let results;
    try {
      results = await callMcpTool("duckduckgo", "search", { query, max_results: 5 });
    } catch (err) {
      emit("ERROR", `Search failed for "${query}"`, err.message);
      continue;
    }

    const urls = extractUrls(results).filter(isRelevantUrl);
    emit("INFO", `Found ${urls.length} relevant candidate URL(s)`);

    for (const url of urls.slice(0, 3)) {
      await exploreUrl(routerAdminUrl, url, existingBaseUrls, stagedDrafts, emit, userPrompt);
    }
  }

  emit("DONE", `Discovery complete. Staged ${stagedDrafts.length} draft provider(s).`);
  return stagedDrafts;
}

/**
 * Fetches the curated GitHub lists of free LLM APIs and extracts
 * providers from each. This is the primary, highest-quality source.
 */
async function exploreCuratedSources(routerAdminUrl, existingBaseUrls, stagedDrafts, emit, userPrompt) {
  emit("INFO", "Fetching curated free-LLM-API lists (highest quality source)...");
  let sources;
  try {
    sources = await callMcpTool("duckduckgo", "curated_sources", {});
  } catch (err) {
    emit("ERROR", "Failed to fetch curated sources", err.message);
    return;
  }

  for (const raw of sources) {
    let source;
    try {
      source = JSON.parse(typeof raw === "string" ? raw : raw.text || "{}");
    } catch {
      continue;
    }
    if (!source.content) continue;

    emit("FETCH", `Parsing curated list: ${source.name}`);
    const providers = await extractProviders(source.content, source.url, userPrompt);
    emit("EXTRACT", `Extracted ${providers.length} provider(s) from ${source.name}`);

    for (const provider of providers) {
      await stageIfNew(routerAdminUrl, provider, existingBaseUrls, stagedDrafts, emit);
    }
  }
}

/**
 * Fetches a single URL and stages any providers found within it.
 */
async function exploreUrl(routerAdminUrl, url, existingBaseUrls, stagedDrafts, emit, userPrompt) {
  try {
    emit("FETCH", `Fetching ${url}`);
    const content = await callMcpTool("fetch", "fetch_content", { url });
    const providers = await extractProviders(content, url, userPrompt);
    emit("EXTRACT", `Extracted ${providers.length} provider(s) from ${url}`);

    for (const provider of providers) {
      await stageIfNew(routerAdminUrl, provider, existingBaseUrls, stagedDrafts, emit);
    }
  } catch (err) {
    emit("ERROR", `Fetch failed for ${url}`, err.message);
  }
}

/**
 * Stages a provider as a draft unless its base URL is already known.
 */
async function stageIfNew(routerAdminUrl, provider, existingBaseUrls, stagedDrafts, emit) {
  if (existingBaseUrls.has(normalizeBaseUrl(provider.baseUrl))) {
    emit("SKIP", `Skipping already-configured provider: ${provider.baseUrl}`);
    return;
  }
  const draft = await stageDraft(routerAdminUrl, provider);
  if (draft) {
    stagedDrafts.push(draft);
    existingBaseUrls.add(normalizeBaseUrl(provider.baseUrl));
    emit("STAGE", `Staged draft: ${draft.name} (${draft.baseUrl})`);
  }
}

/**
 * Returns a function that emits a discovery event to the router
 * (fire-and-forget). No-op when no requestId is provided.
 */
function makeEmitter(routerAdminUrl, requestId) {
  if (!requestId) {
    return (kind, message, detail) =>
      console.log(`[hermes] [${kind}] ${message}${detail ? ` — ${detail}` : ""}`);
  }
  return (kind, message, detail) => {
    console.log(`[hermes] [${kind}] ${message}${detail ? ` — ${detail}` : ""}`);
    fetch(`${routerAdminUrl}/discovery/requests/${requestId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message, detail: detail || null }),
    }).catch(() => {});
  };
}

/**
 * Filters out URLs from domains that are never relevant to
 * LLM API discovery (gaming, travel, generic consumer sites).
 */
function isRelevantUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !IRRELEVANT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Builds the list of search queries. If the user supplied a
 * research prompt, it is used as the primary query.
 */
function buildQueries(userPrompt) {
  if (userPrompt) {
    return [userPrompt, ...SEARCH_QUERIES];
  }
  return SEARCH_QUERIES;
}

/**
 * Fetches the set of already-known base URLs (both onboarded
 * providers and pending drafts) from the router Admin API so
 * discovery can skip them and avoid duplicates.
 */
async function fetchExistingBaseUrls(routerAdminUrl) {
  const baseUrls = new Set();
  try {
    const res = await fetch(`${routerAdminUrl}/providers`);
    if (res.ok) {
      const providers = await res.json();
      for (const p of Array.isArray(providers) ? providers : []) {
        if (p.baseUrl) baseUrls.add(normalizeBaseUrl(p.baseUrl));
      }
    }
  } catch (err) {
    console.error("[hermes] Failed to fetch existing providers:", err.message);
  }

  try {
    const res = await fetch(`${routerAdminUrl}/drafts`);
    if (res.ok) {
      const drafts = await res.json();
      for (const d of Array.isArray(drafts) ? drafts : []) {
        if (d.baseUrl) baseUrls.add(normalizeBaseUrl(d.baseUrl));
      }
    }
  } catch (err) {
    console.error("[hermes] Failed to fetch existing drafts:", err.message);
  }

  return baseUrls;
}

/**
 * Normalizes a base URL for dedupe comparison (lowercase host,
 * strip trailing slash).
 */
function normalizeBaseUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return String(url).toLowerCase().replace(/\/+$/, "");
  }
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
 * Extracts provider records from fetched content. Uses the
 * configured LLM when available, otherwise falls back to the
 * heuristic parser.
 */
async function extractProviders(content, sourceUrl, userPrompt) {
  const llmProviders = await extractProvidersWithLLM(content, sourceUrl, userPrompt);
  if (llmProviders) {
    console.log(
      `[hermes] LLM (${LLM_MODEL}) extracted ${llmProviders.length} provider(s) from ${sourceUrl}`
    );
    return llmProviders;
  }
  return extractProvidersHeuristic(content, sourceUrl);
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
 * Heuristic provider parser (fallback when no LLM is configured).
 */
function extractProvidersHeuristic(content, sourceUrl) {
  const providers = [];
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === "string" ? c : c.text || "")).join("\n")
    : String(content);

  // Heuristic: look for base URLs with /v1 or /api patterns.
  // Exclude trailing punctuation/backticks that markdown lists add.
  const urlMatches = text.match(/https?:\/\/[^\s"'`]+/g) || [];
  const seen = new Set();

  // Paths that point at dashboards / key pages, not API endpoints.
  const NON_API_PATH = /(dashboard|console|keys|tokens|apikeys|settings|marketplace|explore|discover|usercenter|profile|docs|documentation|signup|login|pricing|about)/i;

  for (const url of urlMatches) {
    const baseUrl = url
      .replace(/[),.;]+$/, "")
      .replace(/\/chat\/completions$/, "")
      .replace(/\/messages$/, "");

    // Skip dashboard/key pages and bare domains without an API path.
    if (NON_API_PATH.test(baseUrl)) continue;
    if (!/\/v\d|\/api|\/openai/.test(baseUrl)) continue;

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
