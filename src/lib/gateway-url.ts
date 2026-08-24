// ─── Gateway Base URL ──────────────────────────────────
// Builds the OpenAI-compatible base URL that clients (VS Code Copilot, chat
// apps) point at. We prefer the current host so it works on localhost AND on a
// deployed host; falls back to localhost:4006 when the origin isn't available
// (e.g. server-side render / non-browser).

const DEFAULT_ORIGIN = "http://localhost:4006";
const GATEWAY_PATH = "/api/gateway/v1";

/** The full gateway base URL, e.g. http://localhost:4006/api/gateway/v1. */
export function gatewayBaseUrl(origin?: string): string {
  const host = origin || (typeof window !== "undefined" ? window.location.origin : DEFAULT_ORIGIN);
  return `${host}${GATEWAY_PATH}`;
}
