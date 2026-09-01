import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/chat/cancelled?ids=id1,id2,...
 * Returns the set of session IDs that have been cancelled.
 * The hermes agent calls this between tool rounds to check
 * if it should abort processing.
 */
export async function GET(request: NextRequest) {
  try {
    const idsParam = request.nextUrl.searchParams.get("ids");
    if (!idsParam) {
      return NextResponse.json([]);
    }

    const ids = idsParam.split(",").filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json([]);
    }

    // Find sessions that have a "stop" message from the agent
    // (posted by the /stop endpoint) AFTER the last user message
    const cancelled: string[] = [];

    for (const id of ids) {
      const lastStop = await prisma.chatMessage.findFirst({
        where: {
          sessionId: id,
          content: "⏹️ Processing stopped by user.",
        },
        orderBy: { createdAt: "desc" },
      });

      const lastUser = await prisma.chatMessage.findFirst({
        where: { sessionId: id, role: "USER" },
        orderBy: { createdAt: "desc" },
      });

      // If there's a stop message after the last user message, it's cancelled
      if (lastStop && lastUser && lastStop.createdAt > lastUser.createdAt) {
        cancelled.push(id);
      }
    }

    return NextResponse.json(cancelled);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
