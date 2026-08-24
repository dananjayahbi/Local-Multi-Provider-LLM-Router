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
import {
  handleAutoCalibrationSuccess,
  handleAutoCalibrationFailure,
} from "./benchmark/auto-calibration";
import { createRequestLog } from "./data-access/request-logs";
import {
  waitForApiKeyRateLimit,
  settleApiKeyRateLimit,
  releaseApiKeyRateLimit,
  ApiKeyRateLimitReservation,
} from "./rate-limit/api-key-rate-limiter";
import { recordFlowEvent } from "./rate-limit/flow-tracker";
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
import {
  withoutTools,
} from "./routing/empty-completion";
import {
  EXHAUSTED_POOL_MESSAGE,
  NO_HEALTHY_KEY_CLASSIFICATION,
} from "./routing/exhausted-pool";
import {
  getPoolRecoveryInfo,
  waitForPoolRecovery,
  readPoolKeyStatuses,
  recoveryWaitMaxMs,
} from "./routing/pool-recovery";

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
  /** Whether this model reliably handles a `tools` array. When false the
   *  orchestrator strips tools before building the request (fixes models that
   *  return empty completions for tool calls). Defaults to true. */
  reliableToolCalls?: boolean;
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
  /** Error taxonomy, or a synthetic label like NO_HEALTHY_KEY for exhausted pools. */
  classification: string;
  httpStatus: number;
  message: string;
}

export interface OrchestratorResult {
  success: boolean;
  canonicalResponse?: CanonicalResponse;
  streamGenerator?: AsyncGenerator<CanonicalDelta>;
  errors: AttemptError[];
  /**
   * True when the pool could NOT serve the request because no routable/healthy
   * key remained (all PENALIZED/SUSPENDED/DISABLED, or excluded by routing
   * limits). Callers MUST NOT surface this as a hard error — they should return
   * a pre-defined assistant completion so the agent stops instead of retrying.
   */
  exhaustedPool?: boolean;
}

// ─── Candidate List Builder ────────────────────────────

interface Candidate {
  key: CandidateKey;
  member: CandidateMember;
}

// Only ACTIVE keys are routable. PENALIZED keys are in cooldown — they must
// NOT be used until `checkAndRecoverExpiredPenalties()` restores them. Routing
// to a penalized key (e.g. via `allowPenalized`) caused the Lv.3-penalty bug
// where a penalized key in a single-key pool kept serving requests and
// escalated its penalty forever.
function isRoutableStatus(status: string): boolean {
  return status === "ACTIVE";
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

/**
 * Refresh the `status` of every key in an already-resolved pool after a
 * `waitForPoolRecovery()` succeeded. The keys in `resolvedPool.members[].keys`
 * are plain objects copied at resolve time, so a recovered key must have its
 * in-memory status updated before candidates are re-built or the routing loop
 * will still skip it as non-routable.
 */
async function refreshResolvedPoolStatuses(pool: ResolvedPool): Promise<void> {
  const statuses = await readPoolKeyStatuses(pool.id);
  for (const member of pool.members) {
    for (const key of member.keys) {
      const fresh = statuses.get(key.apiKeyId);
      if (fresh) key.status = fresh;
    }
  }
}

// ─── Main Orchestrator ──────────────────────────────────

export interface OrchestrateOptions {
  /**
   * Correlates all flow events for ONE inbound gateway request. Passed through
   * on a recovery-retry so the /usage animation keeps the request (and its
   * queued→assigned→success chain) under a single id instead of splitting it.
   */
  requestId?: string;
  /** Prior per-attempt errors accumulated before a recovery-retry. */
  priorErrors?: AttemptError[];
  /**
   * Absolute deadline (epoch ms) for the WHOLE recovery-retry budget. Set on
   * the first attempt; the recursive retry carries it forward so that if a key
   * keeps getting re-penalized we never wait longer than the route budget.
   */
  deadline?: number;
}

export async function orchestrate(
  canonicalRequest: CanonicalRequest,
  resolvedPool: ResolvedPool,
  opts: OrchestrateOptions = {}
): Promise<OrchestratorResult> {
  // Recover any expired penalties and cooldowns first
  await checkAndRecoverExpiredPenalties();
  await checkAndRecoverExpiredCooldowns();

  // Synthetic pools (admin Chat) may not correspond to a real Pool row; use
  // their override so RequestLog.poolId stays null (usage still aggregates).
  const logPoolId = resolvedPool.logPoolId !== undefined ? resolvedPool.logPoolId : resolvedPool.id;

  const allCandidates = buildCandidates(resolvedPool);
  const errors: AttemptError[] = opts.priorErrors ?? [];
  const requestId = opts.requestId ?? crypto.randomUUID();
  const isFirstAttempt = opts.requestId === undefined;
  // Establish a single recovery budget for the request. If the caller didn't
  // pass one (first attempt), derive it from the configured max wait now.
  const recoveryDeadline = opts.deadline ?? Date.now() + recoveryWaitMaxMs();

  // ── Pool recovery introspection ──────────────────────
  // Look at ALL keys in the pool, not just routable ones, to decide whether
  // this pool can recover on its own (a PENALIZED/COOLDOWN key with a future
  // penaltyExpiresAt will be flipped back to ACTIVE by the health engine). If
  // so, entering an exhausted state below will WAIT for a key to recover and
  // retry, instead of immediately telling the agent to stop.
  const recoveryInfo = getPoolRecoveryInfo(
    resolvedPool.members.flatMap((m) =>
      m.keys.map((k) => ({ status: k.status, penaltyExpiresAt: k.penaltyExpiresAt }))
    )
  );

  // Correlate every pipeline transition for this inbound gateway request so
  // the /usage data-flow illustration can render one request as it moves
  // arrived → queued → assigned → success/failed. Only emit "arrived" on the
  // FIRST attempt; a recovery-retry resumes the SAME request chain.
  if (isFirstAttempt) {
    recordFlowEvent({
      requestId,
      poolId: resolvedPool.id,
      apiKeyId: null,
      poolName: resolvedPool.name,
      apiKeyLabel: null,
      providerName: null,
      stage: "arrived",
    });
  }

  if (allCandidates.length === 0) {
    // No routable/healthy key remains. Normally this is NOT a hard failure and
    // the caller returns a pre-defined "pool exhausted" completion so the agent
    // stops instead of retrying forever. HOWEVER — if this pool can recover on
    // its own (a PENALIZED/COOLDOWN key whose penaltyExpiresAt is in the
    // future), we instead WAIT for a key to recover and retry the request, so
    // an autonomous client never sees an error; it just waits and gets the
    // answer once a key is healthy again.
    if (recoveryInfo.recoverable && !recoveryInfo.hasActive) {
      // Announce that we're holding the request for pool recovery.
      recordFlowEvent({
        requestId,
        poolId: resolvedPool.id,
        apiKeyId: null,
        poolName: resolvedPool.name,
        apiKeyLabel: null,
        providerName: null,
        stage: "queued",
      });
      console.error(
        `[orchestrator] pool=${resolvedPool.name} has no ACTIVE key — waiting for ` +
          `recovery (earliest=${recoveryInfo.earliestRecoveryAt ? new Date(recoveryInfo.earliestRecoveryAt).toISOString() : "unknown"})`
      );

      const recovered = await waitForPoolRecovery(resolvedPool.id, recoveryDeadline);
      if (recovered) {
        // A key became ACTIVE again. Refresh the in-memory statuses and retry
        // the routing loop from the top with the fresh candidate set, keeping
        // the same requestId, accumulated errors, and shared recovery deadline
        // so a key that re-penalizes can't extend the wait indefinitely.
        await refreshResolvedPoolStatuses(resolvedPool);
        return orchestrate(canonicalRequest, resolvedPool, {
          requestId,
          priorErrors: errors,
          deadline: recoveryDeadline,
        });
      }
      // Timed out — fall through to the exhausted-pool response.
    }

    // Exhausted (either not recoverable, or the recovery wait timed out).
    await createRequestLog({
      poolId: logPoolId,
      apiKeyId: null,
      providerModelId: null,
      tier: null,
      outcome: "FAILURE",
      errorClassification: NO_HEALTHY_KEY_CLASSIFICATION,
      httpStatus: 0,
      latencyMs: 0,
      requestedVirtualModel: canonicalRequest.model,
      providerErrorMessage: null,
      providerErrorCode: null,
      gatewayErrorMessage: EXHAUSTED_POOL_MESSAGE,
    });

    return {
      success: false,
      exhaustedPool: true,
      errors: [
        {
          apiKeyId: "",
          apiKeyLabel: "",
          providerName: "",
          modelName: "",
          classification: NO_HEALTHY_KEY_CLASSIFICATION,
          httpStatus: 0,
          message: EXHAUSTED_POOL_MESSAGE,
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
        allowPenalized: false,
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
    // Every otherwise-healthy key was excluded by the routing selector
    // (limits/context fit). Treat as exhausted so the caller returns a
    // pre-defined completion instead of a hard error.
    await createRequestLog({
      poolId: logPoolId,
      apiKeyId: null,
      providerModelId: null,
      tier: null,
      outcome: "FAILURE",
      errorClassification: NO_HEALTHY_KEY_CLASSIFICATION,
      httpStatus: 0,
      latencyMs: 0,
      requestedVirtualModel: canonicalRequest.model,
      providerErrorMessage: null,
      providerErrorCode: null,
      gatewayErrorMessage: EXHAUSTED_POOL_MESSAGE,
    });

    return {
      success: false,
      exhaustedPool: true,
      errors: [
        {
          apiKeyId: "",
          apiKeyLabel: "",
          providerName: "",
          modelName: "",
          classification: NO_HEALTHY_KEY_CLASSIFICATION,
          httpStatus: 0,
          message: EXHAUSTED_POOL_MESSAGE,
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

    // Declared OUTSIDE the try so the catch can release it on failure. If the
    // key has no limits this stays a no-op reservation (empty id → no-op).
    let reservation: ApiKeyRateLimitReservation = {
      apiKeyId: key.apiKeyId,
      reservationId: "",
      reservedTokens: 0,
      hasTpmLimit: false,
      requestTs: 0,
    };

    try {
      // Rate-limit queue: wait until this key has RPM/TPM capacity
      const estimatedTokens = estimateTokensForRateLimit(canonicalRequest);
      reservation = {
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
        // The request is HELD in the gateway waiting for this key's rate-limit
        // window to free up. Mark it queued (this is the "holding" signal).
        recordFlowEvent({
          requestId,
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          poolName: resolvedPool.name,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          stage: "queued",
        });

        reservation = await waitForApiKeyRateLimit({
          apiKeyId: key.apiKeyId,
          rpmLimit: key.rpmLimit,
          tpmLimit: key.tpmLimit,
          requestedTokens: estimatedTokens,
        });

        // Capacity granted — the upstream call is now in flight.
        recordFlowEvent({
          requestId,
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          poolName: resolvedPool.name,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          stage: "assigned",
          tokens: estimatedTokens,
        });
      } else {
        // No limits — nothing is held locally; the call goes straight out.
        recordFlowEvent({
          requestId,
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          poolName: resolvedPool.name,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          stage: "assigned",
          tokens: estimatedTokens,
        });
      }

      // Resolve the plaintext key (local) with legacy-decrypt fallback.
      const decryptedKey =
        key.secret || (key.secretEncrypted ? decrypt(key.secretEncrypted) : "");

      // Get adapter and build request. Some free reasoning models (Oracle's
      // stealth/ox-alpha etc.) return an EMPTY completion when `tools` is sent
      // as an array, so we strip tools for models flagged `reliableToolCalls:
      // false`. This is the proactive fix (no wasted round-trip).
      const adapter = getAdapter(member.apiFormat);
      const requestForModel = member.reliableToolCalls === false ? withoutTools(canonicalRequest) : canonicalRequest;
      const { url, headers, body } = adapter.buildRequest(
        requestForModel,
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

        // Apply health action (pass the raw provider message/code so the
        // penalty engine can detect WHICH limit was hit — RPM/TPM/RPD/TPD).
        await applyFailure({
          apiKeyId: key.apiKeyId,
          errorClassification: classified.classification,
          providerErrorMessage: classified.providerErrorMessage,
          providerErrorCode: classified.providerErrorCode,
        });

        // Auto-calibration: scale this key's limits down on a throttle hit so
        // it stops tripping penalties and finds the real sustainable ceiling.
        if (classified.classification === "RATE_LIMITED") {
          const newLimits = await handleAutoCalibrationFailure(
            key.apiKeyId,
            classified.classification,
            classified.providerErrorMessage
          );
          if (newLimits) {
            console.error(
              `[auto-cal] key=${key.apiKeyId.slice(0, 8)} rate-limited, scaled limits down → ` +
                `rpm=${newLimits.rpmLimit ?? "∞"} tpm=${newLimits.tpmLimit ?? "∞"}`
            );
          }
        }

        // Log failure — capture both sides of the error so /logs can expand:
        // what the PROVIDER returned and what the GATEWAY surfaced to the client.
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
          providerErrorMessage: classified.providerErrorMessage,
          providerErrorCode: classified.providerErrorCode,
          gatewayErrorMessage: classified.providerErrorMessage,
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

        // The upstream rejected the request, so the reservation we took did
        // NOT consume real provider capacity. Release it so the local counter
        // doesn't inflate and cause unnecessary throttling. (The penalty + 
        // auto-calibration engines already decide how to treat this key.)
        await releaseApiKeyRateLimit(reservation);

        recordFlowEvent({
          requestId,
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          poolName: resolvedPool.name,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          stage: "failed",
          latencyMs,
        });

        // Don't retry invalid requests
        if (classified.classification === "INVALID_REQUEST") {
          return { success: false, errors };
        }

        continue;
      }

      // Success!
      await resetKeyHealth(key.apiKeyId);

      // Auto-calibration: a success advances the streak; at the threshold we
      // cautiously probe limits up toward the user's baseline ceiling.
      await handleAutoCalibrationSuccess(key.apiKeyId);

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
        // Return stream as async generator. The streamResponse finally block
        // emits the terminal success/failed flow event AFTER the stream ends so
        // the animation keeps the request in-flight for the whole stream.
        const streamGen = streamResponse(response, adapter, {
          poolId: logPoolId,
          apiKeyId: key.apiKeyId,
          providerModelId: member.providerModelId,
          tier: tierLabel,
          virtualModel: canonicalRequest.model,
          startTime,
          httpStatus: response.status,
          reservation,
          flowMeta: {
            requestId,
            poolId: resolvedPool.id,
            poolName: resolvedPool.name,
            apiKeyLabel: key.apiKeyLabel,
            providerName: member.providerName,
          },
        });

        return { success: true, streamGenerator: streamGen, errors };
      } else {
        const responseBody = await response.text();
        let canonicalResponse = adapter.parseResponse(responseBody, response.status);
        canonicalResponse = normalizeCanonicalResponse(canonicalResponse);

        // Settle tpm reservation with actual usage
        await settleApiKeyRateLimit(reservation, canonicalResponse.usage?.total_tokens ?? null);

        // Request completed — clear it from the active set in the animation.
        recordFlowEvent({
          requestId,
          poolId: resolvedPool.id,
          apiKeyId: key.apiKeyId,
          poolName: resolvedPool.name,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          stage: "success",
          latencyMs,
        });

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
          providerErrorMessage: message,
          providerErrorCode: null,
        });
      }

      // Log failure — capture the network/provider message so /logs can expand.
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
        providerErrorMessage: message,
        providerErrorCode: isNetworkError ? "NETWORK" : null,
        gatewayErrorMessage: message,
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

      // Network/unknown errors never consumed provider capacity — release the
      // reservation so the local RPM/TPM counter isn't inflated.
      await releaseApiKeyRateLimit(reservation);

      recordFlowEvent({
        requestId,
        poolId: resolvedPool.id,
        apiKeyId: key.apiKeyId,
        poolName: resolvedPool.name,
        apiKeyLabel: key.apiKeyLabel,
        providerName: member.providerName,
        stage: "failed",
        latencyMs,
      });

      continue;
    }
  }

  // All candidates exhausted: every routable key was attempted and failed in
  // this call. Each per-attempt failure was already logged. Mark the pool as
  // exhausted so the caller returns a pre-defined completion instead of a hard
  // error (autonomous agents must stop, not retry forever).
  return { success: false, exhaustedPool: true, errors };
}

// ─── Streaming Helper ───────────────────────────────────

/** Whether a single delta choice carries usable content, reasoning, or tools. */
function hasUsableDelta(choice: CanonicalDelta["choices"][0]): boolean {
  const d = choice.delta ?? {};
  const raw = d as Record<string, unknown>;
  if (typeof d.content === "string" && d.content.length > 0) return true;
  if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return true;
  if (typeof raw.reasoning === "string" && raw.reasoning.length > 0) return true;
  if (typeof raw.reasoning_content === "string" && raw.reasoning_content.length > 0) return true;
  return false;
}

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
    flowMeta: {
      requestId: string;
      poolId: string;
      poolName: string;
      apiKeyLabel: string;
      providerName: string;
    };
  }
): AsyncGenerator<CanonicalDelta> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let deltaCount = 0;
  let skippedEmptyChoices = 0;
  let sawTerminal = false;
  let producedContent = false; // any delta with usable content / reasoning / tool_calls
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
          if (delta.choices.some((c) => hasUsableDelta(c))) {
            producedContent = true;
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
          if (delta.choices.some((c) => hasUsableDelta(c))) {
            producedContent = true;
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

    // Log outcome after stream completes. If the stream produced NO usable
    // content/reasoning/tool-calls, the client (Copilot) will report "no
    // response returned" — log it as a failure so it's visible, not a false SUCCESS.
    const outcome = producedContent ? "SUCCESS" : "EMPTY_RESPONSE";
    if (!producedContent) {
      console.error(
        `[stream] EMPTY response — streamed ${deltaCount} deltas but no usable content/reasoning for key=${meta.apiKeyId.slice(0, 8)} model=${meta.virtualModel}`
      );
    }

    // Emit the terminal flow event so the animation clears this request from
    // the active set once the stream has fully drained.
    recordFlowEvent({
      requestId: meta.flowMeta.requestId,
      poolId: meta.flowMeta.poolId,
      apiKeyId: meta.apiKeyId,
      poolName: meta.flowMeta.poolName,
      apiKeyLabel: meta.flowMeta.apiKeyLabel,
      providerName: meta.flowMeta.providerName,
      stage: outcome === "SUCCESS" ? "success" : "failed",
      latencyMs: Date.now() - meta.startTime,
      tokens: actualTotal ?? undefined,
    });

    await createRequestLog({
      poolId: meta.poolId,
      apiKeyId: meta.apiKeyId,
      providerModelId: meta.providerModelId,
      tier: meta.tier,
      outcome,
      httpStatus: meta.httpStatus,
      latencyMs: Date.now() - meta.startTime,
      promptTokens: streamUsage.promptTokens ?? null,
      completionTokens: streamUsage.completionTokens ?? null,
      requestedVirtualModel: meta.virtualModel,
      // An empty response is a gateway-side condition: the provider returned
      // HTTP 200 but nothing usable. Surface it as the gateway error message.
      ...(outcome === "EMPTY_RESPONSE"
        ? { gatewayErrorMessage: "Provider finished stream with no usable content/reasoning/tool-calls." }
        : {}),
    });
  }
}
