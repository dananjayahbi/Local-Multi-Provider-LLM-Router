import { NextRequest, NextResponse } from "next/server";
import { addKeyToPool, removeKeyFromPool } from "@/engine/data-access/api-keys";

// Attach a provider-level key to this pool (task 05 — shared keys).
// POST /api/admin/pools/[id]/keys  { apiKeyId }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (!body.apiKeyId) {
      return NextResponse.json({ error: "apiKeyId is required" }, { status: 400 });
    }
    const join = await addKeyToPool(id, body.apiKeyId);
    return NextResponse.json(join, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Detach a provider-level key from this pool.
// DELETE /api/admin/pools/[id]/keys?apiKeyId=...
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const apiKeyId = url.searchParams.get("apiKeyId");
    if (!apiKeyId) {
      return NextResponse.json({ error: "apiKeyId query param is required" }, { status: 400 });
    }
    await removeKeyFromPool(id, apiKeyId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
