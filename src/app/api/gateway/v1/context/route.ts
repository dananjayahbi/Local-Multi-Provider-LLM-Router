// ─── Gateway Context Usage Probe ────────────────────────
// Read-only GET /api/gateway/v1/context
// Reports how "full" a conversation's context is, as observed by the gateway.
// The VS Code extension probes this to decide WHEN it's the right time to fire
// the native Compact Conversation command (client-side compaction).
//
// This is intentionally STATELESS and NOT part of the compaction engine (which
// was removed). It only reads the most recent request log entries to estimate
// context usage — no summarization, no rewriting, no state.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyGatewayKey } from "@/lib/gateway-key";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ContextUsageResponse {
  model: string | null;
  contextWindow: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  pctUsed: number | null;
  updatedAt: string | null;
  recentRequests: number;
}

export async function GET(request: NextRequest) {
  // Auth check (same as the gateway route): Bearer token, unified key or per-pool key.
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Missing or invalid Authorization header", type: "auth_error" } },
      { status: 401 }
    );
  }
  const token = authHeader.slice(7);

  const { searchParams } = new URL(request.url);
  const model = searchParams.get("model") ?? null;
  const poolId = searchParams.get("poolId") ?? null;

  // Authenticate against the unified key first, else the pool key (if a model is given).
  let authed = false;
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (settings && verifyGatewayKey(token, settings.unifiedGatewayKeyHash)) {
    authed = true;
  } else if (poolId || model) {
    const pool = await prisma.pool.findUnique({
      where: model ? { virtualModelName: model } : { id: poolId! },
      select: { gatewayKey: true },
    });
    if (pool?.gatewayKey && pool.gatewayKey === token) authed = true;
  }
  if (!authed) {
    return NextResponse.json(
      { error: { message: "Invalid API key", type: "auth_error" } },
      { status: 401 }
    );
  }

  // Resolve the target pool: explicit poolId, else by virtualModelName.
  let resolvedPoolId: string | null = poolId;
  if (!resolvedPoolId && model) {
    const pool = await prisma.pool.findUnique({
      where: { virtualModelName: model },
      select: { id: true },
    });
    resolvedPoolId = pool?.id ?? null;
  }

  // Most recent request for this pool (or any pool if none specified).
  const latest = await prisma.requestLog.findFirst({
    where: resolvedPoolId ? { poolId: resolvedPoolId } : {},
    orderBy: { createdAt: "desc" },
    select: {
      promptTokens: true,
      completionTokens: true,
      createdAt: true,
      requestedVirtualModel: true,
    },
  });

  // Resolve the context window from the pool's member keys (the gateway route
  // uses the same source: `ApiKey.contextWindow`). Default 128k if unset.
  let contextWindow: number | null = null;
  if (resolvedPoolId) {
    const poolWithKeys = await prisma.pool.findUnique({
      where: { id: resolvedPoolId },
      select: {
        poolApiKeys: {
          select: { apiKey: { select: { contextWindow: true } } },
        },
      },
    });
    const windows = (poolWithKeys?.poolApiKeys ?? [])
      .map((j) => j.apiKey.contextWindow)
      .filter((w): w is number => typeof w === "number" && w > 0);
    contextWindow = windows.length > 0 ? Math.max(...windows) : 128_000;
  }

  const promptTokens = latest?.promptTokens ?? null;
  const completionTokens = latest?.completionTokens ?? null;
  const totalTokens =
    promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : null;

  const pctUsed =
    promptTokens != null && contextWindow != null && contextWindow > 0
      ? Math.round((promptTokens / contextWindow) * 100)
      : null;

  const recentRequests = await prisma.requestLog.count({
    where: resolvedPoolId ? { poolId: resolvedPoolId } : {},
  });

  const body: ContextUsageResponse = {
    model: latest?.requestedVirtualModel ?? model,
    contextWindow,
    promptTokens,
    completionTokens,
    totalTokens,
    pctUsed,
    updatedAt: latest?.createdAt?.toISOString() ?? null,
    recentRequests,
  };

  return NextResponse.json(body);
}
