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
  checkAndRecoverExpiredCooldowns,
} from "./health-engine";
import { createRequestLog } from "./data-access/request-logs";
import {
  waitForApiKeyRateLimit,
  settleApiKeyRateLimit,
  ApiKeyRateLimitReservation,
} from "./rate-limit/api-key-rate-limiter";
import { estimateTokensForRateLimit } from "./rate-limit/token-estimator";
import { normalizeCanonicalResponse } from "./response-normalizer";
import {
  orderCandidates,
  RouteCandidate,
} from "./routing/selector";
import {
  orderByStrategy,
  isSimpleStrategy,
} from "./routing/strategies";
import {
  getConversationState,
  setConversationKey,
  setPendingInjection,
} from "./routing/conversation";

// ─── Types ──────────────────────────────────────────────

export type CandidateKey = RouteCandidate;

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
  cacheAware: boolean;
  stickyContextTokenBudget: number;
  members: CandidateMember[];
  /** Override the `poolId` written to RequestLog rows. The gateway always sets
   *  this to a real pool id. Ad-hoc single-model calls (e.g. the admin Chat
   *  page) that build a synthetic pool pass `null` so usage is still recorded
   *  without violating the Pool FK. */
  logPoolId?: string | null;
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

function isRoutableStatus(status: string): boolean {
  return status !== "DISABLED" && status !== "SUSPENDED" && status !== "TESTING" && status !== "COOLDOWN";
}

/**
 * Build the full candidate list from a pool. Keys come from the pool's
 * own `apiKeys` (already filtered by provider in the gateway route).
 */
function buildCandidates(pool: ResolvedPool): Candidate[] {
  const allCandidates: Candidate[] = [];
  for (const member of pool.members) {
    for (const key of member.keys) {
      if (!isRoutableStatus(key.status)) continue;
      allCandidates.push({ key, member });
    }
  }
  return allCandidates;
}

// ─── Main Orchestrator ──────────────────────────────────

export async function orchestrate(
  canonicalRequest: CanonicalRequest,
  resolvedPool: ResolvedPool
): Promise<OrchestratorResult> {
  // Recover any expired penalties and cooldowns first
  await checkAndRecoverExpiredPenalties();
  await checkAndRecoverExpiredCooldowns();

  // Synthetic pools (admin Chat) may not correspond to a real Pool row; use
  // their override so RequestLog.poolId stays null (usage still aggregates).
  const logPoolId = resolvedPool.logPoolId !== undefined ? resolvedPool.logPoolId : resolvedPool.id;

  const allCandidates = buildCandidates(resolvedPool);
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

  // ── Candidate ordering ────────────────────────────────
  // Honor the pool's routing strategy:
  //   ROUND_ROBIN / PRIORITY — simple deterministic ordering (strategies.ts).
  //   KEY_AWARE (default)    — caching-aware selector using conversation
  //                            affinity + live rate-limiter usage (selector.ts).
  const conv = getConversationState(resolvedPool.id);
  const spec = {
    promptTokens: estimateTokensForRateLimit(canonicalRequest),
    completionBudget: canonicalRequest.max_tokens ?? 1024,
  };

  let orderedCandidates: Candidate[];
  if (isSimpleStrategy(resolvedPool.routingStrategy)) {
    const ordered = orderByStrategy(
      allCandidates.map((c) => ({
        key: c.key,
        memberPriority: c.member.priority,
      })),
      resolvedPool.routingStrategy as "ROUND_ROBIN" | "PRIORITY"
    );
    const memberById = new Map(allCandidates.map((c) => [c.key.apiKeyId, c.member]));
    orderedCandidates = ordered
      .filter((o) => memberById.has(o.key.apiKeyId))
      .map((o) => ({ key: o.key, member: memberById.get(o.key.apiKeyId)! }));
  } else {
    const { ordered } = orderCandidates(
      allCandidates.map((c) => c.key),
      spec,
      resolvedPool.cacheAware ? conv.currentKeyId : null,
      resolvedPool.cacheAware ? conv.lastPromptTokens : 0,
      {
        stickyBudgetTokens: resolvedPool.stickyContextTokenBudget ?? 0,
        allowPenalized: true,
        cacheAware: resolvedPool.cacheAware,
      }
    );

    // Preserve the member mapping for the ordered candidates.
    const memberById = new Map(allCandidates.map((c) => [c.key.apiKeyId, c.member]));
    orderedCandidates = ordered
      .filter((o) => memberById.has(o.candidate.apiKeyId))
      .map((o) => ({ key: o.candidate, member: memberById.get(o.candidate.apiKeyId)! }));
  }

  if (orderedCandidates.length === 0) {
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
          message: "No candidate key can serve this request (limits/context).",
        },
      ],
    };
  }

  const prevKeyId = conv.currentKeyId;
  const lastPromptBefore = conv.lastPromptTokens;

  for (const candidate of orderedCandidates) {
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
        requestTs: 0,
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

      // Resolve the plaintext key (local) with legacy-decrypt fallback.
      const decryptedKey =
        key.secret || (key.secretEncrypted ? decrypt(key.secretEncrypted) : "");

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
          poolId: logPoolId,
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

      // ── Conversation affinity (cache stickiness) ─────
      // Remember this key as the conversation's current key so the next
      // request for this pool prefers it (provider prompt-cache discount).
      if (resolvedPool.cacheAware) {
        setConversationKey(resolvedPool.id, key.apiKeyId, spec.promptTokens);
      }
      // If we rotated away from a previous key, the chat context is now
      // uncached on the new key — ask the user (Copilot injection) whether
      // to switch directly or compact the chat (design doc 06 §5).
      if (prevKeyId && prevKeyId !== key.apiKeyId) {
        setPendingInjection(resolvedPool.id, {
          keyLabel: key.apiKeyLabel,
          limitName: "TPD",
          nextKeyLabel: null,
          promptTokens: spec.promptTokens,
          lastPromptTokens: lastPromptBefore,
        });
      }

      if (canonicalRequest.stream) {
        // Return stream as async generator
        const streamGen = streamResponse(response, adapter, {
          poolId: logPoolId,
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
          poolId: logPoolId,
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
        poolId: logPoolId,
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
    poolId: string | null;
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
  let sawTerminal = false;
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
          if (delta.choices.some((c) => c.finish_reason != null)) {
            sawTerminal = true;
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
          if (delta.choices.some((c) => c.finish_reason != null)) {
            sawTerminal = true;
          }
          deltaCount++;
          if (delta.usage) {
            streamUsage.promptTokens = delta.usage.prompt_tokens ?? streamUsage.promptTokens;
            streamUsage.completionTokens = delta.usage.completion_tokens ?? streamUsage.completionTokens;
          }
          yield delta;
        }
      }
    }

    // Guarantee a terminal finish_reason chunk even if the upstream provider
    // ended with just `data: [DONE]` and never emitted an explicit stop reason.
    if (!sawTerminal) {
      console.error(
        `[stream] provider never emitted finish_reason — injecting synthetic terminal for key=${meta.apiKeyId.slice(0, 8)}`
      );
      yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
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
