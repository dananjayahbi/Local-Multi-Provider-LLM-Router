import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessages,
  createChatMessage,
} from "@/engine/data-access/chat";

/**
 * GET /api/admin/chat/sessions/[id]/messages
 * Returns all messages in a session (chronological).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const messages = await getChatMessages(id);
    return NextResponse.json(messages);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/chat/sessions/[id]/messages
 * Body: { role, kind?, content, assets? }
 * Appends a message to a session. Used by the UI to persist
 * user turns and by the Hermes agent to persist agent turns.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const role = body.role === "AGENT" ? "AGENT" : "USER";
    const kind = ["TEXT", "ASSETS", "ERROR"].includes(body.kind)
      ? body.kind
      : "TEXT";
    const content = String(body.content ?? "");

    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const message = await createChatMessage({
      sessionId: id,
      role,
      kind,
      content,
      assets: Array.isArray(body.assets) ? body.assets : null,
    });
    return NextResponse.json(message, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
