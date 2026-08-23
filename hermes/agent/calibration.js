// ─── Calibration Pipeline ──────────────────────────────
// Agent-driven rate-limit calibration for ONE provider at a time.
//
// Unlike the legacy benchmark runner (which STRESSES a key to
// discover limits), this pipeline NEVER calls the model, key, or
// provider. Instead it researches the provider's published
// free-quota rate limits (RPM / TPM / RPD / TPD, etc.) from the
// web via the MCP servers. The findings are emitted as a live
// event stream and stored on the CalibrationSession for the user
// to review and apply manually.
//
// `log` is an optional sink (e.g. a PTY terminal) so the agent's
// activity can also be rendered in the on-page terminal.

const { callMcpTool } = require("./mcp-client");

/**
 * Runs a full calibration session for one provider.
 *
 * @param {string} routerAdminUrl
 * @param {string} sessionId
 * @param {(line: string) => void} [log] Optional local log sink.
 */
async function runCalibrationSession(routerAdminUrl, sessionId, log = () => {}) {
  const emit = makeEmitter(routerAdminUrl, sessionId, log);

  try {
    // Load the session + its provider context.
    const session = await apiGet(routerAdminUrl, `/calibration/sessions/${sessionId}`);
    if (!session) throw new Error("Calibration session not found");

    const providerName = session.provider?.name || "provider";
    const providerUrl = session.provider?.baseUrl || "";
    const keyLabel = session.apiKey?.label || session.apiKeyId;
    const modelLabel = session.providerModel?.displayName || session.providerModelId;

    emit(
      "INFO",
      `Calibration session started for ${providerName}`,
      `key=${keyLabel} model=${modelLabel}`
    );

    await apiPatch(routerAdminUrl, `/calibration/sessions/${sessionId}`, {
      status: "RUNNING",
    });

    // ── Phase 1: research free-quota rate limits ───────────
    emit("INFO", `Researching ${providerName} free-quota rate limits from public sources…`);

    const findings = {
      rpm: null,
      tpm: null,
      rpd: null,
      tpd: null,
      contextWindow: null,
      sources: [],
      notes: "",
    };

    const queries = buildQueries(providerName, providerUrl);

    // 1) Search the web for rate-limit documentation.
    const hits = [];
    for (const q of queries.slice(0, 3)) {
      emit("SEARCH", `Searching: "${q}"`);
      let results;
      try {
        results = await callMcpTool("duckduckgo", "search", { query: q, max_results: 5 });
      } catch (err) {
        emit("ERROR", `Search failed for "${q}"`, err.message);
        continue;
      }
      const urls = extractUrls(results).filter(Boolean);
      emit("INFO", `Found ${urls.length} candidate URL(s)`);
      hits.push(...urls);
    }

    // 2) Fetch the provider's own docs/base URL first (highest signal).
    const toFetch = [providerUrl, ...hits].filter(Boolean).slice(0, 5);
    for (const url of toFetch) {
      emit("FETCH", `Fetching ${url}`);
      let content;
      try {
        content = await callMcpTool("fetch", "fetch_content", { url });
      } catch (err) {
        emit("ERROR", `Fetch failed for ${url}`, err.message);
        continue;
      }
      const extracted = extractRateLimits(content);
      const found = mergeFindings(findings, extracted);
      if (found > 0) {
        emit(
          "EXTRACT",
          `Extracted ${found} rate-limit value(s) from ${url}`,
          summarize(findings)
        );
        if (!findings.sources.some((s) => s.url === url)) {
          findings.sources.push({ label: url.split("/")[2] || url, url });
        }
      } else {
        emit("SKIP", `No rate-limit values found in ${url}`);
      }
      // Stop once we have a full picture.
      if (countSet(findings) >= 4) break;
    }

    emit("RESULT", `Rate-limit research complete for ${providerName}`, summarize(findings));
    emit(
      "DONE",
      `Calibration session finished. Review the findings and apply them to the key manually.`
    );

    await apiPatch(routerAdminUrl, `/calibration/sessions/${sessionId}`, {
      status: "COMPLETED",
      findings: JSON.stringify(findings),
    });
  } catch (err) {
    emit("ERROR", "Calibration session failed", err.message);
    try {
      await apiPatch(routerAdminUrl, `/calibration/sessions/${sessionId}`, {
        status: "FAILED",
        error: err.message,
      });
    } catch {}
  }
}

// ─── Research helpers ──────────────────────────────────

function buildQueries(name, baseUrl) {
  const queries = [
    `${name} API free tier rate limits RPM TPM`,
    `${name} API rate limits requests per minute tokens`,
  ];
  if (baseUrl) {
    const host = safeHost(baseUrl);
    if (host) queries.push(`${host} API limits ${name}`);
  }
  return queries;
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractUrls(results) {
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => {
      if (typeof r === "string") {
        try {
          return new URL(r).href;
        } catch {
          return null;
        }
      }
      return r?.url || r?.href || null;
    })
    .filter(Boolean);
}

// ─── Heuristic rate-limit extraction ───────────────────
// Looks for common patterns like "RPM", "TPM", "requests/min",
// "tokens/min", "RPD", "TPD" and pulls the leading number. This
// is the non-stress "research only" method; a smarter LLM-backed
// extractor can be added as a fallback later.

const LIMIT_PATTERNS = [
  {
    key: "rpm",
    label: "RPM",
    regex: /(\d+)\s*(?:RPM|requests?\s*\/\s*min|req\/min|requests per minute)\b/i,
  },
  {
    key: "tpm",
    label: "TPM",
    regex: /(\d+[kKmM]?)\s*(?:TPM|tokens?\s*\/\s*min|tokens per minute)\b/i,
  },
  {
    key: "rpd",
    label: "RPD",
    regex: /(\d+)\s*(?:RPD|requests?\s*\/\s*day|requests per day)\b/i,
  },
  {
    key: "tpd",
    label: "TPD",
    regex: /(\d+[kKmM]?)\s*(?:TPD|tokens?\s*\/\s*day|tokens per day)\b/i,
  },
  {
    key: "contextWindow",
    label: "context",
    regex: /(\d+[kKmM]?)\s*(?:context\s*window|max\s*context|context\s*length)\b/i,
  },
];

function extractRateLimits(content) {
  const text = String(content || "");
  const result = {};
  for (const pat of LIMIT_PATTERNS) {
    const m = text.match(pat.regex);
    if (m && m[1]) result[pat.key] = parseNumber(m[1]);
  }
  return result;
}

function parseNumber(raw) {
  const s = String(raw).toLowerCase();
  let n = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(n)) return null;
  if (s.endsWith("k")) n *= 1000;
  if (s.endsWith("m")) n *= 1000000;
  return Math.round(n);
}

function mergeFindings(findings, extracted) {
  let count = 0;
  for (const [k, v] of Object.entries(extracted)) {
    if (v != null && findings[k] == null) {
      findings[k] = v;
      count++;
    }
  }
  return count;
}

function countSet(findings) {
  return Object.entries(findings).filter(
    ([k, v]) => !["sources", "notes"].includes(k) && v != null
  ).length;
}

function summarize(findings) {
  const parts = [
    findings.rpm != null ? `RPM ${findings.rpm}` : null,
    findings.tpm != null ? `TPM ${findings.tpm}` : null,
    findings.rpd != null ? `RPD ${findings.rpd}` : null,
    findings.tpd != null ? `TPD ${findings.tpd}` : null,
    findings.contextWindow != null ? `context ${findings.contextWindow}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no values found";
}

// ─── Router client helpers ─────────────────────────────

async function apiGet(routerAdminUrl, path) {
  const res = await fetch(`${routerAdminUrl}${path}`);
  if (!res.ok) return null;
  return res.json();
}

async function apiPatch(routerAdminUrl, path, body) {
  const res = await fetch(`${routerAdminUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed (${res.status})`);
  return res.json();
}

/** Fire-and-forget event emitter that also mirrors to a local log. */
function makeEmitter(routerAdminUrl, sessionId, log) {
  return (kind, message, detail) => {
    const line = detail
      ? `[calibrate] [${kind}] ${message} — ${detail}`
      : `[calibrate] [${kind}] ${message}`;
    console.log(line);
    try {
      log(line);
    } catch {}
    fetch(`${routerAdminUrl}/calibration/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message, detail: detail || null }),
    }).catch(() => {});
  };
}

module.exports = {
  runCalibrationSession,
  extractRateLimits,
  buildQueries,
};
