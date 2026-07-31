import { NextRequest, NextResponse } from "next/server";
import { getKeysByProvider, createApiKey } from "@/engine/data-access/api-keys";
import { parseRateLimitInput } from "@/lib/api-key-rate-limits";

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
    const { label, secret, rpmLimit, tpmLimit } = body;

    if (!label || !secret) {
      return NextResponse.json(
        { error: "label and secret are required" },
        { status: 400 }
      );
    }

    const parsedRpm = parseRateLimitInput(rpmLimit, {
      mode: "create",
      fieldName: "rpmLimit",
    });
    if (parsedRpm.error) {
      return NextResponse.json({ error: parsedRpm.error }, { status: 400 });
    }

    const parsedTpm = parseRateLimitInput(tpmLimit, {
      mode: "create",
      fieldName: "tpmLimit",
    });
    if (parsedTpm.error) {
      return NextResponse.json({ error: parsedTpm.error }, { status: 400 });
    }

    const apiKey = await createApiKey(id, {
      label,
      secret,
      rpmLimit: parsedRpm.value ?? null,
      tpmLimit: parsedTpm.value ?? null,
    });
    return NextResponse.json(apiKey, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
