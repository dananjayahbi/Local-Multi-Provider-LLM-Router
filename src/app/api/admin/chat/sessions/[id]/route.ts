import { NextRequest, NextResponse } from "next/server";
import {
  getChatSessionById,
  updateChatSessionTitle,
  deleteChatSession,
} from "@/engine/data-access/chat";

/**
 * GET /api/admin/chat/sessions/[id]
 * Returns a session with its messages and files.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getChatSessionById(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/chat/sessions/[id]
 * Body: { title?: string }
 * Updates a session's title.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const session = await updateChatSessionTitle(id, body.title.trim());
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/chat/sessions/[id]
 * Deletes a session and all its messages/files (cascade).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteChatSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
