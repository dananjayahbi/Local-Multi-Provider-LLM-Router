// ─── Rate-Limit Window Hydrator ────────────────────────
// Runs once on server boot. Reconstructs recent per-key usage from the durable
// `RequestLog` table and seeds it into the in-memory rate-limiter windows so
// the router never forgets recent RPM/TPM/RPD/TPD usage across a PC or
// container restart.
//
// Fires-and-forgets: called from instrumentation.register() after the penalty
// recovery loop starts. On any DB error it logs and leaves the windows empty
// (which is no worse than a bare restart, and recovering is best-effort).

import { reconstructRecentRateUsage } from "@/engine/data-access/rate-limit-history";
import { seedRateLimitWindows } from "./api-key-rate-limiter";

let hydrated = false;

/**
 * Idempotent — safe to call once per process. Guards against hot-reload
 * double-running in dev.
 */
export async function hydrateRateLimitWindows(): Promise<void> {
  if (hydrated) return;

  const startedAt = Date.now();
  try {
    const byKey = await reconstructRecentRateUsage();
    let totalRequests = 0;

    for (const [apiKeyId, usage] of byKey) {
      const entries = usage.requestTs.map((ts, i) => ({
        timestamp: ts,
        tokens: usage.tokenRecords[i]?.tokens ?? 0,
      }));
      seedRateLimitWindows(apiKeyId, entries);
      totalRequests += entries.length;
    }

    hydrated = true;
    console.log(
      `[rate-limit] hydrated ${byKey.size} key(s) from ${totalRequests} ` +
        `durable success request(s) in ${Date.now() - startedAt}ms`
    );
  } catch (err) {
    console.error("[rate-limit] hydration failed (windows left empty):", err);
  }
}
