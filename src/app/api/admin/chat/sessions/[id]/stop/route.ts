import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/chat/sessions/[id]/stop
 * Requests cancellation of the agent's current processing
 * for this session. The agent checks this flag between tool
 * rounds and aborts if set.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Update the session's updatedAt to signal cancellation
    // The agent will check this timestamp against when it started
    await prisma.chatSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Also post a system message so the user sees confirmation
    await prisma.chatMessage.create({
      data: {
        sessionId: id,
        role: "AGENT",
        kind: "TEXT",
        content: "⏹️ Processing stopped by user.",
      },
    });

    return NextResponse.json({ ok: true, cancelled: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
