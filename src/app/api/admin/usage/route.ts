// ─── Usage Stats API ────────────────────────────────────
// GET /api/admin/usage
// Aggregated token usage with date range and entity filters.

import { NextRequest, NextResponse } from "next/server";
import { getUsageStats } from "@/engine/data-access/request-logs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const providerId = searchParams.get("providerId") || undefined;
    const poolId = searchParams.get("poolId") || undefined;
    const apiKeyId = searchParams.get("apiKeyId") || undefined;

    const stats = await getUsageStats({
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      providerId,
      poolId,
      apiKeyId,
    });

    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
