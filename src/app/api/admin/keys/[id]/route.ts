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
    const {
      label, secret, poolId,
      rpmLimit, tpmLimit, rpdLimit, tpdLimit,
      tps, timeToFirstTokenMs, contextWindow,
      cacheCapable, cacheDiscountFactor,
    } = body;

    const parsed = (fieldName: any, value: unknown, allowFloat = false) => {
      const r = parseRateLimitInput(value, { mode: "update", fieldName, allowFloat });
      if (r.error) return { error: r.error };
      return { value: r.value };
    };

    const rpm = parsed("rpmLimit", rpmLimit);
    if (rpm.error) return NextResponse.json({ error: rpm.error }, { status: 400 });
    const tpm = parsed("tpmLimit", tpmLimit);
    if (tpm.error) return NextResponse.json({ error: tpm.error }, { status: 400 });
    const rpd = parsed("rpdLimit", rpdLimit);
    if (rpd.error) return NextResponse.json({ error: rpd.error }, { status: 400 });
    const tpd = parsed("tpdLimit", tpdLimit);
    if (tpd.error) return NextResponse.json({ error: tpd.error }, { status: 400 });
    const tpsP = parsed("tps", tps, true);
    if (tpsP.error) return NextResponse.json({ error: tpsP.error }, { status: 400 });
    const ttftP = parsed("timeToFirstTokenMs", timeToFirstTokenMs, true);
    if (ttftP.error) return NextResponse.json({ error: ttftP.error }, { status: 400 });
    const ctxP = parsed("contextWindow", contextWindow);
    if (ctxP.error) return NextResponse.json({ error: ctxP.error }, { status: 400 });

    const apiKey = await updateApiKey(id, {
      label,
      secret,
      poolId,
      rpmLimit: rpm.value,
      tpmLimit: tpm.value,
      rpdLimit: rpd.value,
      tpdLimit: tpd.value,
      tps: tpsP.value,
      timeToFirstTokenMs: ttftP.value,
      contextWindow: ctxP.value,
      cacheCapable,
      cacheDiscountFactor:
        cacheDiscountFactor != null ? Number(cacheDiscountFactor) : undefined,
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
