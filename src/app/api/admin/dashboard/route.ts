// ─── Dashboard API ─────────────────────────────────────
// GET /api/admin/dashboard
// Aggregated "today" stats + the penalty-inspector feed for the new /dashboard.
// Optional query: providerId, modelId to filter the penalty feed.

import { NextRequest, NextResponse } from "next/server";
import { getTodayUsage, getPenaltyFeed } from "@/engine/data-access/dashboard";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId") || undefined;
    const modelId = searchParams.get("modelId") || undefined;

    const [usage, penalties] = await Promise.all([
      getTodayUsage(),
      getPenaltyFeed({ providerId, modelId }),
    ]);

    return NextResponse.json({
      today: usage,
      penalties,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
