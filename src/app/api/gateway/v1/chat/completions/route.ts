// ─── Gateway API ────────────────────────────────────────
// POST /api/gateway/v1/chat/completions
// OpenAI-compatible endpoint for LLM chat requests.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyGatewayKey } from "@/lib/gateway-key";
import { CanonicalRequest } from "@/engine/canonical";
import { orchestrate } from "@/engine/orchestrator";
import { serializeResponse, serializeDelta, serializeStreamEnd } from "@/engine/serializer";
import { getAdapter } from "@/engine/adapters";
import { classifyError } from "@/engine/error-classifier";
import { applyFailure, resetKeyHealth } from "@/engine/health-engine";
import { createRequestLog } from "@/engine/data-access/request-logs";
import { decrypt } from "@/lib/encryption";

// In-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120; // max requests per minute

function checkRateLimit(): boolean {
  const now = Date.now();
  const key = "global";
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  // Rate limit check
  if (!checkRateLimit()) {
    return NextResponse.json(
      { error: { message: "Too many requests. Please slow down.", type: "rate_limit" } },
      { status: 429 }
    );
  }

  // Auth check
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Missing or invalid Authorization header", type: "auth_error" } },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings || !verifyGatewayKey(token, settings.unifiedGatewayKeyHash)) {
    return NextResponse.json(
      { error: { message: "Invalid API key", type: "auth_error" } },
      { status: 401 }
    );
  }

  // Parse body
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
            include: {
              provider: {
                include: {
                  apiKeys: {
                    select: {
                      id: true, label: true, secretEncrypted: true,
                      status: true, penaltyExpiresAt: true,
                      penaltyLevel: true, lastUsedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (pool) {
    // Build canonical request
    const canonicalRequest: CanonicalRequest = {
      model: requestedModel,
      messages: (rawBody.messages as CanonicalRequest["messages"]) || [],
      system: undefined,
      temperature: rawBody.temperature as number | undefined,
      max_tokens: rawBody.max_tokens as number | undefined,
      top_p: rawBody.top_p as number | undefined,
      stream: (rawBody.stream as boolean) || false,
      tools: rawBody.tools as CanonicalRequest["tools"],
      tool_choice: rawBody.tool_choice as CanonicalRequest["tool_choice"],
      stop: rawBody.stop as CanonicalRequest["stop"],
    };

    const resolvedPool = {
      id: pool.id,
      name: pool.name,
      routingStrategy: pool.routingStrategy,
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
        keys: m.providerModel.provider.apiKeys.map((k) => ({
          apiKeyId: k.id,
          apiKeyLabel: k.label,
          secretEncrypted: k.secretEncrypted,
          status: k.status,
          penaltyLevel: k.penaltyLevel,
          penaltyExpiresAt: k.penaltyExpiresAt,
          lastUsedAt: k.lastUsedAt,
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
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const delta of result.streamGenerator!) {
              const chunk = serializeDelta(delta);
              controller.enqueue(encoder.encode(chunk));
            }
            controller.enqueue(encoder.encode(serializeStreamEnd()));
          } catch (err) {
            const errorChunk = JSON.stringify({
              error: { message: err instanceof Error ? err.message : "Stream error" },
            });
            controller.enqueue(encoder.encode(`data: ${errorChunk}\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
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
      decryptedKey = decrypt(apiKey.secretEncrypted);
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
      max_tokens: rawBody.max_tokens as number | undefined,
      top_p: rawBody.top_p as number | undefined,
      stream: (rawBody.stream as boolean) || false,
      tools: rawBody.tools as CanonicalRequest["tools"],
      tool_choice: rawBody.tool_choice as CanonicalRequest["tool_choice"],
      stop: rawBody.stop as CanonicalRequest["stop"],
    };

    const adapter = getAdapter(provider.apiFormat);

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
        signal: AbortSignal.timeout(120_000),
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

        const stream = new ReadableStream({
          async start(controller) {
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
                    controller.enqueue(encoder.encode(serializeDelta(delta)));
                  }
                }
              }
              if (buffer.trim()) {
                const delta = adapter.parseStreamChunk(buffer);
                if (delta) controller.enqueue(encoder.encode(serializeDelta(delta)));
              }
              controller.enqueue(encoder.encode(serializeStreamEnd()));
            } catch (err) {
              const errorChunk = JSON.stringify({
                error: { message: err instanceof Error ? err.message : "Stream error" },
              });
              controller.enqueue(encoder.encode(`data: ${errorChunk}\n\n`));
            } finally {
              controller.close();
            }
          },
        });

        await createRequestLog({
          apiKeyId: apiKey.id,
          providerModelId: providerModel.id,
          outcome: "SUCCESS",
          latencyMs: Date.now() - startTime,
          requestedVirtualModel: requestedModel,
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming
      const responseBody = await response.text();
      const canonicalResponse = adapter.parseResponse(responseBody, response.status);

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
