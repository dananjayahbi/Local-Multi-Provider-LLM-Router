// ─── Benchmark Runner ──────────────────────────────────
// Executes a single-key benchmark across the three metric
// stages (TTFT, TPS, RPM/TPM burst) with early stopping.

import { decrypt } from "@/lib/encryption";
import { getAdapter } from "../adapters";
import { CanonicalRequest } from "../canonical";
import { getBenchmarkConfig } from "./config";
import { createStreamObserver, StreamMetrics } from "./metrics";
import { calculateDrift } from "./calibration";
import {
  buildStage1Messages,
  buildStage2Messages,
  buildStage3Messages,
  buildBenchmarkTools,
} from "./prompts";
import { createBenchmark } from "../data-access/benchmarks";
import {
  setKeyTesting,
  setKeyCooldown,
  setKeyActive,
  applyFailure,
} from "../health-engine";
import { prisma } from "@/lib/prisma";

export interface BenchmarkTarget {
  apiKeyId: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiFormat: string;
  modelId: string;
  displayName: string;
  secretEncrypted: string;
}

export interface BenchmarkResult {
  apiKeyId: string;
  passed: boolean;
  ttftMs: number;
  avgTps: number;
  latencyDriftRatio: number;
  isThrottled: boolean;
  failureReason: string | null;
}

const STAGE_COOLDOWN_MS = 30_000; // 30s between metric phases

/**
 * Optional callback invoked as the benchmark progresses through
 * its stages, enabling the scheduler to surface live progress.
 */
export type BenchmarkStageCallback = (stage: string) => void;

/**
 * Runs a full benchmark on a single key.
 * Locks the key into TESTING state, runs the three stages,
 * then transitions to COOLDOWN or PENALIZED.
 */
export async function runBenchmark(
  target: BenchmarkTarget,
  onStage?: BenchmarkStageCallback
): Promise<BenchmarkResult> {
  const config = await getBenchmarkConfig();

  // Lock key into TESTING state
  await setKeyTesting(target.apiKeyId);

  try {
    const decryptedKey = decrypt(target.secretEncrypted);
    const adapter = getAdapter(target.apiFormat);

    // ─── Stage 1: TTFT & single-turn latency ─────────────
    onStage?.("TTFT");
    const stage1Request: CanonicalRequest = {
      model: target.modelId,
      messages: buildStage1Messages(),
      stream: true,
      max_tokens: 512,
    };

    const stage1Metrics = await runStreamingStage(
      adapter,
      stage1Request,
      decryptedKey,
      target.baseUrl,
      target.modelId
    );

    // Early stop: TTFT exceeds target threshold
    const ttftSlow = stage1Metrics.ttftMs > 5000; // >5s TTFT = throttled
    onStage?.("COOLDOWN");
    await sleep(STAGE_COOLDOWN_MS);

    // ─── Stage 2: TPS & multi-turn tool generation ───────
    onStage?.("TPS");
    const stage2Request: CanonicalRequest = {
      model: target.modelId,
      messages: buildStage2Messages(),
      tools: buildBenchmarkTools(),
      tool_choice: "auto",
      stream: true,
      max_tokens: 1024,
    };

    const stage2Metrics = await runStreamingStage(
      adapter,
      stage2Request,
      decryptedKey,
      target.baseUrl,
      target.modelId
    );

    // Early stop: TPS below target
    const tpsSlow = stage2Metrics.avgTps < config.targetTps;
    onStage?.("COOLDOWN");
    await sleep(STAGE_COOLDOWN_MS);

    // ─── Stage 3: RPM / TPM burst verification ───────────
    onStage?.("RPM_BURST");
    const stage3Request: CanonicalRequest = {
      model: target.modelId,
      messages: buildStage3Messages(),
      stream: false,
      max_tokens: 16,
    };

    let burstOk = true;
    try {
      const { url, headers, body } = adapter.buildRequest(
        stage3Request,
        decryptedKey,
        target.baseUrl,
        target.modelId
      );
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        burstOk = false;
      }
    } catch {
      burstOk = false;
    }

    // ─── Combine metrics & drift calculation ─────────────
    const combinedTtft = stage1Metrics.ttftMs;
    const combinedTps = stage2Metrics.avgTps;

    const drift = await calculateDrift({
      ttftMs: combinedTtft,
      avgTps: combinedTps,
    });

    const passed =
      !ttftSlow && !tpsSlow && burstOk && !drift.isThrottled;

    const failureReason = !passed
      ? [
          ttftSlow ? `TTFT too slow (${combinedTtft}ms)` : null,
          tpsSlow ? `TPS below target (${combinedTps.toFixed(1)} < ${config.targetTps})` : null,
          !burstOk ? "Burst request failed" : null,
          drift.isThrottled ? "Silent throttling detected" : null,
        ]
          .filter(Boolean)
          .join("; ")
      : null;

    // Record benchmark
    await createBenchmark({
      apiKeyId: target.apiKeyId,
      ttftMs: combinedTtft,
      avgTps: combinedTps,
      latencyDriftRatio: Math.max(drift.ttftDriftRatio, drift.tpsDriftRatio),
      isThrottled: drift.isThrottled,
      passed,
      failureReason,
    });

    // ─── State transition ────────────────────────────────
    if (drift.isThrottled) {
      // Apply minute-level penalty for silent throttling
      await applyFailure({
        apiKeyId: target.apiKeyId,
        errorClassification: "RATE_LIMITED",
      });
    } else if (passed) {
      await setKeyCooldown(target.apiKeyId, config.postTestCooldownSeconds);
    } else {
      await setKeyCooldown(target.apiKeyId, config.postTestCooldownSeconds);
    }

    return {
      apiKeyId: target.apiKeyId,
      passed,
      ttftMs: combinedTtft,
      avgTps: combinedTps,
      latencyDriftRatio: Math.max(drift.ttftDriftRatio, drift.tpsDriftRatio),
      isThrottled: drift.isThrottled,
      failureReason,
    };
  } catch (err) {
    // On unexpected error, restore key to active
    await setKeyActive(target.apiKeyId);
    const message = err instanceof Error ? err.message : String(err);
    return {
      apiKeyId: target.apiKeyId,
      passed: false,
      ttftMs: 0,
      avgTps: 0,
      latencyDriftRatio: 0,
      isThrottled: false,
      failureReason: `Benchmark error: ${message}`,
    };
  }
}

/**
 * Runs a streaming request and measures TTFT/ITL/TPS.
 */
async function runStreamingStage(
  adapter: ReturnType<typeof getAdapter>,
  request: CanonicalRequest,
  decryptedKey: string,
  baseUrl: string,
  modelId: string
): Promise<StreamMetrics> {
  const { url, headers, body } = adapter.buildRequest(
    request,
    decryptedKey,
    baseUrl,
    modelId
  );

  const sentAt = Date.now();
  const observer = createStreamObserver(sentAt);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const parsed = adapter.parseError(errorBody, response.status);
    throw new Error(`Stage request failed (${response.status}): ${parsed.providerErrorMessage}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const delta = adapter.parseStreamChunk(line);
        if (delta && delta.choices && delta.choices.length > 0) {
          const content = delta.choices[0].delta?.content;
          if (content) {
            observer.onChunk(content);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return observer.finalize();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
