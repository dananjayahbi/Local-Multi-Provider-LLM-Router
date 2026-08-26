// ─── Server Instrumentation ────────────────────────────
// Runs once when the Next.js server boots. We start a background interval
// that recovers expired penalties/cooldowns so keys come back to ACTIVE even
// while the admin UI is idle (only doing reads). Previously this recovery ran
// solely at the start of each `orchestrate()` call, so a key whose penalty
// countdown finished while nobody was making a request stayed PENALIZED
// forever on the pool page.

export async function register() {
  // Only run on the Node.js runtime (not the edge/middleware runtime).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPenaltyRecoveryLoop } = await import("./lib/penalty-recovery");
    startPenaltyRecoveryLoop();

    // Re-hydrate the in-memory rate-limit windows from durable request logs so
    // the router remembers recent RPM/TPM/RPD/TPD usage across a PC/container
    // restart (otherwise it stops pre-throttling and can hit a spurious 429).
    const { hydrateRateLimitWindows } = await import(
      "./engine/rate-limit/window-hydrator"
    );
    hydrateRateLimitWindows();
  }
}
