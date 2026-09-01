// ─── Baseline Calibration & Drift Calculation ──────────
// Implements the latency drift ratio formulas from the
// architecture spec (§3.3).

import { prisma } from "@/lib/prisma";
import { getBenchmarkConfig } from "./config";

export interface BaselineMetrics {
  ttftMs: number;
  avgTps: number;
}

export interface DriftResult {
  ttftDriftRatio: number;
  tpsDriftRatio: number;
  isThrottled: boolean;
}

/**
 * Retrieves the baseline metrics from the most recent
 * successful benchmark of the configured baseline model.
 */
export async function getBaselineMetrics(): Promise<BaselineMetrics | null> {
  const config = await getBenchmarkConfig();
  if (!config.baselineProviderModelId) return null;

  // Find the baseline provider model's keys
  const model = await prisma.providerModel.findUnique({
    where: { id: config.baselineProviderModelId },
    include: { provider: { include: { apiKeys: { select: { id: true } } } } },
  });
  if (!model) return null;

  const keyIds = model.provider.apiKeys.map((k) => k.id);

  const latest = await prisma.apiKeyBenchmark.findFirst({
    where: {
      apiKeyId: { in: keyIds },
      passed: true,
    },
    orderBy: { testedAt: "desc" },
  });

  if (!latest) return null;

  return { ttftMs: latest.ttftMs, avgTps: latest.avgTps };
}

/**
 * Calculates the latency drift ratios and throttling decision
 * for an observed benchmark against the baseline.
 *
 *   δ_TTFT = T_FT_observed / T_FT_baseline
 *   δ_TPS  = TPS_baseline / TPS_observed
 *
 * IsThrottled = δ_TTFT > θ_TTFT_max OR δ_TPS > θ_TPS_max
 */
export async function calculateDrift(
  observed: BaselineMetrics
): Promise<DriftResult> {
  const config = await getBenchmarkConfig();
  const baseline = await getBaselineMetrics();

  // If no baseline is configured, default to not throttled
  if (!baseline || baseline.ttftMs <= 0 || baseline.avgTps <= 0) {
    return { ttftDriftRatio: 1, tpsDriftRatio: 1, isThrottled: false };
  }

  const ttftDriftRatio = observed.ttftMs / baseline.ttftMs;
  const tpsDriftRatio = baseline.avgTps / Math.max(observed.avgTps, 0.001);

  const isThrottled =
    ttftDriftRatio > config.ttftDriftThreshold ||
    tpsDriftRatio > config.tpsDriftThreshold;

  return { ttftDriftRatio, tpsDriftRatio, isThrottled };
}
