import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"];

/**
 * PATCH /api/admin/discovery/requests/[id]
 * Body: { status, resultCount?, error? }
 * Used by the Hermes agent to update a research request's lifecycle.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (body.status) data.status = body.status;
    if (body.resultCount !== undefined) data.resultCount = body.resultCount;
    if (body.error !== undefined) data.error = body.error;
    if (body.status === "RUNNING") data.startedAt = new Date();
    if (body.status === "COMPLETED" || body.status === "FAILED") data.completedAt = new Date();

    const updated = await prisma.discoveryRequest.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
