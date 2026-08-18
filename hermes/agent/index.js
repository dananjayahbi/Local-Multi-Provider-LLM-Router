// ─── Hermes Agent Core ─────────────────────────────────
// Autonomous provider discovery agent. Runs discovery
// sessions, stages draft providers via the router Admin API.

const { runDiscoverySession } = require("./discovery");

const ROUTER_ADMIN_URL =
  process.env.ROUTER_ADMIN_URL || "http://localhost:4006/api/admin";

async function main() {
  console.log("[hermes] Starting Hermes Agent...");
  console.log(`[hermes] Router Admin URL: ${ROUTER_ADMIN_URL}`);

  // Run a discovery session on startup
  try {
    const drafts = await runDiscoverySession(ROUTER_ADMIN_URL);
    console.log(`[hermes] Discovery complete. Staged ${drafts.length} draft provider(s).`);
  } catch (err) {
    console.error("[hermes] Discovery session failed:", err.message);
  }

  // Keep the process alive for scheduled runs
  setInterval(async () => {
    try {
      const drafts = await runDiscoverySession(ROUTER_ADMIN_URL);
      console.log(`[hermes] Scheduled discovery complete. Staged ${drafts.length} draft(s).`);
    } catch (err) {
      console.error("[hermes] Scheduled discovery failed:", err.message);
    }
  }, 6 * 60 * 60 * 1000); // every 6 hours
}

main();
