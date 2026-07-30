import { NextRequest, NextResponse } from "next/server";
import { getAllPools, createPool, createQuickPool } from "@/engine/data-access/pools";

export async function GET() {
  try {
    const pools = await getAllPools();
    return NextResponse.json(pools);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, virtualModelName, description, routingStrategy, members, quickMode, providerModelId } = body;

    if (quickMode && providerModelId && virtualModelName) {
      const pool = await createQuickPool(providerModelId, virtualModelName);
      return NextResponse.json(pool, { status: 201 });
    }

    if (!name || !virtualModelName || !members || !Array.isArray(members) || members.length === 0) {
      return NextResponse.json(
        { error: "name, virtualModelName, and members are required" },
        { status: 400 }
      );
    }

    const pool = await createPool(
      { name, virtualModelName, description, routingStrategy },
      members
    );
    return NextResponse.json(pool, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
