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
    const {
      label, secret, poolId,
      rpmLimit, tpmLimit, rpdLimit, tpdLimit,
      tps, timeToFirstTokenMs, contextWindow,
      cacheCapable, cacheDiscountFactor,
    } = body;

    if (!label || !secret) {
      return NextResponse.json(
        { error: "label and secret are required" },
        { status: 400 }
      );
    }

    const parsed = (
      fieldName: any,
      value: unknown,
      allowFloat = false
    ): { value?: number | null; error?: string } => {
      const r = parseRateLimitInput(value, { mode: "create", fieldName, allowFloat });
      if (r.error) return { error: r.error };
      return { value: r.value ?? null };
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

    const apiKey = await createApiKey(id, {
      poolId: poolId ?? null,
      label,
      secret,
      rpmLimit: rpm.value ?? null,
      tpmLimit: tpm.value ?? null,
      rpdLimit: rpd.value ?? null,
      tpdLimit: tpd.value ?? null,
      tps: tpsP.value ?? null,
      timeToFirstTokenMs: ttftP.value ?? null,
      contextWindow: ctxP.value ?? null,
      cacheCapable: cacheCapable ?? true,
      cacheDiscountFactor:
        cacheDiscountFactor != null ? Number(cacheDiscountFactor) : 0.1,
    });
    return NextResponse.json(apiKey, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
