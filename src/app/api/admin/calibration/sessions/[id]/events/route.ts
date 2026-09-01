import { NextRequest, NextResponse } from "next/server";
import {
  createCalibrationEvent,
  getCalibrationEventsSince,
  type CalibrationEventKind,
} from "@/engine/data-access/calibration-events";

/**
 * GET /api/admin/calibration/sessions/[id]/events?since=<eventId>
 * Returns the live agent-activity events for a calibration
 * session. Pass `since` to poll incrementally.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const since = request.nextUrl.searchParams.get("since") || undefined;
    const events = await getCalibrationEventsSince(id, since);
    return NextResponse.json(events);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/calibration/sessions/[id]/events
 * Appends a single agent-activity event. Called by the Hermes
 * agent as it researches a provider's rate limits.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const kind = (body.kind ?? "INFO") as CalibrationEventKind;
    const message = String(body.message ?? "");
    const detail = body.detail != null ? String(body.detail) : null;

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const event = await createCalibrationEvent({ sessionId: id, kind, message, detail });
    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
