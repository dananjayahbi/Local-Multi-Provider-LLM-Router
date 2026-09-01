import { NextRequest, NextResponse } from "next/server";
import {
  getChatSessions,
  createChatSession,
} from "@/engine/data-access/chat";

/**
 * GET /api/admin/chat/sessions
 * Lists chat sessions (most recently updated first).
 */
export async function GET() {
  try {
    const sessions = await getChatSessions();
    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/chat/sessions
 * Body: { title?: string }
 * Creates a new chat session.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "New Chat";
    const session = await createChatSession(title);
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
