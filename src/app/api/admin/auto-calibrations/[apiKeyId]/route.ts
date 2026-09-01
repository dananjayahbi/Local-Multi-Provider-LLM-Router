// ─── Auto-Calibrations Per-Key API ────────────────────
// GET /api/admin/auto-calibrations/[apiKeyId]
// Returns the full history for a single key plus its current applied limits.

import { NextRequest, NextResponse } from "next/server";
import {
  getAutoCalibrationEvents,
} from "@/engine/data-access/auto-calibration-events";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ apiKeyId: string }> }
) {
  try {
    const { apiKeyId } = await params;
    const events = await getAutoCalibrationEvents(apiKeyId);
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
