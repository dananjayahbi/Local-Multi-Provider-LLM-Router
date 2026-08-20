import { NextRequest, NextResponse } from "next/server";
import {
  createDiscoveryRequest,
  getDiscoveryRequests,
} from "@/engine/data-access/discovery-requests";

/**
 * GET /api/admin/discovery/requests
 * Lists recent discovery requests (research sessions).
 */
export async function GET() {
  try {
    const requests = await getDiscoveryRequests();
    return NextResponse.json(requests);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/discovery/requests
 * Body: { prompt?: string }
 * Queues a research session for the Hermes agent to pick up.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;

    const req = await createDiscoveryRequest({ prompt });
    return NextResponse.json(req, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
