import { NextRequest, NextResponse } from "next/server";
import {
  getPoolById,
  updatePool,
  deletePool,
  regeneratePoolGatewayKey,
} from "@/engine/data-access/pools";

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;
    if (action === "regenerate-key") {
      const pool = await regeneratePoolGatewayKey(id);
      return NextResponse.json({ pool });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
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
    const {
      name, virtualModelName, description, routingStrategy,
      cacheAware, stickyContextTokenBudget, members,
    } = body;
    const pool = await updatePool(
      id,
      { name, virtualModelName, description, routingStrategy, cacheAware, stickyContextTokenBudget },
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
