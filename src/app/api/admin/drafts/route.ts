import { NextRequest, NextResponse } from "next/server";
import { getAllDrafts, createDraft } from "@/engine/data-access/drafts";

const VALID_FORMATS = ["CHAT_COMPLETIONS", "MESSAGES", "RESPONSES"];

export async function GET() {
  try {
    const drafts = await getAllDrafts();
    return NextResponse.json(drafts);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || !body.baseUrl || !body.apiFormat) {
      return NextResponse.json(
        { error: "name, baseUrl, and apiFormat are required" },
        { status: 400 }
      );
    }

    if (!VALID_FORMATS.includes(body.apiFormat)) {
      return NextResponse.json(
        { error: `apiFormat must be one of: ${VALID_FORMATS.join(", ")}` },
        { status: 400 }
      );
    }

    const draft = await createDraft({
      name: body.name,
      baseUrl: body.baseUrl,
      apiFormat: body.apiFormat,
      sourceUrl: body.sourceUrl ?? null,
      discoveredModels: body.discoveredModels ?? [],
      notes: body.notes ?? null,
    });

    return NextResponse.json(draft, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
