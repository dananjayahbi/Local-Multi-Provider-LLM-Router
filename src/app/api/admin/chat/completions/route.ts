// ─── Admin Chat Completions ───────────────────────────
// POST /api/admin/chat/completions
// Chat against a single configured model (ProviderModel). Resolves the
// provider + its active keys, builds a one-member pool, and runs it through
// the same orchestrator as the public gateway — so rate limits, health
// penalties, and USAGE tracking (RequestLog → /usage) all apply identically.

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CanonicalRequest, CanonicalDelta } from "@/engine/canonical";
import { orchestrate, ResolvedPool } from "@/engine/orchestrator";
import { serializeResponse, serializeDelta, serializeStreamEnd } from "@/engine/serializer";

interface ChatCompletionBody {
  providerModelId: string;
  messages: CanonicalRequest["messages"];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

export async function POST(request: NextRequest) {
  let body: ChatCompletionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const { providerModelId, stream } = body;
  if (!providerModelId) {
    return NextResponse.json(
      { error: { message: "providerModelId is required" } },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: { message: "messages is required and must be non-empty" } },
      { status: 400 }
    );
  }

  // Resolve the ProviderModel + its provider + active keys.
  const providerModel = await prisma.providerModel.findUnique({
    where: { id: providerModelId },
    include: {
      provider: {
        include: {
          apiKeys: {
            where: { status: { notIn: ["DISABLED", "SUSPENDED"] } },
            orderBy: { createdAt: "asc" as const },
          },
        },
      },
    },
  });

  if (!providerModel || !providerModel.provider) {
    return NextResponse.json(
      { error: { message: "Model not found" } },
      { status: 404 }
    );
  }

  const provider = providerModel.provider;
  const keys = provider.apiKeys;

  if (keys.length === 0) {
    return NextResponse.json(
      { error: { message: `No active API keys configured for provider "${provider.name}".` } },
      { status: 400 }
    );
  }

  // Build canonical request.
  const canonicalRequest: CanonicalRequest = {
    model: `${provider.name}/${providerModel.modelId}`,
    messages: body.messages,
    system: body.system,
    temperature: body.temperature,
    max_tokens: body.maxTokens,
    stream: stream ?? false,
  };

  // One-member pool using the provider's keys (key sharing via providerId).
  const resolvedPool: ResolvedPool = {
    id: `chat-${provider.id}`,
    name: provider.name,
    routingStrategy: "KEY_AWARE",
    cacheAware: true,
    stickyContextTokenBudget: 0,
    // Synthetic pool — not a real Pool row, so don't set a Pool FK on logs.
    logPoolId: null,
    members: [
      {
        memberId: providerModel.id,
        priority: 0,
        providerModelId: providerModel.id,
        providerModelName: providerModel.modelId,
        displayName: providerModel.displayName,
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat,
        reliableToolCalls: providerModel.reliableToolCalling !== false,
        keys: keys.map((k) => ({
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
      },
    ],
  };

  const result = await orchestrate(canonicalRequest, resolvedPool);

  if (!result.success) {
    return NextResponse.json(
      {
        error: {
          message: "All keys failed",
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
  if (stream && result.streamGenerator) {
    const encoder = new TextEncoder();
    const terminalChunk = serializeDelta({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });

    const streamRes = new ReadableStream({
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
          console.error("[admin:chat-stream] mid-stream error:", err);
        } finally {
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

    return new Response(streamRes, {
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
