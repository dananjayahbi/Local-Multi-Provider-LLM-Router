// ─── Startup Module ─────────────────────────────────────
// Runs once on first boot to initialize the AppSettings
// singleton and display the unified gateway key.

import { initializeAppSettings } from "@/engine/data-access/settings";
import { checkAndRecoverExpiredPenalties } from "@/engine/health-engine";

let gatewayKeyShown = false;

export async function runStartup(): Promise<void> {
  const { plaintextKey } = await initializeAppSettings();

  if (plaintextKey && !gatewayKeyShown) {
    console.log("");
    console.log("══════════════════════════════════════════════════════");
    console.log("  LOCAL MULTI-PROVIDER LLM ROUTER");
    console.log(`  Running on http://localhost:${process.env.PORT || "4006"}`);
    console.log("══════════════════════════════════════════════════════");
    console.log("");
    console.log("  🔑 YOUR UNIFIED GATEWAY KEY:");
    console.log(`     ${plaintextKey}`);
    console.log("");
    console.log("  Copy this key now. It will NOT be shown again.");
    console.log("  Paste it into your client's API key configuration.");
    console.log("  You can regenerate it from the Settings page.");
    console.log("");
    console.log("══════════════════════════════════════════════════════");
    console.log("");
    gatewayKeyShown = true;
  }

  // Recover any expired penalties on startup
  const recovered = await checkAndRecoverExpiredPenalties();
  if (recovered > 0) {
    console.log(`  ✅ Recovered ${recovered} expired penalty(s) on startup.`);
  }
}
