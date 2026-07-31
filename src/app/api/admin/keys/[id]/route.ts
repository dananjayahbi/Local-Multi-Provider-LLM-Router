import { NextRequest, NextResponse } from "next/server";
import { updateApiKey, deleteApiKey } from "@/engine/data-access/api-keys";
import { disableKey, enableKey, reactivateKey, resetPenalty } from "@/engine/health-engine";
import { parseRateLimitInput } from "@/lib/api-key-rate-limits";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { label, secret, rpmLimit, tpmLimit } = body;

    const parsedRpm = parseRateLimitInput(rpmLimit, {
      mode: "update",
      fieldName: "rpmLimit",
    });
    if (parsedRpm.error) {
      return NextResponse.json({ error: parsedRpm.error }, { status: 400 });
    }

    const parsedTpm = parseRateLimitInput(tpmLimit, {
      mode: "update",
      fieldName: "tpmLimit",
    });
    if (parsedTpm.error) {
      return NextResponse.json({ error: parsedTpm.error }, { status: 400 });
    }

    const apiKey = await updateApiKey(id, {
      label,
      secret,
      rpmLimit: parsedRpm.value,
      tpmLimit: parsedTpm.value,
    });
    return NextResponse.json(apiKey);
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
    await deleteApiKey(id);
    return NextResponse.json({ success: true });
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

    switch (action) {
      case "disable":
        await disableKey(id);
        break;
      case "enable":
        await enableKey(id);
        break;
      case "reactivate":
        await reactivateKey(id);
        break;
      case "reset-penalty":
        await resetPenalty(id);
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
