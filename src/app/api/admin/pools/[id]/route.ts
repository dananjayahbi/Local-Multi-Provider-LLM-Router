import { NextRequest, NextResponse } from "next/server";
import { getPoolById, updatePool, deletePool } from "@/engine/data-access/pools";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pool = await getPoolById(id);
    if (!pool) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(pool);
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
    const { name, virtualModelName, description, routingStrategy, members } = body;
    const pool = await updatePool(
      id,
      { name, virtualModelName, description, routingStrategy },
      members
    );
    return NextResponse.json(pool);
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
    await deletePool(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
