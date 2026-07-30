import { NextRequest, NextResponse } from "next/server";
import { getKeysByProvider, createApiKey } from "@/engine/data-access/api-keys";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const keys = await getKeysByProvider(id);
    return NextResponse.json(keys);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { label, secret } = body;

    if (!label || !secret) {
      return NextResponse.json(
        { error: "label and secret are required" },
        { status: 400 }
      );
    }

    const apiKey = await createApiKey(id, { label, secret });
    return NextResponse.json(apiKey, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
