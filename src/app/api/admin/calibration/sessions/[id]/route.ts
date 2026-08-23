import { NextRequest, NextResponse } from "next/server";
import {
  getCalibrationSession,
  applyCalibrationFindings,
} from "@/engine/data-access/calibration-sessions";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"];

/**
 * GET /api/admin/calibration/sessions/[id]
 * Returns a single calibration session with its provider/key/model
 * context for the findings review panel.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getCalibrationSession(id);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/calibration/sessions/[id]
 * Body:
 *   { status, error? }          — lifecycle updates from the Hermes agent
 *   { action: "apply" }         — user applies a COMPLETED session's findings
 *                                 to its provider-level API key.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.action === "apply") {
      const updated = await applyCalibrationFindings(id);
      return NextResponse.json(updated);
    }

    const data: Record<string, unknown> = {};
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    if (body.status) data.status = body.status;
    if (body.error !== undefined) data.error = body.error;
    if (body.status === "RUNNING") data.startedAt = new Date();
    if (body.status === "COMPLETED" || body.status === "FAILED") data.completedAt = new Date();

    const updated = await prisma.calibrationSession.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err) {
    const e = err as { message?: string } | Error;
    const message = e?.message ?? String(err);
    const bad = /not found|already applied|must be COMPLETED|no usable rate-limit values/i.test(
      message
    );
    return NextResponse.json({ error: message }, { status: bad ? 400 : 500 });
  }
}
