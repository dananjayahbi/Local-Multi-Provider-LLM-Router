import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/chat/pending
 * Returns chat sessions that have a USER message as the last
 * message (i.e. awaiting an agent response). Used by the
 * Hermes agent to poll for work.
 */
export async function GET(_request: NextRequest) {
  try {
    // Find sessions where the last message is from USER
    const sessions = await prisma.chatSession.findMany({
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const pendingSessions = sessions.filter((s) => {
      const lastMsg = s.messages[0];
      return lastMsg && lastMsg.role === "USER";
    });

    return NextResponse.json(pendingSessions);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
