import { NextRequest, NextResponse } from "next/server";
import { getDraftById, updateDraft, deleteDraft } from "@/engine/data-access/drafts";

const VALID_STATUSES = ["PENDING_KEY", "TESTING", "ACCEPTED", "REJECTED"];
const VALID_FORMATS = ["CHAT_COMPLETIONS", "MESSAGES", "RESPONSES"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const draft = await getDraftById(id);
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    if (body.apiFormat && !VALID_FORMATS.includes(body.apiFormat)) {
      return NextResponse.json(
        { error: `apiFormat must be one of: ${VALID_FORMATS.join(", ")}` },
        { status: 400 }
      );
    }

    const draft = await updateDraft(id, {
      name: body.name,
      baseUrl: body.baseUrl,
      apiFormat: body.apiFormat,
      sourceUrl: body.sourceUrl,
      status: body.status,
      discoveredModels: body.discoveredModels,
      notes: body.notes,
    });
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteDraft(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
