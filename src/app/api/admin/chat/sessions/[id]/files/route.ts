import { NextRequest, NextResponse } from "next/server";
import {
  getChatFiles,
  createChatFile,
} from "@/engine/data-access/chat";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * GET /api/admin/chat/sessions/[id]/files
 * Lists files uploaded to a session.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const files = await getChatFiles(id);
    return NextResponse.json(files);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/chat/sessions/[id]/files
 * Body: { name, mimeType, size, data } where data is base64.
 * Stores an uploaded file for the session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const name = String(body.name ?? "");
    const mimeType = String(body.mimeType ?? "application/octet-stream");
    const size = Number(body.size ?? 0);
    const data = String(body.data ?? "");

    if (!name || !data) {
      return NextResponse.json(
        { error: "name and data are required" },
        { status: 400 }
      );
    }
    if (size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 5 MB limit" },
        { status: 400 }
      );
    }

    const file = await createChatFile({ sessionId: id, name, mimeType, size, data });
    return NextResponse.json(file, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
