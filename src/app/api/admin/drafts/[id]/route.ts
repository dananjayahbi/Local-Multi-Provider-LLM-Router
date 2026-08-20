import { NextRequest, NextResponse } from "next/server";
import {
  getDraftById,
  updateDraft,
  deleteDraft,
  approveDraft,
  configureDraft,
  rejectDraft,
} from "@/engine/data-access/drafts";

const VALID_STATUSES = ["PENDING_KEY", "TESTING", "ACCEPTED", "REJECTED"];
const VALID_STAGES = ["RAW", "APPROVED", "CONFIGURED", "REJECTED"];
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

    // ── Stage transition actions ───────────────────────
    if (body.action) {
      if (body.action === "approve") {
        const draft = await approveDraft(id);
        return NextResponse.json(draft);
      }
      if (body.action === "configure") {
        if (!Array.isArray(body.models)) {
          return NextResponse.json(
            { error: "configure requires a `models` array" },
            { status: 400 }
          );
        }
        const draft = await configureDraft(id, body.models, body.baseUrl);
        return NextResponse.json(draft);
      }
      if (body.action === "reject") {
        const draft = await rejectDraft(id);
        return NextResponse.json(draft);
      }
      if (body.action === "reactivate") {
        const draft = await updateDraft(id, { stage: "RAW" });
        return NextResponse.json(draft);
      }
      return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
    }

    if (body.stage && !VALID_STAGES.includes(body.stage)) {
      return NextResponse.json(
        { error: `stage must be one of: ${VALID_STAGES.join(", ")}` },
        { status: 400 }
      );
    }
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
      stage: body.stage,
      status: body.status,
      discoveredModels: body.discoveredModels,
      details: body.details,
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
