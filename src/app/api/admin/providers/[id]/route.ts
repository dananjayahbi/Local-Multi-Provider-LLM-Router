import { NextRequest, NextResponse } from "next/server";
import { getProviderById, updateProvider, deleteProvider } from "@/engine/data-access/providers";
import { isValidApiFormat } from "@/lib/api-formats";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const provider = await getProviderById(id);
    if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(provider);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, baseUrl, apiFormat, notes } = body;

    if (apiFormat && !isValidApiFormat(apiFormat)) {
      return NextResponse.json(
        { error: "apiFormat must be CHAT_COMPLETIONS, MESSAGES, or RESPONSES" },
        { status: 400 }
      );
    }

    if (name !== undefined && (!name || typeof name !== "string")) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 }
      );
    }

    if (baseUrl !== undefined && (!baseUrl || typeof baseUrl !== "string")) {
      return NextResponse.json(
        { error: "baseUrl must be a non-empty string" },
        { status: 400 }
      );
    }

    const provider = await updateProvider(id, { name, baseUrl, apiFormat, notes });
    return NextResponse.json(provider);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteProvider(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
