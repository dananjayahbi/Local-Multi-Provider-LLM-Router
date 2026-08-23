import { NextRequest, NextResponse } from "next/server";
import {
  createCalibrationSession,
  getCalibrationSessions,
} from "@/engine/data-access/calibration-sessions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/calibration/sessions?status=PENDING
 * Lists calibration sessions (newest first), optionally filtered
 * by status (PENDING / RUNNING / COMPLETED / FAILED).
 */
export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const sessions = await getCalibrationSessions(undefined, status);
    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/calibration/sessions
 * Body: { providerId, apiKeyId, providerModelId }
 * Creates a PENDING calibration session for the Hermes agent to
 * pick up. Validates that the key and model belong to the provider.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { providerId, apiKeyId, providerModelId } = body;

    if (!providerId || !apiKeyId || !providerModelId) {
      return NextResponse.json(
        { error: "providerId, apiKeyId, and providerModelId are required" },
        { status: 400 }
      );
    }

    const key = await prisma.apiKey.findFirst({
      where: { id: apiKeyId, providerId },
    });
    if (!key) {
      return NextResponse.json(
        { error: "Selected key does not belong to the selected provider" },
        { status: 400 }
      );
    }

    const model = await prisma.providerModel.findFirst({
      where: { id: providerModelId, providerId },
    });
    if (!model) {
      return NextResponse.json(
        { error: "Selected model does not belong to the selected provider" },
        { status: 400 }
      );
    }

    const session = await createCalibrationSession({
      providerId,
      apiKeyId,
      providerModelId,
    });
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
