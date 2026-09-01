import { NextRequest, NextResponse } from "next/server";
import {
  createDiscoveryEvent,
  getDiscoveryEventsSince,
  type DiscoveryEventKind,
} from "@/engine/data-access/discovery-events";

/**
 * GET /api/admin/discovery/requests/[id]/events?since=<eventId>
 * Returns the live agent-conversation events for a discovery
 * request. Pass `since` to poll incrementally.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const since = request.nextUrl.searchParams.get("since") || undefined;
    const events = await getDiscoveryEventsSince(id, since);
    return NextResponse.json(events);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/discovery/requests/[id]/events
 * Appends a single agent-conversation event. Called by the
 * Hermes agent as it works through a discovery session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const kind = (body.kind ?? "INFO") as DiscoveryEventKind;
    const message = String(body.message ?? "");
    const detail = body.detail != null ? String(body.detail) : null;

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const event = await createDiscoveryEvent({ requestId: id, kind, message, detail });
    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
