// ─── Auto-Calibrations Timeline API ───────────────────
// GET /api/admin/auto-calibrations
// Returns the auto-calibration timeline events (across all auto-calibrated
// keys or filtered) plus the list of auto-calibrated keys with their current
// applied limits. The "Auto Calibrations" page renders both.
//
// Query params (all optional):
//   apiKeyId   — filter to a single key's history
//   poolId     — filter to keys attached to a pool
//   providerId — filter to keys owned by a provider

import { NextRequest, NextResponse } from "next/server";
import {
  getAutoCalibrationTimeline,
  getAutoCalibrationKeys,
} from "@/engine/data-access/auto-calibration-events";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apiKeyId = searchParams.get("apiKeyId") || undefined;
    const poolId = searchParams.get("poolId") || undefined;
    const providerId = searchParams.get("providerId") || undefined;

    const [events, keys] = await Promise.all([
      getAutoCalibrationTimeline({ apiKeyId, poolId, providerId }),
      getAutoCalibrationKeys({ providerId }),
    ]);

    return NextResponse.json({ events, keys });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
