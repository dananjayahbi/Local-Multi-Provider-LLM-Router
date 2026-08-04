// ─── Failover Orchestrator ──────────────────────────────
// Central routing engine: builds candidate list from
// pool members, iterates through Tier 1→Tier 2 until
// success or exhaustion (§5, §9 of architecture plan).

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalDelta,
} from "./canonical";
import { getAdapter } from "./adapters";
import { classifyError, ErrorClassification } from "./error-classifier";
import {
  applyFailure,
  resetKeyHealth,
  checkAndRecoverExpiredPenalties,
} from "./health-engine";
import { createRequestLog } from "./data-access/request-logs";
import {
  waitForApiKeyRateLimit,
  settleApiKeyRateLimit,
  ApiKeyRateLimitReservation,
} from "./rate-limit/api-key-rate-limiter";
import { estimateTokensForRateLimit } from "./rate-limit/token-estimator";
import { normalizeCanonicalResponse } from "./response-normalizer";

// ─── Types ──────────────────────────────────────────────

interface CandidateKey {
  apiKeyId: string;
  apiKeyLabel: string;
  secretEncrypted: string;
  status: string;
  penaltyLevel: number;
  penaltyExpiresAt: Date | null;
  lastUsedAt: Date | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
}

interface CandidateMember {
  memberId: string;
  priority: number;
  providerModelId: string;
  providerModelName: string;
  displayName: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiFormat: string;
  keys: CandidateKey[];
}

export interface ResolvedPool {
  id: string;
  name: string;
  routingStrategy: string;
  members: CandidateMember[];
}

export interface AttemptError {
  apiKeyId: string;
  apiKeyLabel: string;
  providerName: string;
  modelName: string;
  classification: ErrorClassification;
  httpStatus: number;
  message: string;
}

export interface OrchestratorResult {
  success: boolean;
  canonicalResponse?: CanonicalResponse;
  streamGenerator?: AsyncGenerator<CanonicalDelta>;
  errors: AttemptError[];
}

// ─── Candidate List Builder ────────────────────────────

interface Candidate {
  key: CandidateKey;
  member: CandidateMember;
}

function buildCandidates(pool: ResolvedPool): { tier1: Candidate[]; tier2: Candidate[] } {

  const allCandidates: Candidate[] = [];

  for (const member of pool.members) {
    for (const key of member.keys) {
      if (key.status === "DISABLED" || key.status === "SUSPENDED") continue;
      allCandidates.push({ key, member });
    }
  }

  const tier1 = allCandidates.filter((c) => c.key.status === "ACTIVE");
  const tier2 = allCandidates.filter((c) => c.key.status === "PENALIZED");

  // Order Tier 1 by strategy
  if (pool.routingStrategy === "PRIORITY") {
    tier1.sort((a, b) => {
      if (a.member.priority !== b.member.priority) return a.member.priority - b.member.priority;
      return (a.key.lastUsedAt?.getTime() ?? 0) - (b.key.lastUsedAt?.getTime() ?? 0);
    });
  } else {
    // ROUND_ROBIN: least-recently-used first
    tier1.sort((a, b) => (a.key.lastUsedAt?.getTime() ?? 0) - (b.key.lastUsedAt?.getTime() ?? 0));
  }

  // Order Tier 2 by penaltyExpiresAt ascending
  tier2.sort(
    (a, b) =>
      (a.key.penaltyExpiresAt?.getTime() ?? Infinity) -
      (b.key.penaltyExpiresAt?.getTime() ?? Infinity)
  );

  return { tier1, tier2 };
}

// ─── Main Orchestrator ──────────────────────────────────

export async function orchestrate(
  canonicalRequest: CanonicalRequest,
  resolvedPool: ResolvedPool
): Promise<OrchestratorResult> {
  // Recover any expired penalties first
  await checkAndRecoverExpiredPenalties();

  const { tier1, tier2 } = buildCandidates(resolvedPool);
  const allCandidates = [...tier1, ...tier2];
  const errors: AttemptError[] = [];

  if (allCandidates.length === 0) {
    return {
      success: false,
      errors: [
        {
          apiKeyId: "",
          apiKeyLabel: "",
          providerName: "",
          modelName: "",
          classification: "UNKNOWN",
          httpStatus: 0,
          message: "No eligible keys found in pool. All keys may be disabled or suspended.",
        },
      ],
    };
  }

  for (const candidate of allCandidates) {
    const { key, member } = candidate;
    const tierLabel = key.status === "PENALIZED" ? "TIER_2" : "TIER_1";
    const startTime = Date.now();

    try {
      // Rate-limit queue: wait until this key has RPM/TPM capacity
      const estimatedTokens = estimateTokensForRateLimit(canonicalRequest);
      let reservation: ApiKeyRateLimitReservation = {
        apiKeyId: key.apiKeyId,
        reservationId: "",
        reservedTokens: estimatedTokens,
        hasTpmLimit: false,
      };

      const hasLimits = Boolean(
        (key.rpmLimit && key.rpmLimit > 0) || (key.tpmLimit && key.tpmLimit > 0)
      );

      if (hasLimits) {
        reservation = await waitForApiKeyRateLimit({
          apiKeyId: key.apiKeyId,
          rpmLimit: key.rpmLimit,
          tpmLimit: key.tpmLimit,
          requestedTokens: estimatedTokens,
        });
      }

      // Decrypt the key
      const decryptedKey = decrypt(key.secretEncrypted);

      // Get adapter and build request
      const adapter = getAdapter(member.apiFormat);
      const { url, headers, body } = adapter.buildRequest(
        canonicalRequest,
        decryptedKey,
        member.baseUrl,
        member.providerModelName
      );

      // Make the request
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(300_000), // 5 min timeout
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text();
        const parsed = adapter.parseError(errorBody, response.status);
        const classified = classifyError(
          response.status,
          parsed.providerErrorCode,
          parsed.providerErrorMessage,
          member.apiFormat
        );

        // Apply health action
        await applyFailure({
          apiKeyId: key.apiKeyId,
          errorClassification: classified.classification,
        });

        // Log failure
        await createRequestLog({
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          providerModelId: member.providerModelId,
          tier: tierLabel,
          outcome: "FAILURE",
          errorClassification: classified.classification,
          httpStatus: response.status,
          latencyMs,
          requestedVirtualModel: canonicalRequest.model,
        });

        errors.push({
          apiKeyId: key.apiKeyId,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          modelName: member.displayName,
          classification: classified.classification,
          httpStatus: response.status,
          message: classified.providerErrorMessage,
        });

        // Don't retry invalid requests
        if (classified.classification === "INVALID_REQUEST") {
          return { success: false, errors };
        }

        continue;
      }

      // Success!
      await resetKeyHealth(key.apiKeyId);

      if (canonicalRequest.stream) {
        // Return stream as async generator
        const streamGen = streamResponse(response, adapter, {
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          providerModelId: member.providerModelId,
          tier: tierLabel,
          virtualModel: canonicalRequest.model,
          startTime,
          httpStatus: response.status,
          reservation,
        });

        return { success: true, streamGenerator: streamGen, errors };
      } else {
        const responseBody = await response.text();
        let canonicalResponse = adapter.parseResponse(responseBody, response.status);
        canonicalResponse = normalizeCanonicalResponse(canonicalResponse);

        // Settle tpm reservation with actual usage
        await settleApiKeyRateLimit(reservation, canonicalResponse.usage?.total_tokens ?? null);

        // Log success
        await createRequestLog({
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          providerModelId: member.providerModelId,
          tier: tierLabel,
          outcome: "SUCCESS",
          httpStatus: response.status,
          latencyMs,
          promptTokens: canonicalResponse.usage?.prompt_tokens ?? null,
          completionTokens: canonicalResponse.usage?.completion_tokens ?? null,
          requestedVirtualModel: canonicalRequest.model,
        });

        return { success: true, canonicalResponse, errors };
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error &&
          (err.message.includes("fetch") ||
            err.message.includes("ECONN") ||
            err.message.includes("ENOTFOUND") ||
            err.message.includes("timeout") ||
            err.name === "AbortError"));

      const classification = isNetworkError ? "NETWORK_ERROR" : "UNKNOWN";
      const message = err instanceof Error ? err.message : String(err);

      // Apply health action for network errors
      if (classification !== "UNKNOWN") {
        await applyFailure({
          apiKeyId: key.apiKeyId,
          errorClassification: classification,
        });
      }

      // Log failure
      await createRequestLog({
        poolId: resolvedPool.id,
        apiKeyId: key.apiKeyId,
        providerModelId: member.providerModelId,
        tier: tierLabel,
        outcome: "FAILURE",
        errorClassification: classification,
        httpStatus: 0,
        latencyMs,
        requestedVirtualModel: canonicalRequest.model,
      });

      errors.push({
        apiKeyId: key.apiKeyId,
        apiKeyLabel: key.apiKeyLabel,
        providerName: member.providerName,
        modelName: member.displayName,
        classification,
        httpStatus: 0,
        message,
      });

      continue;
    }
  }

  // All candidates exhausted
  return { success: false, errors };
}

// ─── Streaming Helper ───────────────────────────────────

async function* streamResponse(
  response: Response,
  adapter: ReturnType<typeof getAdapter>,
  meta: {
    poolId: string;
    apiKeyId: string;
    providerModelId: string;
    tier: string;
    virtualModel: string;
    startTime: number;
    httpStatus: number;
    reservation: ApiKeyRateLimitReservation;
  }
): AsyncGenerator<CanonicalDelta> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let deltaCount = 0;
  let skippedEmptyChoices = 0;
  let rawBytes: string[] = [];
  let emittedBytes: string[] = [];
  const streamUsage: { promptTokens?: number; completionTokens?: number } = {};

  console.error(`[stream] starting stream for key=${meta.apiKeyId.slice(0, 8)} model=${meta.virtualModel}`);

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
        if (delta) {
          // Check for empty choices at stream level
          if (!delta.choices || delta.choices.length === 0) {
            skippedEmptyChoices++;
            continue;
          }
          deltaCount++;
          // Capture usage from stream chunks (last chunk often has usage)
          if (delta.usage) {
            streamUsage.promptTokens = delta.usage.prompt_tokens ?? streamUsage.promptTokens;
            streamUsage.completionTokens = delta.usage.completion_tokens ?? streamUsage.completionTokens;
          }
          yield delta;
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const delta = adapter.parseStreamChunk(buffer);
      if (delta) {
        if (!delta.choices || delta.choices.length === 0) {
          skippedEmptyChoices++;
        } else {
          deltaCount++;
          if (delta.usage) {
            streamUsage.promptTokens = delta.usage.prompt_tokens ?? streamUsage.promptTokens;
            streamUsage.completionTokens = delta.usage.completion_tokens ?? streamUsage.completionTokens;
          }
          yield delta;
        }
      }
    }

    console.error(`[stream] done: deltas=${deltaCount} skipped_empty=${skippedEmptyChoices} key=${meta.apiKeyId.slice(0, 8)}`);
  } finally {
    reader.releaseLock();

    // Settle tpm reservation with actual usage from stream
    const actualTotal =
      streamUsage.promptTokens && streamUsage.completionTokens
        ? streamUsage.promptTokens + streamUsage.completionTokens
        : null;
    await settleApiKeyRateLimit(meta.reservation, actualTotal);

    // Log success after stream completes
    await createRequestLog({
      poolId: meta.poolId,
      apiKeyId: meta.apiKeyId,
      providerModelId: meta.providerModelId,
      tier: meta.tier,
      outcome: "SUCCESS",
      httpStatus: meta.httpStatus,
      latencyMs: Date.now() - meta.startTime,
      promptTokens: streamUsage.promptTokens ?? null,
      completionTokens: streamUsage.completionTokens ?? null,
      requestedVirtualModel: meta.virtualModel,
    });
  }
}
