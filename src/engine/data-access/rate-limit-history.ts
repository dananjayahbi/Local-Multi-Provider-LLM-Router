// ─── Rate-Limit History Data Access ────────────────────
// Reads DURABLE request history from `RequestLog` so the in-memory rate-limit
// sliding windows (RPM/TPM/RPD/TPD) can be re-hydrated after a PC or container
// restart. The rate limiter keeps its windows in an in-memory Map that is wiped
// on every boot; without hydration the router would forget recent usage, stop
// pre-throttling, and burst past a provider's real limit → spurious 429
// penalties.
//
// Only SUCCESS logs represent capacity that was actually consumed upstream.
// FAILURES release their reservation, so they are deliberately excluded. The
// entries are read back within a bounded lookback so a huge log table never
// loads in full.

import { prisma } from "@/lib/prisma";

export interface RateUsageReconstruction {
  apiKeyId: string;
  /** Epoch ms of a single request; one entry per API call (RPM/RPD count). */
  requestTs: number[];
  /** Token usage per request; one entry per API call (TPM/TPD volume). */
  tokenRecords: { timestamp: number; tokens: number }[];
}

/** Lookback window for hydration (default: 24h to cover the daily windows). */
export const DEFAULT_HYDRATION_LOOKBACK_MS = 24 * 3600_000;

/** Env override (seconds). */
export function hydrationLookbackMs(): number {
  const raw = Number(process.env.RATE_WINDOW_HYDRATION_LOOKBACK_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return raw * 1000;
  return DEFAULT_HYDRATION_LOOKBACK_MS;
}

/**
 * Reconstruct recent per-key usage from durable SUCCESS request logs.
 *
 * Returns a map keyed by apiKeyId with the request timestamps and token usage
 * that fall within the lookback window. This is the source of truth used to
 * seed the in-memory rate limiter on boot.
 */
export async function reconstructRecentRateUsage(): Promise<
  Map<string, RateUsageReconstruction>
> {
  const since = new Date(Date.now() - hydrationLookbackMs());

  const logs = await prisma.requestLog.findMany({
    where: {
      outcome: "SUCCESS",
      apiKeyId: { not: null },
      createdAt: { gte: since },
    },
    select: {
      apiKeyId: true,
      createdAt: true,
      promptTokens: true,
      completionTokens: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byKey = new Map<string, RateUsageReconstruction>();

  for (const log of logs) {
    if (!log.apiKeyId) continue;
    let entry = byKey.get(log.apiKeyId);
    if (!entry) {
      entry = { apiKeyId: log.apiKeyId, requestTs: [], tokenRecords: [] };
      byKey.set(log.apiKeyId, entry);
    }

    const ts = log.createdAt.getTime();
    const tokens = Math.max(1, (log.promptTokens ?? 0) + (log.completionTokens ?? 0));

    entry.requestTs.push(ts);
    entry.tokenRecords.push({ timestamp: ts, tokens });
  }

  return byKey;
}
