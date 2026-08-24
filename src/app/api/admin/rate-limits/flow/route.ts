// ─── Live Flow API ──────────────────────────────────────
// GET /api/admin/rate-limits/flow
// Returns the live data-flow snapshot for the /usage animation: every request
// currently held in the gateway (queued) or in flight (assigned to a key),
// plus a rolling tail of recent transitions. Optionally filter by poolId or
// apiKeyId.

import { NextRequest, NextResponse } from "next/server";
import { getFlowSnapshot } from "@/engine/rate-limit/flow-tracker";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const poolId = searchParams.get("poolId") || undefined;
    const apiKeyId = searchParams.get("apiKeyId") || undefined;

    const snapshot = getFlowSnapshot();

    const active = poolId || apiKeyId
      ? snapshot.active.filter(
          (r) =>
            (poolId ? r.poolId === poolId : true) &&
            (apiKeyId ? r.apiKeyId === apiKeyId : true)
        )
      : snapshot.active;

    const events = poolId || apiKeyId
      ? snapshot.events.filter(
          (e) =>
            (poolId ? e.poolId === poolId : true) &&
            (apiKeyId ? e.apiKeyId === apiKeyId : true)
        )
      : snapshot.events;

    return NextResponse.json(
      { active, events, counts: snapshot.counts },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
