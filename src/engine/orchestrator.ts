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
import { ErrorClassification } from "./error-classifier";
import {
  applyFailure,
  applyFloorPenalty,
  resetKeyHealth,
  checkAndRecoverExpiredPenalties,
  checkAndRecoverExpiredCooldowns,
} from "./health-engine";
import {
  handleAutoCalibrationSuccess,
  handleAutoCalibrationFailure,
  isKeyFloorExhausted,
  clearKeyFloorHit,
} from "./benchmark/auto-calibration";
import { createRequestLog } from "./data-access/request-logs";
import {
  waitForApiKeyRateLimit,
  settleApiKeyRateLimit,
  releaseApiKeyRateLimit,
  ApiKeyRateLimitReservation,
} from "./rate-limit/api-key-rate-limiter";
import { recordFlowEvent } from "./rate-limit/flow-tracker";
import {
  estimatePromptTokens,
  estimateCompletionBudget,
  estimateTokensForRateLimit,
} from "./rate-limit/token-estimator";
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
  clearConversationKey,
} from "./routing/conversation";
import {
  resolveSessionId,
} from "./routing/session-id";
import {
  acquireSessionLock,
  getSessionLockedKey,
  releaseSessionLock,
  releaseSessionLockForKey,
  isKeyLockedByOtherSession,
} from "./routing/session-lock";
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
  readPoolKeyPenaltyInfo,
  recoveryWaitMaxMs,
} from "./routing/pool-recovery";
import { shouldEmitExhaustedCompletion } from "./routing/exhausted-pool-policy";
import {
  backoffAfterFailure,
  MAX_ATTEMPTS,
} from "./routing/retry-backoff";
import { performKeyAttemptWithRetry } from "./routing/attempt";

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
  /**
   * Stable identifier for the originating chat session (Copilot conversation /
   * VSCode window). When present the orchestrator locks ONE key per session so
   * concurrent sessions never collide on the same pool key — each session keeps
   * its own key (preserving the provider prompt-cache discount) instead of
   * sharing a single key and exhausting it. May be null when the request carries
   * no session signal, in which case legacy single-session routing is used.
   */
  sessionId?: string;
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

  // ── Multi-session key lock ───────────────────────────
  // A Copilot/VSCode session holds ONE key per pool. Routing a session's
  // requests to its own key preserves the provider's prompt-cache discount and
  // stops two concurrent sessions from exhausting a single key together. When
  // the caller passed no explicit sessionId, resolve one from the request
  // (the gateway route) — the orchestrator accepts it directly.
  const sessionId = opts.sessionId ?? null;

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
    // No routable/healthy key remains. We must decide whether to WAIT for a key
    // to recover (let the autonomous agent hang until an answer is possible) or
    // EMIT the pre-defined "pool exhausted" completion so the agent STOPS.
    //
    // Two independent gates, both must pass to wait:
    //   (a) This pool can recover on its own — a PENALIZED/COOLDOWN key whose
    //       penaltyExpiresAt is in the future will be flipped back to ACTIVE.
    //   (b) The SHORTEST remaining penalty is under the exhausted threshold
    //       (default 30 min). If every penalty is LONG, the pool is genuinely
    //       down for the foreseeable future — telling the agent to stop is
    //       better than letting it hang for hours.
    //
    // Task 02 policy: the pre-defined message is ONLY emitted when all keys are
    // exhausted AND the lowest penalty exceeds the threshold. Otherwise the
    // request stays in the queue until a key's penalty expires and it is
    // released back to ACTIVE.
    const recoverable = recoveryInfo.recoverable && !recoveryInfo.hasActive;
    const cheapWait =
      !recoveryInfo.hasActive &&
      !shouldEmitExhaustedCompletion(
        resolvedPool.members.flatMap((m) =>
          m.keys.map((k) => ({ status: k.status, penaltyExpiresAt: k.penaltyExpiresAt }))
        )
      );

    if (recoverable && cheapWait) {
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

    // Exhausted (either not recoverable, the penalty is too long to wait, or
    // the recovery wait timed out). Only now do we emit the pre-defined message.
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
  const conv = getConversationState(resolvedPool.id, sessionId);
  // `promptTokens` is the INPUT size only; `completionBudget` is the OUTPUT
  // reserve. Never use `estimateTokensForRateLimit` (which already adds a
  // completion budget) as `promptTokens` here or the request is double-counted
  // and every healthy key looks like it overflows (phantom "pool exhausted").
  const spec = {
    promptTokens: estimatePromptTokens(canonicalRequest),
    completionBudget: estimateCompletionBudget(canonicalRequest),
  };

  // ── Multi-session locking: filter candidates ─────────
  // A session must not route to a key another session holds. We also pin the
  // session to its currently held key (if still healthy) so the prompt-cache
  // discount is preserved across turns, while still allowing failover when the
  // locked key is unavailable. `acquireSessionLock` returns the session's key
  // (picking the best free candidate if it had none), or null when every key is
  // held by another session — in which case the session waits/queues as if the
  // pool were exhausted for it.
  let sessionKeyId: string | null = null;
  if (sessionId) {
    const locked = acquireSessionLock(sessionId, resolvedPool.id, allCandidates.map((c) => c.key));
    sessionKeyId = locked ? locked.keyId : null;
    if (!sessionKeyId) {
      console.error(
        `[orchestrator] session=${sessionId.slice(0, 12)} pool=${resolvedPool.name} — ` +
          `all keys are locked by other sessions, holding for a free key`
      );
    }
  }

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

  // ── Apply session-lock exclusions to the ordered list ─
  // (1) If this session already holds a key that is still in the pool, MOVE it
  //     to the front so it is preferred for the cache discount (unless it is
  //     unhealthy, in which case failover below will skip it).
  // (2) Drop any candidate locked by a DIFFERENT session.
  if (sessionId) {
    const held = getSessionLockedKey(sessionId, resolvedPool.id);
    const poolKeyIds = new Set(allCandidates.map((c) => c.key.apiKeyId));
    if (held && poolKeyIds.has(held.keyId)) {
      // Re-acquire to refresh lastUsedAt, then hoist the held key to front.
      acquireSessionLock(sessionId, resolvedPool.id, allCandidates.map((c) => c.key));
      orderedCandidates.sort((a, b) => {
        if (a.key.apiKeyId === held.keyId) return -1;
        if (b.key.apiKeyId === held.keyId) return 1;
        return 0;
      });
    }
    // Exclude keys another session holds.
    orderedCandidates = orderedCandidates.filter(
      (c) => !isKeyLockedByOtherSession(sessionId, resolvedPool.id, c.key.apiKeyId)
    );
  }

  if (orderedCandidates.length === 0) {
    // Every candidate was excluded by the routing selector (limits/context fit)
    // or a concurrent session lock. That must NOT be treated as "pool exhausted":
    // healthy ACTIVE keys may simply be over-conservatively filtered (e.g. the
    // estimated request size is a guess, and a daily RPD/TPD limit resets within
    // hours). The PRODUCTION behaviour differs from the playground simulator, so
    // if at least one healthy ACTIVE key exists we fall back to routing to it
    // rather than declaring the pool drained — a real upstream call will tell us
    // the true limit. Only report exhausted when there is genuinely no healthy key.
    const haveHealthy = allCandidates.length > 0;
    if (!haveHealthy) {
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

    // Healthy ACTIVE keys exist but were excluded by the selector/locks. Fall
    // back to the full candidate set so we still try them (the rate-limiter
    // already handles per-key RPM/TPM waiting; a real call decides the truth).
    orderedCandidates = allCandidates;
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

      // Make the request. Task 04: transient server/network errors are silently
      // retried on the SAME key with an increasing backoff (3→6→10→15→30s) so an
      // autonomous agent never sees a spurious failure. Only when the retry
      // budget is exhausted (or the error is non-retriable) do we apply a health
      // action / penalty. `performKeyAttemptWithRetry` never throws.
      const attempt = await performKeyAttemptWithRetry(
        { url, headers, body },
        adapter,
        member.apiFormat,
        async (info, attemptNum) => {
          // Each silent retry is logged as a transient failure (no penalty yet),
          // so /logs shows the real provider message and the backoff progression.
          await createRequestLog({
            poolId: logPoolId,
            apiKeyId: key.apiKeyId,
            providerModelId: member.providerModelId,
            tier: tierLabel,
            outcome: "FAILURE",
            errorClassification: info.classification,
            httpStatus: info.httpStatus,
            latencyMs: Date.now() - startTime,
            requestedVirtualModel: canonicalRequest.model,
            providerErrorMessage: info.providerErrorMessage,
            providerErrorCode: info.providerErrorCode,
            gatewayErrorMessage: info.message,
          });
          console.error(
            `[orchestrator] key=${key.apiKeyId.slice(0, 8)} transient ` +
              `(${info.classification} ${info.httpStatus}) attempt ${attemptNum}/${MAX_ATTEMPTS} — ` +
              `waiting ${(backoffAfterFailure(attemptNum) / 1000).toFixed(0)}s before retry`
          );
        }
      );

      const latencyMs = Date.now() - startTime;

      if (!attempt.ok) {
        const { classification, providerErrorMessage, providerErrorCode, httpStatus, message } = attempt;

        // ── Floor-exhausted keys (auto-calibration minimum cap) ──
        // When the calibrator has already bottomed this key out at its
        // minimum cap and the provider STILL throttles, there is nothing
        // left to tune. Skip the normal penalty decision and apply the
        // short 1-minute FLOOR penalty so routing fails over to the next
        // healthy key quickly instead of hammering a limit that 429s.
        let floorPenalized = false;
        if (classification === "RATE_LIMITED") {
          try {
            floorPenalized = await isKeyFloorExhausted(key.apiKeyId);
          } catch {
            floorPenalized = false;
          }
        }

        if (floorPenalized) {
          await applyFloorPenalty(key.apiKeyId);
          // The floor stamp has served its purpose — clear it so the next
          // throttle re-evaluates (the calibrator may probe back up later).
          await clearKeyFloorHit(key.apiKeyId);
        } else {
          // Apply health action (pass the raw provider message/code so the
          // penalty engine can detect WHICH limit was hit — RPM/TPM/RPD/TPD).
          // Network failures that were not retriable (e.g. exhausted) also
          // penalize. INVALID_REQUEST is never penalized.
          await applyFailure({
            apiKeyId: key.apiKeyId,
            errorClassification: classification as ErrorClassification,
            providerErrorMessage,
            providerErrorCode,
          });
        }

        // ── Multi-session: release any session lock on this key ──
        // The key just got penalized (or is otherwise unusable), so it must not
        // stay pinned to a session — another session may pick it up once it
        // recovers. Also drop THIS session's affinity for it so the selector
        // doesn't keep preferring a key in cooldown on the next turn.
        releaseSessionLockForKey(resolvedPool.id, key.apiKeyId);
        if (sessionId) clearConversationKey(resolvedPool.id, sessionId);

        // Auto-calibration: scale this key's limits down on a throttle hit so
        // it stops tripping penalties and finds the real sustainable ceiling.
        // (Skipped when the key is floor-exhausted — applyFloorPenalty above
        // already handled it and there is nothing left to scale.)
        if (classification === "RATE_LIMITED" && !floorPenalized) {
          const newLimits = await handleAutoCalibrationFailure(
            key.apiKeyId,
            classification,
            providerErrorMessage
          );
          if (newLimits) {
            console.error(
              `[auto-cal] key=${key.apiKeyId.slice(0, 8)} rate-limited, scaled limits down → ` +
                `rpm=${newLimits.rpmLimit ?? "∞"} tpm=${newLimits.tpmLimit ?? "∞"}`
            );
          } else {
            // No shrink happened. If the calibrator just stamped the key as
            // at-floor, the NEXT throttle takes the 1-minute FLOOR penalty.
            try {
              if (await isKeyFloorExhausted(key.apiKeyId)) {
                console.error(
                  `[auto-cal] key=${key.apiKeyId.slice(0, 8)} hit its minimum cap — ` +
                    `next throttle → 1-min FLOOR penalty + failover`
                );
              }
            } catch {
              // ignore
            }
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
          errorClassification: classification,
          httpStatus,
          latencyMs,
          requestedVirtualModel: canonicalRequest.model,
          providerErrorMessage,
          providerErrorCode,
          gatewayErrorMessage: message,
        });

        errors.push({
          apiKeyId: key.apiKeyId,
          apiKeyLabel: key.apiKeyLabel,
          providerName: member.providerName,
          modelName: member.displayName,
          classification,
          httpStatus,
          message,
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
        if (classification === "INVALID_REQUEST") {
          return { success: false, errors };
        }

        continue;
      }

      const response = attempt.response!;

      // Success!
      await resetKeyHealth(key.apiKeyId);

      // Auto-calibration: a success advances the streak; at the threshold we
      // cautiously probe limits up toward the user's baseline ceiling.
      await handleAutoCalibrationSuccess(key.apiKeyId);

      // ── Conversation affinity (cache stickiness) ─────
      // Remember this key as the conversation's current key so the next
      // request for this pool prefers it (provider prompt-cache discount).
      if (resolvedPool.cacheAware) {
        setConversationKey(resolvedPool.id, key.apiKeyId, spec.promptTokens, sessionId);
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
        }, sessionId);
      }

      // ── Multi-session: keep this session pinned to its key ──
      // A successful request confirms the key is healthy — re-acquire the lock
      // (refreshing lastUsedAt + ensuring this session holds exactly THIS key).
      // If the session previously held a DIFFERENT key, acquire replaces the
      // registry entry under the same (session,pool) key, freeing the old one.
      if (sessionId) {
        acquireSessionLock(sessionId, resolvedPool.id, [key]);
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

      // ── Multi-session: release any session lock on this key ──
      if (classification !== "UNKNOWN") {
        releaseSessionLockForKey(resolvedPool.id, key.apiKeyId);
        if (sessionId) clearConversationKey(resolvedPool.id, sessionId);
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
  // this call. Each per-attempt failure was already logged. Before emitting the
  // "pool exhausted" completion (task 02), re-check the policy on the FRESH key
  // state — the loop may have just penalized every key. If the shortest pending
  // penalty is under the exhausted threshold, hold the request and wait for a
  // key to recover instead of telling an autonomous agent to stop.
  const freshPenaltyInfo = await readPoolKeyPenaltyInfo(resolvedPool.id);
  if (!shouldEmitExhaustedCompletion(freshPenaltyInfo)) {
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
      `[orchestrator] pool=${resolvedPool.name} all keys just failed with a SHORT penalty — ` +
        `waiting for recovery instead of emitting exhausted completion`
    );

    const recovered = await waitForPoolRecovery(resolvedPool.id, recoveryDeadline);
    if (recovered) {
      await refreshResolvedPoolStatuses(resolvedPool);
      return orchestrate(canonicalRequest, resolvedPool, {
        requestId,
        priorErrors: errors,
        deadline: recoveryDeadline,
      });
    }
    // Timed out — fall through to the exhausted completion.
  }

  // Mark the pool as exhausted so the caller returns a pre-defined completion
  // instead of a hard error (autonomous agents must stop, not retry forever).
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
          // Capture usage from ANY chunk that carries it — particularly the
          // final usage-only chunk (empty choices[]) OpenAI-compatible
          // providers emit at stream end. Must run BEFORE the empty-choices
          // guard below, otherwise that chunk is skipped and tokens are lost.
          if (delta.usage) {
            streamUsage.promptTokens = delta.usage.prompt_tokens ?? streamUsage.promptTokens;
            streamUsage.completionTokens = delta.usage.completion_tokens ?? streamUsage.completionTokens;
          }
          // A usage-only terminal chunk (empty choices[] + populated usage) is
          // exactly what OpenAI sends before [DONE] when include_usage=true.
          // VS Code's Copilot SSEProcessor reads `usage` from this chunk to
          // update its Context Window indicator. We MUST forward it to the
          // client (rather than skipping) — capturing it only for DB logging
          // is what caused the indicator to stay at 0%.
          if (!delta.choices || delta.choices.length === 0) {
            skippedEmptyChoices++;
            if (delta.usage) {
              yield delta;
            }
            continue;
          }
          if (delta.choices.some((c) => c.finish_reason != null)) {
            sawTerminal = true;
          }
          if (delta.choices.some((c) => hasUsableDelta(c))) {
            producedContent = true;
          }
          deltaCount++;
          yield delta;
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const delta = adapter.parseStreamChunk(buffer);
      if (delta) {
        // Capture usage before the empty-choices branch — a usage-only
        // terminal chunk may carry counts alongside empty choices[].
        if (delta.usage) {
          streamUsage.promptTokens = delta.usage.prompt_tokens ?? streamUsage.promptTokens;
          streamUsage.completionTokens = delta.usage.completion_tokens ?? streamUsage.completionTokens;
        }
        if (!delta.choices || delta.choices.length === 0) {
          skippedEmptyChoices++;
          if (delta.usage) yield delta;
        } else {
          if (delta.choices.some((c) => c.finish_reason != null)) {
            sawTerminal = true;
          }
          if (delta.choices.some((c) => hasUsableDelta(c))) {
            producedContent = true;
          }
          deltaCount++;
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
