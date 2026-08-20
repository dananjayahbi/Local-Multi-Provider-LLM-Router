// ─── Hermes Agent Core ─────────────────────────────────
// Autonomous provider discovery agent. Runs discovery
// sessions, stages draft providers via the router Admin API.
// Polls for user-triggered research requests and executes them.

const { runDiscoverySession } = require("./discovery");
const { isConfigured, LLM_MODEL } = require("./llm-client");

const ROUTER_ADMIN_URL =
  process.env.ROUTER_ADMIN_URL || "http://localhost:4006/api/admin";

const REQUEST_POLL_MS = 15_000; // check for user-triggered requests every 15s
const SCHEDULED_INTERVAL_MS = 6 * 60 * 60 * 1000; // scheduled run every 6h

async function main() {
  console.log("[hermes] Starting Hermes Agent...");
  console.log(`[hermes] Router Admin URL: ${ROUTER_ADMIN_URL}`);
  console.log(
    isConfigured()
      ? `[hermes] LLM extraction ENABLED (model: ${LLM_MODEL})`
      : "[hermes] LLM extraction DISABLED — set HERMES_LLM_API_KEY to enable smart extraction."
  );

  // Run a discovery session on startup
  await runScheduledDiscovery();

  // Poll for user-triggered research requests
  setInterval(pollForRequests, REQUEST_POLL_MS);

  // Keep the process alive for scheduled runs
  setInterval(runScheduledDiscovery, SCHEDULED_INTERVAL_MS);
}

async function runScheduledDiscovery() {
  try {
    const drafts = await runDiscoverySession(ROUTER_ADMIN_URL);
    console.log(`[hermes] Discovery complete. Staged ${drafts.length} draft provider(s).`);
  } catch (err) {
    console.error("[hermes] Discovery session failed:", err.message);
  }
}

/**
 * Polls the router for PENDING discovery requests and executes
 * the oldest one, injecting the user's optional prompt.
 */
async function pollForRequests() {
  let request;
  try {
    const res = await fetch(`${ROUTER_ADMIN_URL}/discovery/requests`);
    if (!res.ok) return;
    const requests = await res.json();
    request = (Array.isArray(requests) ? requests : []).find((r) => r.status === "PENDING");
  } catch (err) {
    console.error("[hermes] Failed to poll discovery requests:", err.message);
    return;
  }

  if (!request) return;

  console.log(`[hermes] Processing user-triggered research request ${request.id}`);
  try {
    await fetch(`${ROUTER_ADMIN_URL}/discovery/requests/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RUNNING" }),
    });

    const drafts = await runDiscoverySession(
      ROUTER_ADMIN_URL,
      request.prompt || null,
      request.id
    );

    await fetch(`${ROUTER_ADMIN_URL}/discovery/requests/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED", resultCount: drafts.length }),
    });
    console.log(`[hermes] Research request ${request.id} complete. Staged ${drafts.length} draft(s).`);
  } catch (err) {
    console.error(`[hermes] Research request ${request.id} failed:`, err.message);
    try {
      await fetch(`${ROUTER_ADMIN_URL}/discovery/requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "FAILED", error: err.message }),
      });
    } catch {}
  }
}

main();
