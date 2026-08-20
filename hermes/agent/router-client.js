// ─── Router Admin API Client ──────────────────────────
// Thin fetch wrapper around the LLM Router Admin API.
// The admin API is unauthenticated (bound to localhost:4006);
// the gateway (inference) endpoint requires a bearer key.

const BASE = process.env.ROUTER_ADMIN_URL || "http://localhost:4006/api/admin";

/**
 * Perform an HTTP request against the router Admin API.
 * Returns parsed JSON on 2xx, throws an Error with server detail otherwise.
 */
async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data && (data.error || data.message || data.detail);
    throw new Error(`HTTP ${res.status} ${method} ${path}${detail ? ` — ${detail}` : ""}`);
  }
  return data;
}

module.exports = {
  BASE,
  req,
  get: (p) => req("GET", p),
  post: (p, b) => req("POST", p, b),
  put: (p, b) => req("PUT", p, b),
  patch: (p, b) => req("PATCH", p, b),
  del: (p) => req("DELETE", p),
};
