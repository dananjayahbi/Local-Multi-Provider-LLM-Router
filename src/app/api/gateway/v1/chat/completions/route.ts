// ─── Gateway API ────────────────────────────────────────
// POST /api/gateway/v1/chat/completions
// OpenAI-compatible endpoint for LLM chat requests.

export const maxDuration = 300; // 5 min for long streaming requests
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const fetchCache = "default-no-store";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyGatewayKey } from "@/lib/gateway-key";
import { CanonicalRequest, CanonicalDelta } from "@/engine/canonical";
import { orchestrate, ResolvedPool } from "@/engine/orchestrator";
import { serializeResponse, serializeDelta, serializeStreamEnd } from "@/engine/serializer";
import { getAdapter } from "@/engine/adapters";
import { classifyError } from "@/engine/error-classifier";
import { applyFailure, resetKeyHealth } from "@/engine/health-engine";
import { createRequestLog } from "@/engine/data-access/request-logs";
import { decrypt } from "@/lib/encryption";
import { normalizeCanonicalResponse } from "@/engine/response-normalizer";
import {
  waitForApiKeyRateLimit,
  settleApiKeyRateLimit,
} from "@/engine/rate-limit/api-key-rate-limiter";
import { estimateTokensForRateLimit } from "@/engine/rate-limit/token-estimator";
import { takePendingInjection } from "@/engine/routing/conversation";
import { buildInjection, InjectionInput, LimitName } from "@/engine/playground";

export async function POST(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Missing or invalid Authorization header", type: "auth_error" } },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);

  // Parse body (needed to resolve the target pool for per-pool key auth)
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request" } },
      { status: 400 }
    );
  }

  const requestedModel = (rawBody.model as string) || "";

  // ─── Per-Pool Key Auth (Task 01) ─────────────────────
  // A pool owns a plaintext gateway key; authenticating with it grants
  // access to just that pool. Fall back to the legacy unified key.
  const authPool = await prisma.pool.findUnique({
    where: { virtualModelName: requestedModel },
    select: { gatewayKey: true },
  });

  let authed = false;
  if (authPool?.gatewayKey && authPool.gatewayKey === token) {
    authed = true;
  } else {
    const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
    if (settings && verifyGatewayKey(token, settings.unifiedGatewayKeyHash)) {
      authed = true;
    }
  }
  if (!authed) {
    return NextResponse.json(
      { error: { message: "Invalid API key", type: "auth_error" } },
      { status: 401 }
    );
  }

  console.error(
    `[gateway] Incoming: model=${requestedModel} stream=${rawBody.stream} ` +
    `tools=${Array.isArray(rawBody.tools) ? rawBody.tools.length : 0} ` +
    `msgs=${Array.isArray(rawBody.messages) ? rawBody.messages.length : 0} ` +
    `keys=[${Object.keys(rawBody).filter(k => k !== 'messages').join(',')}]`
  );

  // ─── Model Resolution ─────────────────────────────────
  // Check if it matches a Pool's virtualModelName
  const pool = await prisma.pool.findUnique({
    where: { virtualModelName: requestedModel },
    include: {
      poolMembers: {
        include: {
          providerModel: {
            select: {
              id: true,
              modelId: true,
              displayName: true,
              reliableToolCalling: true,
              provider: {
                select: {
                  id: true, name: true, baseUrl: true, apiFormat: true,
                },
              },
            },
          },
        },
      },
      poolApiKeys: {
        include: {
          apiKey: {
            select: {
              id: true, providerId: true, label: true, secret: true, secretEncrypted: true,
              status: true, penaltyExpiresAt: true, penaltyLevel: true,
              lastUsedAt: true, rpmLimit: true, tpmLimit: true,
              rpdLimit: true, tpdLimit: true, tps: true,
              timeToFirstTokenMs: true, contextWindow: true,
              cacheCapable: true, cacheDiscountFactor: true,
            },
          },
        },
      },
    },
  });

  if (pool) {
    // Resolve the keys attached to this pool via the PoolApiKey join.
    // Provider-level keys can be shared across pools; the same key record is
    // used, so its penalty/limits propagate to every pool that references it.
    const poolKeys = pool.poolApiKeys.map((j) => j.apiKey);
    // ── Copilot injection (Task 06-07) ─────────────────
    // If a previous request for this pool rotated keys due to a limit,
    // append the askQuestion guidance so the model can ask the user whether
    // to switch directly or compact the chat (context is now uncached).
    const pendingInjection = takePendingInjection(pool.id);
    let messages = (rawBody.messages as CanonicalRequest["messages"]) || [];
    if (pendingInjection) {
      const guidance = buildInjection("compact_first", {
        keyLabel: pendingInjection.keyLabel,
        limitName: pendingInjection.limitName as LimitName,
        nextKeyLabel: pendingInjection.nextKeyLabel,
        promptTokens: pendingInjection.promptTokens,
        lastPromptTokens: pendingInjection.lastPromptTokens,
      } satisfies InjectionInput);
      messages = [
        { role: "system", content: guidance },
        ...messages,
      ];
    }

    // Build canonical request
    const canonicalRequest: CanonicalRequest = {
      model: requestedModel,
      messages,
      system: undefined,
      temperature: rawBody.temperature as number | undefined,
      max_tokens: (rawBody.max_tokens ?? rawBody.max_completion_tokens) as number | undefined,
      top_p: rawBody.top_p as number | undefined,
      stream: (rawBody.stream as boolean) || false,
      tools: rawBody.tools as CanonicalRequest["tools"],
      tool_choice: rawBody.tool_choice as CanonicalRequest["tool_choice"],
      stop: rawBody.stop as CanonicalRequest["stop"],
    };

    // ── Resolve pool-owned keys per provider ───────────
    // A pool's keys (pool.apiKeys) are routed to the member whose provider
    // matches the key's provider.
    const resolvedPool: ResolvedPool = {
      id: pool.id,
      name: pool.name,
      routingStrategy: pool.routingStrategy,
      cacheAware: pool.cacheAware,
      stickyContextTokenBudget: pool.stickyContextTokenBudget,
      members: pool.poolMembers.map((m) => ({
        memberId: m.id,
        priority: m.priority,
        providerModelId: m.providerModel.id,
        providerModelName: m.providerModel.modelId,
        displayName: m.providerModel.displayName,
        providerId: m.providerModel.provider.id,
        providerName: m.providerModel.provider.name,
        baseUrl: m.providerModel.provider.baseUrl,
        apiFormat: m.providerModel.provider.apiFormat,
        reliableToolCalls: m.providerModel.reliableToolCalling !== false,
        keys: poolKeys
          .filter((k) => k.providerId === m.providerModel.provider.id)
          .map((k) => ({
            apiKeyId: k.id,
            apiKeyLabel: k.label,
            secret: k.secret,
            secretEncrypted: k.secretEncrypted,
            status: k.status,
            penaltyLevel: k.penaltyLevel,
            penaltyExpiresAt: k.penaltyExpiresAt,
            lastUsedAt: k.lastUsedAt,
            rpmLimit: k.rpmLimit as number | null,
            tpmLimit: k.tpmLimit as number | null,
            rpdLimit: k.rpdLimit as number | null,
            tpdLimit: k.tpdLimit as number | null,
            tps: k.tps as number | null,
            timeToFirstTokenMs: k.timeToFirstTokenMs as number | null,
            contextWindow: k.contextWindow as number | null,
            cacheCapable: k.cacheCapable,
            cacheDiscountFactor: k.cacheDiscountFactor,
          })),
      })),
    };

    const result = await orchestrate(canonicalRequest, resolvedPool);

    if (!result.success) {
      return NextResponse.json(
        {
          error: {
            message: "All pool candidates exhausted",
            type: "all_failed",
            attempts: result.errors.map((e) => ({
              provider: e.providerName,
              key: e.apiKeyLabel,
              classification: e.classification,
              message: e.message,
            })),
          },
        },
        { status: 502 }
      );
    }

    // Streaming
    if (rawBody.stream && result.streamGenerator) {
      const encoder = new TextEncoder();
      // Terminal chunk guaranteeing a valid choices array is always emitted.
      const terminalChunk = serializeDelta({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });

      const stream = new ReadableStream({
        async start(controller) {
          let hasTerminal = false;
          try {
            for await (const delta of result.streamGenerator!) {
              const chunk = serializeDelta(delta);
              if (chunk) {
                controller.enqueue(encoder.encode(chunk));
                if (delta.choices?.some((c) => c.finish_reason != null)) {
                  hasTerminal = true;
                }
              }
            }
          } catch (err) {
            // Never sever the stream silently. If the upstream stream throws
            // mid-generation, we still emit a synthetic terminal chunk below.
            console.error("[gateway:stream] mid-stream error, injecting terminal chunk:", err);
          } finally {
            // Guarantee the client always receives a terminal finish_reason
            // chunk + [DONE], so it never sees a stream with no choices.
            try {
              if (!hasTerminal && terminalChunk) {
                controller.enqueue(encoder.encode(terminalChunk));
              }
              controller.enqueue(encoder.encode(serializeStreamEnd()));
            } catch {}
            try { controller.close(); } catch {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Non-streaming
    return NextResponse.json(serializeResponse(result.canonicalResponse!));
  }

  // ─── Direct-addressing mode: providerName/modelId ──────
  const slashIndex = requestedModel.indexOf("/");
  if (slashIndex > 0) {
    const providerName = requestedModel.slice(0, slashIndex);
    const modelId = requestedModel.slice(slashIndex + 1);

    const provider = await prisma.provider.findFirst({
      where: { name: providerName },
      include: {
        apiKeys: {
          where: { status: { notIn: ["DISABLED", "SUSPENDED"] } },
          select: {
            id: true,
            label: true,
            secret: true,
            secretEncrypted: true,
            status: true,
            rpmLimit: true,
            tpmLimit: true,
          },
        },
        providerModels: {
          where: { modelId },
        },
      },
    });

    if (!provider || provider.providerModels.length === 0 || provider.apiKeys.length === 0) {
      return NextResponse.json(
        { error: { message: `No matching provider/model or no active keys: ${requestedModel}`, type: "not_found" } },
        { status: 404 }
      );
    }

    // Use the first active key
    const apiKey = provider.apiKeys[0];
    const providerModel = provider.providerModels[0];
    const startTime = Date.now();
    let decryptedKey: string;

    try {
      decryptedKey =
        apiKey.secret || (apiKey.secretEncrypted ? decrypt(apiKey.secretEncrypted) : "");
      if (!decryptedKey) {
        return NextResponse.json(
          { error: { message: "API key has no secret", type: "internal_error" } },
          { status: 500 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: { message: "Failed to decrypt API key", type: "internal_error" } },
        { status: 500 }
      );
    }

    const canonicalRequest: CanonicalRequest = {
      model: modelId,
      messages: (rawBody.messages as CanonicalRequest["messages"]) || [],
      system: undefined,
      temperature: rawBody.temperature as number | undefined,
      max_tokens: (rawBody.max_tokens ?? rawBody.max_completion_tokens) as number | undefined,
      top_p: rawBody.top_p as number | undefined,
      stream: (rawBody.stream as boolean) || false,
      tools: rawBody.tools as CanonicalRequest["tools"],
      tool_choice: rawBody.tool_choice as CanonicalRequest["tool_choice"],
      stop: rawBody.stop as CanonicalRequest["stop"],
    };

    const adapter = getAdapter(provider.apiFormat);

    // Per-key rate limit wait
    const estimatedTokens = estimateTokensForRateLimit(canonicalRequest);
    let reservation = await waitForApiKeyRateLimit({
      apiKeyId: apiKey.id,
      rpmLimit: apiKey.rpmLimit as number | null,
      tpmLimit: apiKey.tpmLimit as number | null,
      requestedTokens: estimatedTokens,
    });

    try {
      const { url, headers, body } = adapter.buildRequest(
        canonicalRequest,
        decryptedKey,
        provider.baseUrl,
        modelId
      );

      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(300_000),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text();
        const parsed = adapter.parseError(errorBody, response.status);
        const classified = classifyError(response.status, parsed.providerErrorCode, parsed.providerErrorMessage);

        await applyFailure({ apiKeyId: apiKey.id, errorClassification: classified.classification });
        await createRequestLog({
          apiKeyId: apiKey.id,
          providerModelId: providerModel.id,
          outcome: "FAILURE",
          errorClassification: classified.classification,
          httpStatus: response.status,
          latencyMs,
          requestedVirtualModel: requestedModel,
        });

        return NextResponse.json(
          { error: { message: classified.providerErrorMessage, type: classified.classification } },
          { status: response.status }
        );
      }

      await resetKeyHealth(apiKey.id);

      // Streaming
      if (rawBody.stream) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let buffer = "";

        const terminalChunk = serializeDelta({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        const stream = new ReadableStream({
          async start(controller) {
            let hasTerminal = false;
            const emitDelta = (delta: CanonicalDelta) => {
              const chunk = serializeDelta(delta);
              if (chunk) {
                controller.enqueue(encoder.encode(chunk));
                if (delta.choices?.some((c) => c.finish_reason != null)) {
                  hasTerminal = true;
                }
              }
            };
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
                    emitDelta(delta);
                  }
                }
              }
              if (buffer.trim()) {
                const delta = adapter.parseStreamChunk(buffer);
                if (delta && delta.choices && delta.choices.length > 0) {
                  emitDelta(delta);
                }
              }
            } catch (err) {
              console.error("[gateway:direct-stream] mid-stream error, injecting terminal chunk:", err);
            } finally {
              try {
                if (!hasTerminal && terminalChunk) {
                  controller.enqueue(encoder.encode(terminalChunk));
                }
                controller.enqueue(encoder.encode(serializeStreamEnd()));
              } catch {}
              try { settleApiKeyRateLimit(reservation, null).catch(() => {}); } catch {}
              try { controller.close(); } catch {}
            }
          },
        });

        await createRequestLog({
          apiKeyId: apiKey.id,
          providerModelId: providerModel.id,
          outcome: "SUCCESS",
          latencyMs,
          requestedVirtualModel: requestedModel,
        });

        return new Response(stream, {
          status: response.status,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming
      const responseBody = await response.text();
      let canonicalResponse = adapter.parseResponse(responseBody, response.status);
      canonicalResponse = normalizeCanonicalResponse(canonicalResponse);

      await settleApiKeyRateLimit(reservation, canonicalResponse.usage?.total_tokens ?? null);

      await createRequestLog({
        apiKeyId: apiKey.id,
        providerModelId: providerModel.id,
        outcome: "SUCCESS",
        latencyMs,
        promptTokens: canonicalResponse.usage?.prompt_tokens ?? null,
        completionTokens: canonicalResponse.usage?.completion_tokens ?? null,
        requestedVirtualModel: requestedModel,
      });

      return NextResponse.json(serializeResponse(canonicalResponse));
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      await createRequestLog({
        apiKeyId: apiKey.id,
        providerModelId: providerModel.id,
        outcome: "FAILURE",
        errorClassification: "NETWORK_ERROR",
        httpStatus: 0,
        latencyMs,
        requestedVirtualModel: requestedModel,
        providerErrorMessage: message,
        providerErrorCode: "NETWORK",
        gatewayErrorMessage: message,
      });

      return NextResponse.json(
        { error: { message, type: "network_error" } },
        { status: 502 }
      );
    }
  }

  // Model not found
  return NextResponse.json(
    {
      error: {
        message: `Unknown model: "${requestedModel}". Use a pool virtual model name or "providerName/modelId" for direct addressing.`,
        type: "not_found",
      },
    },
    { status: 400 }
  );
}
